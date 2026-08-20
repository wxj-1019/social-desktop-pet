import { describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';

import { createAdminMemoriesRouter } from './admin-memories.js';

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
    app: createAdminMemoriesRouter({
      pool: pool as never,
      jwt: JWT,
      adminUsers: adminUsers as never,
    }),
    pool,
  };
}

describe('admin memories routes', () => {
  it('returns memory confirmation queue stats', async () => {
    const { app } = buildRouter([
      {
        fragment: 'as pending',
        rows: [{ pending: 12, confirmed_7d: 30, rejected_7d: 5 }],
      },
      {
        fragment: 'group by category',
        rows: [
          { category: 'preference', count: 7 },
          { category: 'fact', count: 5 },
        ],
      },
      {
        fragment: 'group by sensitivity',
        rows: [
          { sensitivity: 'medium', count: 8 },
          { sensitivity: 'high', count: 4 },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/memories/queue-stats', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pending: number;
      confirmed7d: number;
      rejected7d: number;
      byCategory: Array<{ category: string; count: number }>;
      bySensitivity: Array<{ sensitivity: string; count: number }>;
    };
    expect(body.pending).toBe(12);
    expect(body.confirmed7d).toBe(30);
    expect(body.rejected7d).toBe(5);
    expect(body.byCategory[0]!.category).toBe('preference');
    expect(body.bySensitivity[0]!.sensitivity).toBe('medium');
  });

  it('requires admin token', async () => {
    const { app } = buildRouter([]);
    const userToken = await JWT.sign({ sub: 'u1', deviceId: 'dev-1' });
    const res = await app.request('/memories/queue-stats', {
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(401);
  });
});
