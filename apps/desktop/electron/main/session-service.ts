/**
 * Session 服务（main 进程）—— 9.8/8.3 的桌面端实现。
 *
 * - SessionController 接真实后端 Auth API（替换原 stub）：
 *   access token 在渲染进程（业务调用用），refresh token 只存在于主进程
 *   （SecureStorageController safeStorage 加密存储，绝不出主进程）。
 * - IPC：session:init / session:login / session:refresh / session:revoke
 *
 * M4（审查修复）：IPC 载荷 schema 不再本地重复定义，直接复用 @pet/protocol 的
 * SessionLoginPayloadSchema / SessionRegisterPayloadSchema（单一真相源；
 * 约束以 protocol 为准：email ≤254 / password 8–128 / nickname trim 1–40）。
 * 注意：这里 re-export 仅为保持 ipc/register.ts 既有 import 路径。
 */
import { z } from 'zod';

import {
  SessionRefreshError,
  type SessionAuthApi,
  type SessionController,
  type SessionProfile,
  type SessionState,
} from './session-controller.js';

export { SessionLoginPayloadSchema, SessionRegisterPayloadSchema } from '@pet/protocol';

/** 自建后端地址（D-13）：生产指向 HTTPS 域名；本机默认 127.0.0.1:8787 */
export function apiBaseUrl(): string {
  return process.env['PET_API_BASE'] ?? 'http://127.0.0.1:8787';
}

const SESSION_REQUEST_TIMEOUT_MS = 15_000;

/** access token TTL（9.8：短 TTL，缩小撤销滞后窗口） */
const ACCESS_TTL_MS = 15 * 60_000;

export type SessionServiceErrorCode =
  | 'profile_unavailable'
  | 'profile_invalid'
  | 'profile_http'
  | 'login_unavailable'
  | 'login_invalid'
  | 'register_unavailable'
  | 'register_invalid';

export class SessionServiceError extends Error {
  constructor(
    readonly code: SessionServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SessionServiceError';
  }
}

const errorBodySchema = z.object({ error: z.string() });
const sessionTokensBodySchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
});
const loginBodySchema = sessionTokensBodySchema.extend({ userId: z.string().min(1) });
const registerBodySchema = z.object({ userId: z.string().min(1) });
const profileBodySchema = z.object({
  userId: z.string().min(1),
  nickname: z.string(),
  device: z.object({ deviceId: z.string().min(1) }),
});

async function stableResponseError(res: Response, fallback: string): Promise<string> {
  const parsed = errorBodySchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? parsed.data.error : fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** 把 SessionController 的 stub AuthApi 替换为真实后端调用 */
export function createAuthApi(baseUrl = apiBaseUrl()): SessionAuthApi {
  return {
    async refreshAccessToken(refreshToken: string) {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
          signal: AbortSignal.timeout(SESSION_REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        throw new SessionRefreshError(errorMessage(error, 'refresh 请求失败'), false);
      }
      if (!res.ok) {
        const message = await stableResponseError(res, `refresh 失败 (${res.status})`);
        throw new SessionRefreshError(message, res.status === 401 || res.status === 403);
      }
      const body: unknown = await res.json().catch(() => null);
      const parsed = sessionTokensBodySchema.safeParse(body);
      if (!parsed.success) {
        throw new SessionRefreshError('refresh 响应无效', false);
      }
      return {
        accessToken: parsed.data.accessToken,
        refreshToken: parsed.data.refreshToken,
        accessExpiresAt: Date.now() + ACCESS_TTL_MS,
      };
    },
    async loadProfile(accessToken: string) {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/me`, {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(SESSION_REQUEST_TIMEOUT_MS),
        });
      } catch {
        throw new SessionServiceError('profile_unavailable', '资料服务暂时不可用');
      }
      if (!res.ok) {
        throw new SessionServiceError(
          'profile_http',
          await stableResponseError(res, `资料加载失败 (${res.status})`),
        );
      }
      const body: unknown = await res.json().catch(() => null);
      const parsed = profileBodySchema.safeParse(body);
      if (!parsed.success) throw new SessionServiceError('profile_invalid', '资料响应无效');
      return {
        userId: parsed.data.userId,
        nickname: parsed.data.nickname,
        deviceId: parsed.data.device.deviceId,
      };
    },
    async revoke(refreshToken: string) {
      await fetch(`${baseUrl}/auth/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => undefined); // 撤销失败不阻塞登出
    },
  };
}

/** 登录（渲染进程 → IPC → 主进程直连后端；refresh token 不出主进程） */
export async function loginWithBackend(
  baseUrl: string,
  email: string,
  password: string,
  deviceId: string,
  nickname?: string,
): Promise<{ accessToken: string; refreshToken: string; profile: SessionProfile }> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, deviceId, platform: 'windows', nickname }),
      signal: AbortSignal.timeout(SESSION_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SessionServiceError('login_unavailable', '登录服务暂时不可用');
  }
  if (!res.ok) {
    throw new SessionServiceError(
      'login_invalid',
      await stableResponseError(res, `登录失败 (${res.status})`),
    );
  }
  const parsed = loginBodySchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new SessionServiceError('login_invalid', '登录响应无效');
  return {
    accessToken: parsed.data.accessToken,
    refreshToken: parsed.data.refreshToken,
    profile: { userId: parsed.data.userId, deviceId, nickname },
  };
}

/** 注册 + 自动登录（同一次会话拿到 access token） */
export async function registerWithBackend(
  baseUrl: string,
  email: string,
  password: string,
  deviceId: string,
  nickname: string,
): Promise<{ accessToken: string; refreshToken: string; profile: SessionProfile }> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, deviceId, platform: 'windows', nickname }),
      signal: AbortSignal.timeout(SESSION_REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new SessionServiceError('register_unavailable', '注册服务暂时不可用');
  }
  if (!res.ok) {
    throw new SessionServiceError(
      'register_invalid',
      await stableResponseError(res, `注册失败 (${res.status})`),
    );
  }
  const parsed = registerBodySchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new SessionServiceError('register_invalid', '注册响应无效');
  return loginWithBackend(baseUrl, email, password, deviceId, nickname);
}

export interface SessionIpcResult {
  phase: SessionState['phase'];
  accessToken: string | null;
  profile: SessionProfile | null;
}

export type SessionServiceHandlers = ReturnType<typeof createSessionHandlers>;

function toIpcResult(snapshot: SessionState): SessionIpcResult {
  return {
    phase: snapshot.phase,
    accessToken: snapshot.tokens?.accessToken ?? null,
    profile: snapshot.profile,
  };
}

/** IPC handler 集合（由 register.ts 调用） */
export function createSessionHandlers(
  session: SessionController,
  onActivated?: () => void,
  restorePromise: Promise<SessionState> = Promise.resolve(session.snapshot),
) {
  const baseUrl = apiBaseUrl();

  return {
    /** 等待 Main 启动的唯一 restore，再读取当前快照；不重复触发恢复 */
    init: async (): Promise<SessionIpcResult> => {
      await restorePromise;
      return toIpcResult(session.snapshot);
    },
    /** 登录（已有账号）：refresh token 经 activate 存入 safeStorage（8.3） */
    login: async (payload: {
      email: string;
      password: string;
      deviceId: string;
    }): Promise<SessionIpcResult> => {
      const { email, password, deviceId } = payload;
      const { accessToken, refreshToken, profile } = await loginWithBackend(
        baseUrl,
        email,
        password,
        deviceId,
      );
      await session.activate(
        { accessToken, refreshToken, accessExpiresAt: Date.now() + ACCESS_TTL_MS },
        profile,
      );
      onActivated?.(); // 登录完成 → 恢复 pending 深链邀请（6.3）
      return { phase: 'ACTIVE', accessToken, profile };
    },
    /** 注册并登录 */
    register: async (payload: {
      email: string;
      password: string;
      deviceId: string;
      nickname: string;
    }): Promise<SessionIpcResult> => {
      const { accessToken, refreshToken, profile } = await registerWithBackend(
        baseUrl,
        payload.email,
        payload.password,
        payload.deviceId,
        payload.nickname,
      );
      await session.activate(
        { accessToken, refreshToken, accessExpiresAt: Date.now() + ACCESS_TTL_MS },
        profile,
      );
      onActivated?.(); // 注册即登录 → 同样恢复 pending 邀请
      return { phase: 'ACTIVE', accessToken, profile };
    },
    /** 刷新（业务 401 时调用；controller 从当前状态或安全存储解析 token） */
    refresh: async (): Promise<SessionIpcResult> => {
      await session.refresh(undefined);
      return toIpcResult(session.snapshot);
    },
    /** 登出/撤销设备 */
    revoke: async (): Promise<SessionIpcResult> => {
      await session.revoke();
      return toIpcResult(session.snapshot);
    },
  };
}
