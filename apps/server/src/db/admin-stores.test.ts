import { describe, expect, it, vi } from 'vitest';

import { PgAdminUserStore } from './admin-stores.js';

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
