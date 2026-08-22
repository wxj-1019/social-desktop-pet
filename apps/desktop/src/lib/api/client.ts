/**
 * API client（渲染进程）—— 自建后端（D-13）。
 *
 * 令牌模型（8.3/9.8）：
 * - access token：渲染进程内存持有（业务调用 Bearer），15 分钟 TTL
 * - refresh token：只存在于主进程 safeStorage（经 window.pet.session 刷新）
 * - 401 → 调 session.refresh() → 重试一次；失败则登出回登录页
 */
import type { MemoryListItem, MemorySummary, ModelOutput, PetProfile } from '@pet/protocol';
import { MemoryListSchema, MemorySummarySchema, ModelOutputSchema } from '@pet/protocol';

import { parseSseChunks } from './sse.js';
export interface MeResult {
  userId: string;
  nickname: string;
  avatar: string | null;
  activeDisplayDeviceId: string | null;
  device: { deviceId: string; platform: string; appVersion: string | null; lastSeenAt: string };
}

/** 羁绊（7.4）：送礼/拜访共同事件累计推进 */
export interface FriendBond {
  stage: 'first_meet' | 'familiar' | 'trusted';
  progress: number;
}

export interface Friend {
  userId: string;
  nickname: string;
  avatar: string | null;
  friendshipId: string;
  acceptedAt: string;
  /** 9.2 Presence 快照（/friends 返回；之后由 presence.changed 事件增量更新） */
  online: boolean;
  /** 7.4 羁绊进度（服务端始终返回；旧服务端缺省时按 first_meet/0 展示） */
  bond?: FriendBond;
}

export interface InviteCreated {
  inviteId: string;
  token: string;
  expiresAt: string;
}

export interface SyncEvent {
  inboxSeq: number;
  event: {
    eventId: string;
    roomId: string | null;
    roomSeq: number | null;
    type: string;
    payload: unknown;
    reliability: string;
    serverTimestamp: string;
  };
}

let baseUrl: string | null = null;
let accessToken: string | null = null;

/** 初始化：取 API 基址（主进程注入，见 preload getApiBase） */
export async function initApi(): Promise<void> {
  baseUrl = await window.pet.getApiBase();
}

/** 当前 API 基址（可能为 null——initApi 前调用返回 null；WS 客户端用它推导 ws 地址） */
export function apiBase(): string | null {
  return baseUrl;
}

/** 登录/注册/恢复后由调用方设置 access token */
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** 普通请求超时（防网络黑洞卡死 UI） */
const REQUEST_TIMEOUT_MS = 30_000;

/** 带鉴权 + 401 刷新重试 + 超时的 fetch */
async function apiFetch(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  if (!baseUrl) await initApi();
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    // 调用方未指定 signal 时加超时（流式请求自行传入更长超时）
    signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 401 && !retried && accessToken) {
    // access token 过期 → 主进程用 refresh token 换新 → 重试一次
    const refreshed = (await window.pet.session.refresh()) as
      { accessToken?: string } | { error?: string };
    if ('accessToken' in refreshed && refreshed.accessToken) {
      setAccessToken(refreshed.accessToken);
      return apiFetch(path, init, true);
    }
    setAccessToken(null);
    throw new ApiError('会话已过期，请重新登录', 401);
  }
  return res;
}

async function jsonOrThrow(res: Response): Promise<unknown> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new ApiError(body?.error ?? `请求失败 (${res.status})`, res.status);
  return body;
}

export const api = {
  /** GET /me：当前用户资料 + 设备状态 */
  async me(): Promise<MeResult> {
    const res = await apiFetch('/me');
    return (await jsonOrThrow(res)) as MeResult;
  },
  /** GET /friends：active 好友列表 */
  async friends(): Promise<Friend[]> {
    const res = await apiFetch('/friends');
    const body = (await jsonOrThrow(res)) as { friends: Friend[] };
    return body.friends;
  },
  /** POST /invite：创建邀请链接（6.3） */
  async createInvite(): Promise<InviteCreated> {
    const res = await apiFetch('/invite', { method: 'POST' });
    return (await jsonOrThrow(res)) as InviteCreated;
  },
  /** POST /invite/accept：接受邀请（6.3） */
  async acceptInvite(
    token: string,
  ): Promise<{ friendshipId: string; roomId: string; eventId: string }> {
    const res = await apiFetch('/invite/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
    return (await jsonOrThrow(res)) as { friendshipId: string; roomId: string; eventId: string };
  },
  /** POST /gift：送免费点心（9.4 幂等键由调用方生成） */
  async sendGift(
    toUserId: string,
    snackId: string,
    clientEventId: string,
  ): Promise<{ giftId: string; eventId: string; inboxSeq: number }> {
    const res = await apiFetch('/gift', {
      method: 'POST',
      body: JSON.stringify({ toUserId, snackId, clientEventId }),
    });
    return (await jsonOrThrow(res)) as { giftId: string; eventId: string; inboxSeq: number };
  },
  /** GET /pet/profile：桌宠档案云端快照（跨设备同步；云端无档案返回 null） */
  async getPetProfile(): Promise<{
    petId: string;
    profile: PetProfile | null;
    syncedAt: string | null;
  }> {
    const res = await apiFetch('/pet/profile');
    return (await jsonOrThrow(res)) as {
      petId: string;
      profile: PetProfile | null;
      syncedAt: string | null;
    };
  },
  /** PUT /pet/profile：上报档案快照（最后写赢） */
  async putPetProfile(profile: PetProfile): Promise<{ petId: string; ok: true }> {
    const res = await apiFetch('/pet/profile', {
      method: 'PUT',
      body: JSON.stringify(profile),
    });
    return (await jsonOrThrow(res)) as { petId: string; ok: true };
  },
  /** POST /visit：拜访（wave/share_snack/leave_message） */
  async sendVisit(
    toUserId: string,
    type: 'wave' | 'share_snack' | 'leave_message',
  ): Promise<{ visitId: string; eventId: string }> {
    const res = await apiFetch('/visit', {
      method: 'POST',
      body: JSON.stringify({ toUserId, type }),
    });
    return (await jsonOrThrow(res)) as { visitId: string; eventId: string };
  },
  /** GET /sync：分页拉取事件（9.5 慢路径；不传游标 → 服务端从 device_cursors 恢复） */
  async sync(
    afterInboxSeq?: number | null,
  ): Promise<{ events: SyncEvent[]; nextInboxSeq: number; hasMore: boolean }> {
    const query =
      afterInboxSeq === undefined || afterInboxSeq === null
        ? '/sync'
        : `/sync?afterInboxSeq=${afterInboxSeq}`;
    const res = await apiFetch(query);
    return (await jsonOrThrow(res)) as {
      events: SyncEvent[];
      nextInboxSeq: number;
      hasMore: boolean;
    };
  },
  /** 10.1 chat-flow SSE 流式聊天（fetch + ReadableStream；不用 EventSource 以携带 Authorization）
   *  done 帧：完整 ModelOutput（dialogue/emotion/actionIntent/intensity），
   *  safeParse 失败 → onError('模型回复格式无效')，不调 onDone。
   *  signal：调用方可传外部 AbortSignal（"停止回复"）；用户中止 → onAbort（不视为错误） */
  async chatStream(
    message: string,
    handlers: {
      onToken: (text: string) => void;
      onDone: (output: ModelOutput) => void;
      onError?: (message: string) => void;
      onAbort?: () => void;
    },
    threadId?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    // 流式对话超时放宽（真实模型生成可能 30s+）；超时/外部中止经 AbortError → catch
    const timeoutSignal = AbortSignal.timeout(120_000);
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const res = await apiFetch('/chat', {
      method: 'POST',
      body: JSON.stringify({ message, threadId }),
      signal: combined,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      handlers.onError?.(body?.error ?? `请求失败 (${res.status})`);
      return;
    }
    if (!res.body) {
      handlers.onError?.('响应无流');
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const { frames, rest } = parseSseChunks(buffer, decoder.decode(value, { stream: true }));
        buffer = rest;
        for (const frame of frames) {
          const data = JSON.parse(frame.data) as Record<string, unknown>;
          if (frame.event === 'token' && typeof data.text === 'string') {
            handlers.onToken(data.text);
          } else if (frame.event === 'done') {
            const parsed = ModelOutputSchema.safeParse(data);
            if (!parsed.success) {
              handlers.onError?.('模型回复格式无效');
            } else {
              handlers.onDone(parsed.data);
            }
          } else if (frame.event === 'error') {
            handlers.onError?.(String(data.error ?? '未知错误'));
          }
        }
      }
    } catch (e) {
      // 用户主动停止（外部 signal aborted）→ onAbort，不按错误处理
      if (signal?.aborted) {
        handlers.onAbort?.();
      } else {
        handlers.onError?.((e as Error).message);
      }
    } finally {
      reader.releaseLock();
    }
  },
  /** GET /chat/history：AI 对话历史（10.x，最近 N 条） */
  async chatHistory(
    limit = 50,
  ): Promise<Array<{ role: 'user' | 'assistant'; content: string; at: string }>> {
    const res = await apiFetch(`/chat/history?limit=${limit}`);
    const body = (await jsonOrThrow(res)) as {
      messages: Array<{ role: string; content: string; at: string }>;
    };
    return body.messages.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
      at: m.at,
    }));
  },
  /** GET /memories/summary：待确认记忆 + 最近自动保存（10.6/D-3"已记住"提示） */
  async memorySummary(): Promise<MemorySummary> {
    const res = await apiFetch('/memories/summary');
    const body = (await jsonOrThrow(res)) as unknown;
    return MemorySummarySchema.parse(body);
  },
  /** POST /memories/confirm：确认卡"记住"（可携带修改后的 value，编辑过 → user_confirmed） */
  async confirmMemory(confirmationId: string, value?: string): Promise<{ memoryId: string }> {
    const res = await apiFetch('/memories/confirm', {
      method: 'POST',
      body: JSON.stringify({
        confirmationId,
        ...(value !== undefined && value.length > 0 ? { value } : {}),
      }),
    });
    return (await jsonOrThrow(res)) as { memoryId: string };
  },
  /** POST /memories/reject：确认卡"仅本次聊天"（D-3） */
  async rejectMemory(confirmationId: string): Promise<{ ok: true }> {
    const res = await apiFetch('/memories/reject', {
      method: 'POST',
      body: JSON.stringify({ confirmationId }),
    });
    return (await jsonOrThrow(res)) as { ok: true };
  },
  /** POST /memories/:memoryId/invalidate：撤销自动保存（10.5 置失效不删除） */
  async invalidateMemory(memoryId: string): Promise<{ ok: true }> {
    const res = await apiFetch(`/memories/${encodeURIComponent(memoryId)}/invalidate`, {
      method: 'POST',
    });
    return (await jsonOrThrow(res)) as { ok: true };
  },
  /** GET /memories：记忆中心列表（11.3，含来源原文 sourceTexts） */
  async memories(limit = 100): Promise<MemoryListItem[]> {
    const res = await apiFetch(`/memories?limit=${limit}`);
    const body = (await jsonOrThrow(res)) as unknown;
    return MemoryListSchema.parse(body).memories;
  },
  /** POST /memories/:memoryId/edit：修改记忆（10.5 纠正：旧条置失效 + superseded 链） */
  async editMemory(memoryId: string, value: string): Promise<{ memoryId: string }> {
    const res = await apiFetch(`/memories/${encodeURIComponent(memoryId)}/edit`, {
      method: 'POST',
      body: JSON.stringify({ value }),
    });
    return (await jsonOrThrow(res)) as { memoryId: string };
  },
};
