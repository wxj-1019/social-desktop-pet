// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminApiError, AdminUnauthorized, adminApi, setAccessToken } from './api.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 按 URL + 调用次数路由的 fetch 桩；返回每次调用的 URL 列表与请求头。 */
function stubFetch(route: (url: string, callCount: number) => Response | Promise<Response>): {
  calls: string[];
  inits: Array<RequestInit | undefined>;
} {
  const calls: string[] = [];
  const inits: Array<RequestInit | undefined> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(url);
      inits.push(init);
      return route(url, calls.filter((u) => u === url).length);
    }),
  );
  return { calls, inits };
}

afterEach(() => {
  setAccessToken(null);
  vi.unstubAllGlobals();
});

describe('adminApi refresh path', () => {
  it('401 → 单飞 refresh → 用新 token 重试成功', async () => {
    const { calls, inits } = stubFetch((url, count) => {
      if (url === '/admin/auth/refresh') return json(200, { accessToken: 't2' });
      if (url === '/admin/overview') {
        return count === 1
          ? json(401, { error: 'admin_unauthorized' })
          : json(200, { totalUsers: 7, onlineDevices: 1, chatRequestsToday: 3, pendingInvites: 0 });
      }
      return json(500, { error: 'unexpected' });
    });

    const data = await adminApi.overview();

    expect(data).toEqual({
      totalUsers: 7,
      onlineDevices: 1,
      chatRequestsToday: 3,
      pendingInvites: 0,
    });
    expect(calls).toEqual(['/admin/overview', '/admin/auth/refresh', '/admin/overview']);
    // 首次请求无 token；重试带刷新后的 token
    expect(
      (inits[0]?.headers as Record<string, string> | undefined)?.authorization,
    ).toBeUndefined();
    expect((inits[2]?.headers as Record<string, string> | undefined)?.authorization).toBe(
      'Bearer t2',
    );
  });

  it('refresh 自身 401 → 抛 AdminUnauthorized', async () => {
    const { calls } = stubFetch(() => json(401, { error: 'admin_unauthorized' }));

    await expect(adminApi.me()).rejects.toThrow(AdminUnauthorized);
    expect(calls).toEqual(['/admin/auth/me', '/admin/auth/refresh']);
  });

  it('并发 401 单飞：refresh 只调用一次', async () => {
    const { calls } = stubFetch((url, count) => {
      if (url === '/admin/auth/refresh') return json(200, { accessToken: 't2' });
      if (url === '/admin/auth/me') {
        // 两个并发原始请求（第 1、2 次调用）都 401；两个重试（第 3、4 次）都成功
        return count <= 2
          ? json(401, { error: 'admin_unauthorized' })
          : json(200, { admin: { id: 'a1', email: 'admin@pet.dev' } });
      }
      return json(500, { error: 'unexpected' });
    });

    const [a, b] = await Promise.all([adminApi.me(), adminApi.me()]);

    expect(a).toEqual({ admin: { id: 'a1', email: 'admin@pet.dev' } });
    expect(b).toEqual({ admin: { id: 'a1', email: 'admin@pet.dev' } });
    expect(calls.filter((u) => u === '/admin/auth/refresh')).toHaveLength(1);
    expect(calls).toHaveLength(5);
    expect(calls.filter((u) => u === '/admin/auth/me')).toHaveLength(4);
  });

  it('login 失败不触发 refresh（凭证端点 skipRefresh）', async () => {
    const { calls } = stubFetch(() => json(401, { error: 'invalid_credentials' }));

    await expect(adminApi.login('a@b.c', 'wrong')).rejects.toThrow(AdminApiError);
    expect(calls).toEqual(['/admin/auth/login']);
  });
});
