/**
 * API client（渲染进程）—— 自建后端（D-13）。
 *
 * 令牌模型（8.3/9.8）：
 * - access token：渲染进程内存持有（业务调用 Bearer），15 分钟 TTL
 * - refresh token：只存在于主进程 safeStorage（经 window.pet.session 刷新）
 * - 401 → 调 session.refresh() → 重试一次；失败则登出回登录页
 */
import { parseSseChunks } from './sse.js';
export interface MeResult {
  userId: string;
  nickname: string;
  avatar: string | null;
  activeDisplayDeviceId: string | null;
  device: { deviceId: string; platform: string; appVersion: string | null; lastSeenAt: string };
}

export interface Friend {
  userId: string;
  nickname: string;
  avatar: string | null;
  friendshipId: string;
  acceptedAt: string;
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

/** 带鉴权 + 401 刷新重试的 fetch */
async function apiFetch(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  if (!baseUrl) await initApi();
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
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
  /** GET /sync：分页拉取事件（9.5 慢路径） */
  async sync(
    afterInboxSeq: number,
  ): Promise<{ events: SyncEvent[]; nextInboxSeq: number; hasMore: boolean }> {
    const res = await apiFetch(`/sync?afterInboxSeq=${afterInboxSeq}`);
    return (await jsonOrThrow(res)) as {
      events: SyncEvent[];
      nextInboxSeq: number;
      hasMore: boolean;
    };
  },
  /** 10.1 chat-flow SSE 流式聊天（fetch + ReadableStream；不用 EventSource 以携带 Authorization） */
  async chatStream(
    message: string,
    handlers: {
      onToken: (text: string) => void;
      onDone: (final: { dialogue: string }) => void;
      onError?: (message: string) => void;
    },
    threadId?: string,
  ): Promise<void> {
    const res = await apiFetch('/chat', {
      method: 'POST',
      body: JSON.stringify({ message, threadId }),
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
            handlers.onDone({ dialogue: String(data.dialogue ?? '') });
          } else if (frame.event === 'error') {
            handlers.onError?.(String(data.error ?? '未知错误'));
          }
        }
      }
    } catch (e) {
      handlers.onError?.((e as Error).message);
    } finally {
      reader.releaseLock();
    }
  },
};
