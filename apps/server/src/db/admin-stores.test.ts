import { describe, expect, it, vi } from 'vitest';

import { PgAdminSessionStore, PgAdminUserStore } from './admin-stores.js';

function fakePool(rows: unknown[] = []) {
  return { query: vi.fn(async (..._args: unknown[]) => ({ rows, rowCount: rows.length })) };
}

describe('PgAdminUserStore', () => {
  it('findByEmail returns mapped row', async () => {
    const pool = fakePool([
      {
        id: 'a1',
        email: 'admin@pet.dev',
        password_hash: 'h',
        status: 'active',
        last_login_at: null,
        created_at: '2026-08-18T00:00:00Z',
      },
    ]);
    const store = new PgAdminUserStore(pool as never);
    const user = await store.findByEmail('admin@pet.dev');
    expect(user).toMatchObject({ id: 'a1', email: 'admin@pet.dev', status: 'active' });
    expect(pool.query.mock.calls[0]![1]).toEqual(['admin@pet.dev']);
  });

  it('findByEmail returns null when absent', async () => {
    const store = new PgAdminUserStore(fakePool([]) as never);
    expect(await store.findByEmail('x@y.z')).toBeNull();
  });

  it('create inserts email + hash and returns id', async () => {
    const pool = fakePool([{ id: 'a2' }]);
    const store = new PgAdminUserStore(pool as never);
    const id = await store.create('a@b.c', 'phc-hash');
    expect(id).toBe('a2');
    expect(pool.query.mock.calls[0]![1]).toEqual(['a@b.c', 'phc-hash']);
  });

  it('setStatus and recordLogin issue the right updates', async () => {
    const pool = fakePool();
    const store = new PgAdminUserStore(pool as never);
    await store.setStatus('a1', 'disabled');
    await store.recordLogin('a1');
    const [s1] = pool.query.mock.calls[0] as [string, unknown[]];
    const [s2] = pool.query.mock.calls[1] as [string, unknown[]];
    expect(s1).toContain('update admin_users set status');
    expect(s2).toContain('last_login_at');
  });
});

describe('PgAdminSessionStore', () => {
  it('rotateToken marks last_seen_at in the same transaction（会话活跃数据基础）', async () => {
    const sqls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        sqls.push(sql);
        return { rowCount: 1, rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };
    const store = new PgAdminSessionStore(pool as never);
    const rotated = await store.rotateToken(
      'h1',
      { tokenHash: 'h2', adminId: 'a1', expiresAt: 1, revokedAt: null },
      0,
    );
    expect(rotated).toBe(true);
    expect(sqls.some((s) => s.includes('last_seen_at'))).toBe(true);
    expect(sqls.at(-1)).toBe('commit');
    expect(client.release).toHaveBeenCalled();
  });
});
