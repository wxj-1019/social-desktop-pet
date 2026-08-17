import { describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';

import { createAdminUsageRouter } from './admin-usage.js';

const JWT = new JwtService({ secret: 'admin-test-secret-admin-test-secret' });

function buildRouter(rowsByFragment: Array<{ fragment: string; rows: unknown[] }>) {
  const pool = {
    query: vi.fn(async (sql: string) => {
      const hit = rowsByFragment.find((r) => sql.includes(r.fragment));
      return { rows: hit?.rows ?? [], rowCount: hit?.rows.length ?? 0 };
    }),
  };
  const adminUsers = {
    getById: vi.fn(async () => ({ id: 'a1', email: 'admin@pet.dev', status: 'active' })),
  };
  return {
    app: createAdminUsageRouter({ pool: pool as never, jwt: JWT, adminUsers: adminUsers as never }),
    pool,
  };
}

describe('admin usage routes', () => {
  it('returns daily usage with summary', async () => {
    const { app } = buildRouter([
      // 日粒度查询同时含 sum(request_count) 与 group by usage_date；
      // find 按数组顺序匹配，必须把更具体的 group by 片段放前面，否则日查询会误命中汇总片段。
      {
        fragment: 'group by usage_date',
        rows: [{ usage_date: '2026-08-18', requests: 20, tokens: 2500 }],
      },
      {
        fragment: 'sum(request_count)',
        rows: [{ total: 2, requests: 30, tokens: 4000 }],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/usage?from=2026-08-01&to=2026-08-18', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { requests: number; tokens: number };
      items: Array<{ usageDate: string; requests: number }>;
    };
    expect(body.summary.requests).toBe(30);
    expect(body.items[0]!.usageDate).toBe('2026-08-18');
  });

  it('returns per-user usage', async () => {
    const { app } = buildRouter([
      {
        fragment: 'where user_id = $1',
        rows: [{ usage_date: '2026-08-18', requests: 5, tokens: 600 }],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/usage/users/u1?from=2026-08-01', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ requests: number }> };
    expect(body.items[0]!.requests).toBe(5);
  });

  it('rejects a date range longer than 31 days', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/usage?from=2026-01-01&to=2026-03-01', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(422);
  });

  it('requires admin token', async () => {
    const { app } = buildRouter([]);
    const userToken = await JWT.sign({ sub: 'u1', deviceId: 'dev-1' });
    const res = await app.request('/usage', {
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(401);
  });
});
