import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import type { RefreshSession } from '../auth/session.js';

import { PgSessionStore } from './stores.js';

const nextSession: RefreshSession = {
  tokenHash: 'next-hash',
  userId: 'u1',
  deviceId: 'dev-1',
  expiresAt: 2_000_000,
  revokedAt: null,
};

function makePool(updateRowCount: number) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('returning token_hash')) return { rows: [], rowCount: updateRowCount };
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  const client = { query, release };
  const pool = { connect: vi.fn(async () => client) } as unknown as pg.Pool;
  return { pool, query, release };
}

describe('PgSessionStore atomic refresh rotation', () => {
  it('locks, conditionally revokes the old token, and inserts the next token in one transaction', async () => {
    const { pool, query, release } = makePool(1);
    const store = new PgSessionStore(pool);

    await expect(store.rotateToken('old-hash', nextSession, 1_000_000)).resolves.toBe(true);

    expect(query.mock.calls.some(([sql]) => String(sql).includes('pg_advisory_xact_lock'))).toBe(
      true,
    );
    expect(
      query.mock.calls.some(
        ([sql]) =>
          String(sql).includes('revoked_at is null') && String(sql).includes('expires_at >'),
      ),
    ).toBe(true);
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes('insert into refresh_sessions')),
    ).toBe(true);
    expect(query).toHaveBeenCalledWith('commit');
    expect(release).toHaveBeenCalled();
  });

  it('does not insert a next token when the conditional revoke loses the race', async () => {
    const { pool, query } = makePool(0);
    const store = new PgSessionStore(pool);

    await expect(store.rotateToken('old-hash', nextSession, 1_000_000)).resolves.toBe(false);

    expect(
      query.mock.calls.some(([sql]) => String(sql).includes('insert into refresh_sessions')),
    ).toBe(false);
    expect(query).toHaveBeenCalledWith('commit');
  });

  it('revokeToken updates only the matching token hash', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 }));
    const pool = { query } as unknown as pg.Pool;
    const store = new PgSessionStore(pool);

    await store.revokeToken('old-hash');

    expect(query).toHaveBeenCalledWith(
      'update refresh_sessions set revoked_at = now() where token_hash = $1',
      ['old-hash'],
    );
  });
});
