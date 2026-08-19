/**
 * 管理后台 pg 存储 —— admin_sessions / admin_users（D-13 自建 Auth 同款模式）。
 * 管理员域表无 RLS（服务器统一管理），无需 set claims。
 */
import type pg from 'pg';

import type { AdminSession, AdminSessionStore } from '../auth/admin-session.js';

export class PgAdminSessionStore implements AdminSessionStore {
  constructor(private readonly pool: pg.Pool) {}

  async save(session: AdminSession): Promise<void> {
    await this.pool.query(
      `insert into admin_sessions (token_hash, admin_id, expires_at, revoked_at)
       values ($1, $2, to_timestamp($3 / 1000.0), $4)
       on conflict (token_hash) do update set revoked_at = excluded.revoked_at`,
      [session.tokenHash, session.adminId, session.expiresAt, session.revokedAt],
    );
  }

  async load(tokenHash: string): Promise<AdminSession | null> {
    const { rows } = await this.pool.query(
      `select token_hash, admin_id,
              extract(epoch from expires_at) * 1000 as expires_at,
              revoked_at
       from admin_sessions where token_hash = $1`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      tokenHash: row.token_hash as string,
      adminId: String(row.admin_id),
      expiresAt: Number(row.expires_at),
      revokedAt: row.revoked_at ? Number(row.revoked_at) : null,
    };
  }

  async rotateToken(tokenHash: string, next: AdminSession, now: number): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [tokenHash]);
      // 会话活跃标记（会话盘点/闲置管理的数据基础；rotate 是唯一稳定活跃信号）
      await client.query('update admin_sessions set last_seen_at = now() where token_hash = $1', [
        tokenHash,
      ]);
      const consumed = await client.query(
        `update admin_sessions
         set revoked_at = to_timestamp($2 / 1000.0)
         where token_hash = $1 and revoked_at is null
           and expires_at > to_timestamp($2 / 1000.0)
         returning token_hash`,
        [tokenHash, now],
      );
      if ((consumed.rowCount ?? 0) === 0) {
        await client.query('commit');
        return false;
      }
      await client.query(
        `insert into admin_sessions (token_hash, admin_id, expires_at, revoked_at)
         values ($1, $2, to_timestamp($3 / 1000.0), $4)`,
        [next.tokenHash, next.adminId, next.expiresAt, next.revokedAt],
      );
      await client.query('commit');
      return true;
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async revokeToken(tokenHash: string): Promise<void> {
    await this.pool.query('update admin_sessions set revoked_at = now() where token_hash = $1', [
      tokenHash,
    ]);
  }

  async revokeAllForAdmin(adminId: string): Promise<void> {
    await this.pool.query(
      'update admin_sessions set revoked_at = now() where admin_id = $1 and revoked_at is null',
      [adminId],
    );
  }
}

export interface AdminUserRow {
  id: string;
  email: string;
  passwordHash: string;
  status: 'active' | 'disabled';
  lastLoginAt: number | null;
  createdAt: number;
}

export class PgAdminUserStore {
  constructor(private readonly pool: pg.Pool) {}

  async findByEmail(email: string): Promise<AdminUserRow | null> {
    const { rows } = await this.pool.query(
      `select id, email, password_hash, status,
              extract(epoch from last_login_at) * 1000 as last_login_at,
              extract(epoch from created_at) * 1000 as created_at
       from admin_users where email = $1`,
      [email],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      email: row.email as string,
      passwordHash: row.password_hash as string,
      status: row.status as 'active' | 'disabled',
      lastLoginAt: row.last_login_at ? Number(row.last_login_at) : null,
      createdAt: Number(row.created_at),
    };
  }

  async getById(id: string): Promise<Pick<AdminUserRow, 'id' | 'email' | 'status'> | null> {
    const { rows } = await this.pool.query(
      'select id, email, status from admin_users where id = $1',
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      email: row.email as string,
      status: row.status as 'active' | 'disabled',
    };
  }

  /** 管理员列表（/admin/admins 页面） */
  async list(): Promise<
    Array<{
      id: string;
      email: string;
      status: 'active' | 'disabled';
      lastLoginAt: string | null;
      createdAt: string;
    }>
  > {
    const { rows } = await this.pool.query(
      `select id, email, status, last_login_at, created_at
       from admin_users order by created_at asc`,
    );
    return rows.map((r) => ({
      id: String(r.id),
      email: r.email as string,
      status: r.status as 'active' | 'disabled',
      lastLoginAt: r.last_login_at as string | null,
      createdAt: r.created_at as string,
    }));
  }

  /** 改密校验用：按 id 取密码哈希 */
  async getWithHash(
    id: string,
  ): Promise<{ id: string; passwordHash: string; status: 'active' | 'disabled' } | null> {
    const { rows } = await this.pool.query(
      'select id, password_hash, status from admin_users where id = $1',
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      passwordHash: row.password_hash as string,
      status: row.status as 'active' | 'disabled',
    };
  }

  async create(email: string, passwordHash: string): Promise<string> {
    const { rows } = await this.pool.query(
      `insert into admin_users (email, password_hash) values ($1, $2) returning id`,
      [email, passwordHash],
    );
    return String(rows[0]!.id);
  }

  async setStatus(id: string, status: 'active' | 'disabled'): Promise<void> {
    await this.pool.query('update admin_users set status = $2, updated_at = now() where id = $1', [
      id,
      status,
    ]);
  }

  async recordLogin(id: string): Promise<void> {
    await this.pool.query('update admin_users set last_login_at = now() where id = $1', [id]);
  }
}
