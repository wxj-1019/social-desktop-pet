/**
 * 管理 API 客户端：Bearer access token 只在内存；
 * 401 自动 refresh 一次（cookie）后重试，失败抛 AdminUnauthorized。
 */
let accessToken: string | null = null;

/** 单飞 refresh：并发 401 共享同一次 /auth/refresh 调用。
 *  服务端 refresh token 一次性轮换，并发调用只有一个能赢；
 *  共享 promise 让输家直接复用赢家的新 access token，避免误登出。 */
let refreshPromise: Promise<{ accessToken: string } | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

function refreshOnce(): Promise<{ accessToken: string } | null> {
  if (!refreshPromise) {
    refreshPromise = raw<{ accessToken: string }>('/auth/refresh', {
      method: 'POST',
      body: {},
      skipRefresh: true,
    })
      .then((r) => r)
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export class AdminUnauthorized extends Error {
  constructor() {
    super('admin_unauthorized');
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  skipRefresh?: boolean;
}

async function raw<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  const res = await fetch(`/admin${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (res.status === 401 && !opts.skipRefresh) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      setAccessToken(refreshed.accessToken);
      return raw<T>(path, { ...opts, skipRefresh: true });
    }
    throw new AdminUnauthorized();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new AdminApiError(res.status, body.error ?? `http_${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const adminApi = {
  login(email: string, password: string) {
    return raw<{ accessToken: string; admin: { id: string; email: string } }>('/auth/login', {
      method: 'POST',
      body: { email, password },
      // 凭证端点不触发 refresh：密码错误不应轮换（或失效）旧 refresh cookie
      skipRefresh: true,
    });
  },
  me() {
    return raw<{ admin: { id: string; email: string } }>('/auth/me');
  },
  logout() {
    return raw<{ ok: true }>('/auth/revoke', { method: 'POST', body: {} });
  },
  overview() {
    return raw<{
      totalUsers: number;
      onlineDevices: number;
      chatRequestsToday: number;
      pendingInvites: number;
    }>('/overview');
  },
};
