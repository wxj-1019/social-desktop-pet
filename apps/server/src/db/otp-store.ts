/**
 * OTP 存储 pg 实现 —— 13.2（otp_codes 表）。
 * 事务粒度单查询（每次操作独立），避免连接占用；校验/消费为应用层流程。
 */
import type pg from 'pg';

import type { OtpCodeRow, OtpCodeStore } from '../auth/otp.js';

export class PgOtpStore implements OtpCodeStore {
  constructor(private readonly pool: pg.Pool) {}

  async create(email: string, codeHash: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      `insert into otp_codes (email, code_hash, expires_at) values ($1, $2, $3)`,
      [email, codeHash, expiresAt],
    );
  }

  async findLatest(email: string): Promise<OtpCodeRow | null> {
    const { rows } = await this.pool.query(
      `select otp_id, code_hash, attempts, expires_at, consumed_at
       from otp_codes where email = $1 order by created_at desc limit 1`,
      [email],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      otpId: String(row.otp_id),
      codeHash: String(row.code_hash),
      attempts: Number(row.attempts),
      expiresAt: row.expires_at as Date,
      consumedAt: row.consumed_at as Date | null,
    };
  }

  async countPending(email: string): Promise<number> {
    const { rows } = await this.pool.query(
      `select count(*)::int as n from otp_codes
       where email = $1 and consumed_at is null and expires_at > now()`,
      [email],
    );
    return Number(rows[0]?.n ?? 0);
  }

  async incrementAttempts(otpId: string): Promise<void> {
    await this.pool.query(`update otp_codes set attempts = attempts + 1 where otp_id = $1`, [
      otpId,
    ]);
  }

  /** 乐观消费：仅当未消费时置 consumed_at；返回是否抢到（并发安全） */
  async consumeIfUnused(otpId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `update otp_codes set consumed_at = now()
       where otp_id = $1 and consumed_at is null`,
      [otpId],
    );
    return (rowCount ?? 0) > 0;
  }

  async cleanup(email: string): Promise<void> {
    await this.pool.query(
      `delete from otp_codes where email = $1 and (consumed_at is not null or expires_at < now())`,
      [email],
    );
  }
}
