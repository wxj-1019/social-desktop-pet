import { describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';

import { createAdminUsersRouter } from './admin-users.js';

const JWT = new JwtService({ secret: 'admin-test-secret-admin-test-secret' });

function buildRouter(
  rowsByFragment: Array<{ fragment: string; rows: unknown[]; rowCount?: number }>,
) {
  const pool = {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      const hit = rowsByFragment.find((r) => sql.includes(r.fragment));
      if (!hit) return { rows: [], rowCount: 0 };
      return { rows: hit.rows, rowCount: hit.rowCount ?? hit.rows.length };
    }),
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string) => {
        const hit = rowsByFragment.find((r) => sql.includes(r.fragment));
        return { rows: hit?.rows ?? [], rowCount: hit?.rowCount ?? hit?.rows.length ?? 0 };
      }),
      release: vi.fn(),
    })),
  };
  const adminUsers = {
    getById: vi.fn(async () => ({ id: 'a1', email: 'admin@pet.dev', status: 'active' })),
  };
  const realtime = { kickUser: vi.fn() };
  const writeAudit = vi.fn(async () => undefined);
  const app = createAdminUsersRouter({
    pool: pool as never,
    jwt: JWT,
    adminUsers: adminUsers as never,
    realtime: realtime as never,
    writeAudit: writeAudit as never,
  });
  return { app, pool, realtime, writeAudit };
}

describe('admin users routes', () => {
  it('lists users with pagination and filters', async () => {
    const { app } = buildRouter([
      { fragment: 'count(*)::int as total', rows: [{ total: 1 }] },
      {
        fragment: 'from auth.users u',
        rows: [
          {
            user_id: 'u1',
            email: 'a@b.c',
            nickname: '测试',
            account_status: 'active',
            created_at: '2026-08-01T00:00:00Z',
            device_count: 2,
            online: 1,
            last_seen_at: '2026-08-18T00:00:00Z',
          },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/users?q=test&status=active&page=1&pageSize=10', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      items: Array<{ email: string; deviceCount: number }>;
    };
    expect(body.total).toBe(1);
    expect(body.items[0]!.email).toBe('a@b.c');
    expect(body.items[0]!.deviceCount).toBe(2);
  });

  it('requires admin token (user token rejected)', async () => {
    const { app } = buildRouter([]);
    const userToken = await JWT.sign({ sub: 'u1', deviceId: 'dev-1' });
    const res = await app.request('/users', {
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(401);
  });

  it('returns user detail with counts', async () => {
    const { app } = buildRouter([
      {
        fragment: 'where u.id = $1',
        rows: [
          {
            user_id: 'u1',
            email: 'a@b.c',
            nickname: '测试',
            account_status: 'active',
            suspended_at: null,
            suspended_reason: null,
            created_at: '2026-08-01T00:00:00Z',
            device_count: 2,
            chat_requests_7d: 5,
            pet_count: 1,
            friend_count: 0,
            memory_count: 3,
          },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/users/u1', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string; chatRequests7d: number };
    expect(body.email).toBe('a@b.c');
    expect(body.chatRequests7d).toBe(5);
  });

  it('suspends a user: status update, session+device revoke, kick + audit', async () => {
    const { app, realtime, writeAudit } = buildRouter([
      {
        fragment: "set account_status = 'suspended'",
        rows: [],
        rowCount: 1,
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/users/u1/suspend', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '测试' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(realtime.kickUser).toHaveBeenCalledWith('u1');
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'user.suspend', resourceId: 'u1', reason: '测试' }),
    );
  });

  it('suspend of already-suspended user returns 409', async () => {
    const { app } = buildRouter([
      {
        fragment: "set account_status = 'suspended'",
        rows: [],
        rowCount: 0,
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/users/u1/suspend', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '测试' }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_suspended' });
  });

  it('suspend without reason returns 422', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/users/u1/suspend', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid_input' });
  });

  it('restore of non-suspended user returns 409', async () => {
    const { app } = buildRouter([
      {
        fragment: "set account_status = 'active'",
        rows: [],
        rowCount: 0,
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/users/u1/restore', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_suspended' });
  });

  it('lists users with non-numeric page falling back to 1', async () => {
    const { app } = buildRouter([
      { fragment: 'count(*)::int as total', rows: [{ total: 1 }] },
      {
        fragment: 'from auth.users u',
        rows: [
          {
            user_id: 'u1',
            email: 'a@b.c',
            nickname: '测试',
            account_status: 'active',
            created_at: '2026-08-01T00:00:00Z',
            device_count: 2,
            online: 1,
            last_seen_at: '2026-08-18T00:00:00Z',
          },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/users?page=abc&pageSize=xyz', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { page: number; pageSize: number };
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
  });

  it('lists devices for a user via claims transaction', async () => {
    const { app } = buildRouter([
      {
        fragment: 'from devices where user_id',
        rows: [
          {
            device_id: 'd1',
            platform: 'windows',
            app_version: '1.0.0',
            last_seen_at: '2026-08-18T00:00:00Z',
            revoked_at: null,
          },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/users/u1/devices', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ deviceId: string; platform: string }>;
    };
    expect(body.items[0]!.deviceId).toBe('d1');
    expect(body.items[0]!.platform).toBe('windows');
  });

  it('revokes a device: owner lookup then claims-transaction revoke + audit', async () => {
    const { app, writeAudit } = buildRouter([
      {
        fragment: 'select user_id from devices',
        rows: [{ user_id: 'u1' }],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/devices/d1/revoke', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'device.revoke', resourceId: 'd1', reason: 'u1' }),
    );
  });
});
