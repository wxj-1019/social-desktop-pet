import { describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';

import { createAdminWaitlistRouter } from './admin-waitlist.js';

const JWT = new JwtService({ secret: 'admin-test-secret-admin-test-secret' });

function buildRouter(overrides: { listRows?: unknown[]; invite?: unknown; expire?: unknown } = {}) {
  const allQueries: Array<{ sql: string; params?: unknown[] }> = [];
  const route = async (sql: string, params?: unknown[]) => {
    allQueries.push({ sql, params });
    if (sql.includes('count(*)'))
      return { rows: [{ total: overrides.listRows?.length ?? 0 }], rowCount: 0 };
    // 注意顺序：'from waitlist w' 是 'from waitlist where ...' 的前缀，必须先匹配更具体的 select email
    if (sql.includes('select email from waitlist'))
      return {
        rows: overrides.invite ? [{ email: 'a@b.c' }] : [],
        rowCount: overrides.invite ? 1 : 0,
      };
    if (sql.includes('from waitlist w')) return { rows: overrides.listRows ?? [], rowCount: 0 };
    if (sql.includes("status = 'expired'"))
      return { rows: overrides.expire ? [{}] : [], rowCount: overrides.expire ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  };
  const pool = {
    query: vi.fn(route),
    connect: vi.fn(async () => ({ query: vi.fn(route), release: vi.fn() })),
  };
  const adminUsers = {
    getById: vi.fn(async () => ({ id: 'a1', email: 'admin@pet.dev', status: 'active' })),
  };
  const waitlist = {
    invite: vi.fn(async () => overrides.invite ?? { invited: [], skipped: ['x@y.z'] }),
  };
  return {
    app: createAdminWaitlistRouter({
      pool: pool as never,
      jwt: JWT,
      adminUsers: adminUsers as never,
      waitlist: waitlist as never,
    }),
    pool,
    waitlist,
    queries: allQueries,
  };
}

const ENTRY_ID = '11111111-1111-4111-8111-111111111111';

describe('admin waitlist routes', () => {
  it('lists waitlist entries', async () => {
    const { app } = buildRouter({
      listRows: [
        {
          id: 'w1',
          email: 'a@b.c',
          status: 'pending',
          created_at: '2026-08-01T00:00:00Z',
          invited_at: null,
          invite_expires_at: null,
          claimed_at: null,
        },
      ],
    });
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/waitlist?status=pending', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ email: string; status: string }> };
    expect(body.items[0]!.email).toBe('a@b.c');
  });

  it('invite issues a code via WaitlistService with the in-tx audit hook', async () => {
    const { app, waitlist } = buildRouter({
      invite: { invited: [{ email: 'a@b.c', code: 'ABCD1234' }], skipped: [] },
    });
    const token = await JWT.signAdmin('a1');
    const res = await app.request(`/waitlist/${ENTRY_ID}/invite`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('ABCD1234');
    // 第二参数是事务内审计钩子（WaitlistService 在邀请落库的同一事务里调用）
    expect(waitlist.invite).toHaveBeenCalledWith(['a@b.c'], expect.anything());
  });

  it('invite returns 409 when the entry is not pending', async () => {
    const { app } = buildRouter({ invite: { invited: [], skipped: ['a@b.c'] } });
    const token = await JWT.signAdmin('a1');
    const res = await app.request(`/waitlist/${ENTRY_ID}/invite`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(409);
  });

  it('expire marks invited entries expired with audit in the same transaction', async () => {
    const { app, queries } = buildRouter({ expire: true });
    const token = await JWT.signAdmin('a1');
    const res = await app.request(`/waitlist/${ENTRY_ID}/expire`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // 审计与状态变更同事务：insert 在 update 之后、commit 之前
    const updateIdx = queries.findIndex((q) => q.sql.includes("status = 'expired'"));
    const auditIdx = queries.findIndex(
      (q) => q.sql.includes('insert into admin_audit_log') && q.params?.[1] === 'waitlist.expire',
    );
    const commitIdx = queries.map((q) => q.sql).lastIndexOf('commit');
    expect(auditIdx).toBeGreaterThan(updateIdx);
    expect(commitIdx).toBeGreaterThan(auditIdx);
    expect(queries[auditIdx]!.params).toEqual(
      expect.arrayContaining(['a1', 'waitlist.expire', 'waitlist', ENTRY_ID]),
    );
  });

  it('expire of non-invited entry returns 409', async () => {
    const { app } = buildRouter({ expire: false });
    const token = await JWT.signAdmin('a1');
    const res = await app.request(`/waitlist/${ENTRY_ID}/expire`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_invited' });
  });
});
