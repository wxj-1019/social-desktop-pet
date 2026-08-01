/**
 * Session 服务（main 进程）—— 9.8/8.3 的桌面端实现。
 *
 * - SessionController 接真实后端 Auth API（替换原 stub）：
 *   access token 在渲染进程（业务调用用），refresh token 只存在于主进程
 *   （SecureStorageController safeStorage 加密存储，绝不出主进程）。
 * - IPC：session:init / session:login / session:refresh / session:revoke
 */
import type { SessionAuthApi, SessionController, SessionProfile } from './session-controller.js';

/** 自建后端地址（D-13）：生产指向 HTTPS 域名；本机默认 127.0.0.1:8787 */
export function apiBaseUrl(): string {
  return process.env['PET_API_BASE'] ?? 'http://127.0.0.1:8787';
}

/** 把 SessionController 的 stub AuthApi 替换为真实后端调用 */
export function createAuthApi(baseUrl = apiBaseUrl()): SessionAuthApi {
  return {
    async refreshAccessToken(refreshToken: string) {
      const res = await fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `refresh 失败 (${res.status})`);
      }
      const body = (await res.json()) as { accessToken: string; refreshToken: string };
      return {
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
        accessExpiresAt: Date.now() + 15 * 60_000,
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
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, deviceId, platform: 'windows', nickname }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `登录失败 (${res.status})`);
  }
  const body = (await res.json()) as {
    accessToken: string;
    refreshToken: string;
    userId: string;
  };
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    profile: { userId: body.userId, deviceId, nickname },
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
  const res = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, deviceId, platform: 'windows', nickname }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `注册失败 (${res.status})`);
  }
  // 注册成功 → 直接登录拿令牌
  return loginWithBackend(baseUrl, email, password, deviceId, nickname);
}

export interface SessionIpcResult {
  phase: string;
  accessToken: string | null;
  profile: SessionProfile | null;
}

export type SessionServiceHandlers = ReturnType<typeof createSessionHandlers>;

/** IPC handler 集合（由 register.ts 调用） */
export function createSessionHandlers(session: SessionController, onActivated?: () => void) {
  const baseUrl = apiBaseUrl();

  return {
    /** 启动恢复：读 safeStorage refresh token → 刷新 → ACTIVE 或 SIGNED_OUT */
    init: async (): Promise<SessionIpcResult> => {
      await session.restore();
      return {
        phase: session.snapshot.phase,
        accessToken: session.snapshot.tokens?.accessToken ?? null,
        profile: session.snapshot.profile,
      };
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
        { accessToken, refreshToken, accessExpiresAt: Date.now() + 15 * 60_000 },
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
        { accessToken, refreshToken, accessExpiresAt: Date.now() + 15 * 60_000 },
        profile,
      );
      onActivated?.(); // 注册即登录 → 同样恢复 pending 邀请
      return { phase: 'ACTIVE', accessToken, profile };
    },
    /** 刷新（业务 401 时调用） */
    refresh: async (): Promise<SessionIpcResult> => {
      await session.refresh(session.snapshot.tokens?.refreshToken ?? '');
      return {
        phase: session.snapshot.phase,
        accessToken: session.snapshot.tokens?.accessToken ?? null,
        profile: session.snapshot.profile,
      };
    },
    /** 登出/撤销设备 */
    revoke: async (): Promise<{ phase: string }> => {
      await session.revoke();
      return { phase: session.snapshot.phase };
    },
  };
}
