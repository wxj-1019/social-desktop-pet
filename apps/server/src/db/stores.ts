/**
 * pg 存储实现 —— SessionStore / users / devices（D-13 自建 Auth）。
 * 全部在事务内执行并设置 request.jwt.claims（RLS 纵深防御，9.1/0003）。
 */
import type pg from 'pg';

import type { RefreshSession, SessionStore } from '../auth/session.js';

import { rlsClaimsJson } from './pool.js';

export class PgSessionStore implements SessionStore {
  constructor(private readonly pool: pg.Pool) {}

  async save(session: RefreshSession): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        rlsClaimsJson(session.userId),
      ]);
      // 同一设备只保留最新会话（9.8 轮换语义）
      await client.query(
        'update refresh_sessions set revoked_at = now() where user_id = $1 and device_id = $2',
        [session.userId, session.deviceId],
      );
      await client.query(
        `insert into refresh_sessions (token_hash, user_id, device_id, expires_at, revoked_at)
         values ($1, $2, $3, to_timestamp($4 / 1000.0), $5)`,
        [session.tokenHash, session.userId, session.deviceId, session.expiresAt, session.revokedAt],
      );
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async load(tokenHash: string): Promise<RefreshSession | null> {
    const { rows } = await this.pool.query(
      `select token_hash, user_id, device_id,
              extract(epoch from expires_at) * 1000 as expires_at,
              revoked_at
       from refresh_sessions where token_hash = $1`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      tokenHash: row.token_hash as string,
      userId: String(row.user_id),
      deviceId: String(row.device_id),
      expiresAt: Number(row.expires_at),
      revokedAt: row.revoked_at ? Number(row.revoked_at) : null,
    };
  }

  async revokeToken(tokenHash: string): Promise<void> {
    await this.pool.query('update refresh_sessions set revoked_at = now() where token_hash = $1', [
      tokenHash,
    ]);
  }

  async rotateToken(tokenHash: string, nextSession: RefreshSession, now: number): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        rlsClaimsJson(nextSession.userId),
      ]);
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [tokenHash]);
      const consumed = await client.query(
        `update refresh_sessions
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
        `insert into refresh_sessions (token_hash, user_id, device_id, expires_at, revoked_at)
         values ($1, $2, $3, to_timestamp($4 / 1000.0), $5)`,
        [
          nextSession.tokenHash,
          nextSession.userId,
          nextSession.deviceId,
          nextSession.expiresAt,
          nextSession.revokedAt,
        ],
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

  async revokeDevice(userId: string, deviceId: string): Promise<void> {
    await this.pool.query(
      'update refresh_sessions set revoked_at = now() where user_id = $1 and device_id = $2',
      [userId, deviceId],
    );
  }

  async setActiveDisplayDevice(userId: string, deviceId: string): Promise<void> {
    await this.pool.query('update profiles set active_display_device_id = $2 where user_id = $1', [
      userId,
      deviceId,
    ]);
  }
}

export class PgUsersStore {
  constructor(private readonly pool: pg.Pool) {}

  async findByEmail(email: string): Promise<{
    id: string;
    passwordHash: string;
    accountStatus: 'active' | 'suspended';
  } | null> {
    const { rows } = await this.pool.query(
      'select id, password_hash, account_status from auth.users where email = $1',
      [email],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      passwordHash: String(row.password_hash),
      accountStatus: row.account_status === 'suspended' ? 'suspended' : 'active',
    };
  }

  async create(email: string, passwordHash: string): Promise<string> {
    const { rows } = await this.pool.query(
      'insert into auth.users (email, password_hash) values ($1, $2) returning id',
      [email, passwordHash],
    );
    return String(rows[0]?.id);
  }

  /** 登录时旧格式哈希升级写回（scrypt → argon2id 平滑迁移） */
  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.pool.query('update auth.users set password_hash = $2 where id = $1', [
      userId,
      passwordHash,
    ]);
  }
}

export class PgDevicesStore {
  constructor(private readonly pool: pg.Pool) {}

  /** 注册设备并激活（9.8：新设备激活 → 停用旧设备 refresh 会话 + 切换 active_display_device_id） */
  async register(
    userId: string,
    deviceId: string,
    platform: string,
    nickname: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        rlsClaimsJson(userId),
      ]);
      // profiles 行（devices.user_id 外键前提；已存在则不动，9.9）
      await client.query(
        `insert into profiles (user_id, nickname) values ($1, coalesce(nullif($2, ''), '新朋友'))
         on conflict (user_id) do nothing`,
        [userId, nickname],
      );
      await client.query(
        `insert into devices (device_id, user_id, platform) values ($1::uuid, $2, $3)
         on conflict (device_id) do nothing`,
        [deviceId, userId, platform],
      );
      await client.query(
        'update refresh_sessions set revoked_at = now() where user_id = $1 and device_id <> $2',
        [userId, deviceId],
      );
      await client.query(
        'update profiles set active_display_device_id = $1::uuid where user_id = $2',
        [deviceId, userId],
      );
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }
}
