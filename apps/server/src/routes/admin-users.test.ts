import { describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';

import { createAdminUsersRouter } from './admin-users.js';

const JWT = new JwtService({ secret: 'admin-test-secret-admin-test-secret' });

function buildRouter(
  rowsByFragment: Array<{
    fragment: string;
    rows: unknown[];
    rowCount?: number;
    onQuery?: (sql: string, params?: unknown[]) => void;
  }>,
) {
  const allQueries: Array<{ sql: string; params?: unknown[] }> = [];
  const route = async (sql: string, params?: unknown[]) => {
    allQueries.push({ sql, params });
    const hit = rowsByFragment.find((r) => sql.includes(r.fragment));
    hit?.onQuery?.(sql, params);
    return { rows: hit?.rows ?? [], rowCount: hit?.rowCount ?? hit?.rows.length ?? 0 };
  };
  const pool = {
    query: vi.fn(route),
    connect: vi.fn(async () => ({
      query: vi.fn(route),
      release: vi.fn(),
    })),
  };
  const adminUsers = {
    getById: vi.fn(async () => ({ id: 'a1', email: 'admin@pet.dev', status: 'active' })),
  };
  const realtime = { kickUser: vi.fn() };
  const app = createAdminUsersRouter({
    pool: pool as never,
    jwt: JWT,
    adminUsers: adminUsers as never,
    realtime: realtime as never,
  });
  return { app, pool, realtime, queries: allQueries };
}

const USER_ID = '11111111-1111-4111-8111-111111111111';

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

  it('applies whitelisted sort param to the list query', async () => {
    const { app, queries } = buildRouter([
      { fragment: 'count(*)::int as total', rows: [{ total: 0 }] },
      { fragment: 'from auth.users u', rows: [] },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/users?sort=last_seen_desc', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    // count 查询与列表查询都含 from auth.users u，用分页片段定位列表查询
    const listQuery = queries.find((q) => q.sql.includes('limit $3 offset $4'));
    expect(listQuery?.sql).toContain('order by last_seen_at desc nulls last');
  });

  it('falls back to default sort for unknown sort values', async () => {
    const { app, queries } = buildRouter([
      { fragment: 'count(*)::int as total', rows: [{ total: 0 }] },
      { fragment: 'from auth.users u', rows: [] },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/users?sort=drop%20table', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const listQuery = queries.find((q) => q.sql.includes('limit $3 offset $4'));
    expect(listQuery?.sql).toContain('order by u.created_at desc');
    expect(listQuery?.sql).not.toContain('drop');
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
            last_seen_at: '2026-08-18T00:00:00Z',
            online: 1,
            chat_requests_7d: 5,
            pet_count: 1,
            friend_count: 0,
            memory_count: 3,
          },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request(`/users/${USER_ID}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      email: string;
      chatRequests7d: number;
      online: boolean;
      lastSeenAt: string | null;
    };
    expect(body.email).toBe('a@b.c');
    expect(body.chatRequests7d).toBe(5);
    expect(body.online).toBe(true);
    expect(body.lastSeenAt).toBe('2026-08-18T00:00:00Z');
  });

  it('suspends a user: status update, session+device revoke, kick + in-tx audit', async () => {
    const auditCalls: Array<{ text: string; params?: unknown[] }> = [];
    const { app, realtime } = buildRouter([
      {
        fragment: "set account_status = 'suspended'",
        rows: [],
        rowCount: 1,
      },
      {
        fragment: 'insert into admin_audit_log',
        rows: [],
        rowCount: 1,
        onQuery: (text, params) => auditCalls.push({ text, params }),
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request(`/users/${USER_ID}/suspend`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '测试' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(realtime.kickUser).toHaveBeenCalledWith(USER_ID);
    // 审计与动作同事务提交（审计 insert 失败 → 动作回滚）
    const audit = auditCalls.find((c) => c.text.includes('admin_audit_log'));
    expect(audit).toBeDefined();
    expect(audit!.params).toEqual(
      expect.arrayContaining(['a1', 'user.suspend', 'user', USER_ID, '测试']),
    );
  });

  it('suspend rejects non-string reason with 422 (not 500)', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request(`/users/${USER_ID}/suspend`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 12345 }),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid_input' });
  });

  it('suspend clears active_display_device_id so existing sessions are blocked', async () => {
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    const { app } = buildRouter([
      {
        fragment: "set account_status = 'suspended'",
        rows: [],
        rowCount: 1,
      },
      {
        fragment: 'update profiles',
        rows: [],
        rowCount: 1,
        onQuery: (text, params) => calls.push({ text, params }),
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request(`/users/${USER_ID}/suspend`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reason: '测试' }),
    });
    expect(res.status).toBe(200);
    // 撤销双保险锚点必须被清空（否则 requireAuth 的 active_display_device_id 校验放行存量会话）
    const clear = calls.find((c) => c.text.includes('active_display_device_id'));
    expect(clear).toBeDefined();
    expect(clear!.params).toEqual([USER_ID]);
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
    const res = await app.request(`/users/${USER_ID}/suspend`, {
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
    const res = await app.request(`/users/${USER_ID}/suspend`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid_input' });
  });

  it('restores a user with audit in the same transaction', async () => {
    const auditCalls: Array<{ text: string; params?: unknown[] }> = [];
    const { app } = buildRouter([
      {
        fragment: "set account_status = 'active'",
        rows: [],
        rowCount: 1,
      },
      {
        fragment: 'insert into admin_audit_log',
        rows: [],
        rowCount: 1,
        onQuery: (text, params) => auditCalls.push({ text, params }),
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request(`/users/${USER_ID}/restore`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const audit = auditCalls.find((c) => c.text.includes('admin_audit_log'));
    expect(audit).toBeDefined();
    expect(audit!.params).toEqual(expect.arrayContaining(['a1', 'user.restore', 'user', USER_ID]));
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
    const res = await app.request(`/users/${USER_ID}/restore`, {
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
    const res = await app.request(`/users/${USER_ID}/devices`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ deviceId: string; platform: string }>;
    };
    expect(body.items[0]!.deviceId).toBe('d1');
    expect(body.items[0]!.platform).toBe('windows');
  });

  it('revokes a device: owner lookup then claims-transaction revoke + in-tx audit', async () => {
    const { app, queries } = buildRouter([
      {
        fragment: 'select user_id from devices',
        rows: [{ user_id: 'u1' }],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/devices/22222222-2222-4222-8222-222222222222/revoke', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // 审计与撤销同事务：admin_audit_log insert 在事务内、commit 之前
    const auditIdx = queries.findIndex(
      (q) => q.sql.includes('insert into admin_audit_log') && q.params?.[1] === 'device.revoke',
    );
    expect(auditIdx).toBeGreaterThan(-1);
    expect(queries[auditIdx]!.params).toEqual(
      expect.arrayContaining([
        'a1',
        'device.revoke',
        'device',
        '22222222-2222-4222-8222-222222222222',
        'u1',
      ]),
    );
    const commitIdx = queries.map((q) => q.sql).lastIndexOf('commit');
    expect(commitIdx).toBeGreaterThan(auditIdx);
  });
});
