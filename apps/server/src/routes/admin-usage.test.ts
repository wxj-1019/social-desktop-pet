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
        rows: [{ usage_date: '2026-08-18', requests: 20, tokens: 2500, fails: 1, limit_hits: 2 }],
      },
      {
        fragment: 'sum(request_count)',
        rows: [{ requests: 30, tokens: 4000, fails: 3, limit_hits: 4 }],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/usage?from=2026-08-01&to=2026-08-18', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { requests: number; tokens: number; fails: number; limitHits: number };
      items: Array<{ usageDate: string; requests: number; fails: number; limitHits: number }>;
    };
    expect(body.summary.requests).toBe(30);
    expect(body.summary.fails).toBe(3);
    expect(body.summary.limitHits).toBe(4);
    expect(body.items[0]!.usageDate).toBe('2026-08-18');
    expect(body.items[0]!.fails).toBe(1);
    expect(body.items[0]!.limitHits).toBe(2);
  });

  it('returns per-user usage with fail/limit/model dims', async () => {
    const { app } = buildRouter([
      {
        fragment: 'where user_id = $1',
        rows: [
          {
            usage_date: '2026-08-18',
            requests: 5,
            tokens: 600,
            fails: 0,
            limit_hits: 1,
            model: 'glm-4-flash',
          },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request(
      '/usage/users/11111111-1111-4111-8111-111111111111?from=2026-08-01',
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ requests: number; fails: number; limitHits: number; model: string | null }>;
    };
    expect(body.items[0]!.requests).toBe(5);
    expect(body.items[0]!.limitHits).toBe(1);
    expect(body.items[0]!.model).toBe('glm-4-flash');
  });

  it('filters daily usage by model and returns models list', async () => {
    const { app, pool } = buildRouter([
      {
        fragment: 'group by usage_date',
        rows: [{ usage_date: '2026-08-18', requests: 6, tokens: 900, fails: 0, limit_hits: 1 }],
      },
      {
        fragment: 'sum(request_count)',
        rows: [{ requests: 6, tokens: 900, fails: 0, limit_hits: 1 }],
      },
      {
        fragment: 'select distinct model',
        rows: [{ model: 'glm-4-flash' }, { model: 'doubao-seedream' }],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/usage?from=2026-08-01&to=2026-08-18&model=glm-4-flash', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ requests: number }> };
    expect(body.items[0]!.requests).toBe(6);
    const queries = pool.query.mock.calls.map((c) => String(c[0]));
    expect(queries.some((sql) => sql.includes('model = $3'))).toBe(true);

    const modelsRes = await app.request('/usage/models?from=2026-08-01&to=2026-08-18', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(modelsRes.status).toBe(200);
    expect(((await modelsRes.json()) as { models: string[] }).models).toEqual([
      'glm-4-flash',
      'doubao-seedream',
    ]);
  });

  it('rejects a date range longer than 31 days', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/usage?from=2026-01-01&to=2026-03-01', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(422);
  });

  it('rejects an invalid calendar date (month 13) with 422', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    // 非法日期在 to 侧：from <= to 与天数检查都拦不住（NaN 比较恒 false），
    // 必须靠日历校验兜底，否则 $2::date 会在真实 Postgres 上抛 500。
    const res = await app.request('/usage?from=2026-08-01&to=2026-13-18', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid_input' });
  });

  it('rejects a date that does not exist on the calendar (2026-02-30)', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    // V8 的 Date.parse 会把 02-30 滚动成 03-02（合法时间戳），且 29 天跨度未超限，
    // 只有真实日历校验能拦住。
    const res = await app.request('/usage?from=2026-02-01&to=2026-02-30', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid_input' });
  });

  it('allows a range of exactly 31 days', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/usage?from=2026-01-01&to=2026-02-01', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
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
