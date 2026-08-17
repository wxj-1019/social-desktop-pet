/**
 * 管理 API 客户端：Bearer access token 只在内存；
 * 401 自动 refresh 一次（cookie）后重试，失败抛 AdminUnauthorized。
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
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
    const refreshed = await raw<{ accessToken: string }>('/auth/refresh', {
      method: 'POST',
      body: {},
      skipRefresh: true,
    }).catch(() => null);
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
