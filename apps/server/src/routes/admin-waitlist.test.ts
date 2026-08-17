import { describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';

import { createAdminWaitlistRouter } from './admin-waitlist.js';

const JWT = new JwtService({ secret: 'admin-test-secret-admin-test-secret' });

function buildRouter(overrides: { listRows?: unknown[]; invite?: unknown; expire?: unknown } = {}) {
  const pool = {
    query: vi.fn(async (sql: string) => {
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
    }),
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
      writeAudit: vi.fn(async () => undefined) as never,
    }),
    pool,
    waitlist,
  };
}

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

  it('invite issues a code via WaitlistService', async () => {
    const { app, waitlist } = buildRouter({
      invite: { invited: [{ email: 'a@b.c', code: 'ABCD1234' }], skipped: [] },
    });
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/waitlist/w1/invite', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('ABCD1234');
    expect(waitlist.invite).toHaveBeenCalledWith(['a@b.c']);
  });

  it('invite returns 409 when the entry is not pending', async () => {
    const { app } = buildRouter({ invite: { invited: [], skipped: ['a@b.c'] } });
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/waitlist/w1/invite', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(409);
  });

  it('expire marks invited entries expired', async () => {
    const { app } = buildRouter({ expire: true });
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/waitlist/w1/expire', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});
