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
  const app = createAdminUsersRouter({
    pool: pool as never,
    jwt: JWT,
    adminUsers: adminUsers as never,
    realtime: { kickUser: vi.fn() } as never,
    writeAudit: vi.fn(async () => undefined) as never,
  });
  return { app, pool };
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
});
