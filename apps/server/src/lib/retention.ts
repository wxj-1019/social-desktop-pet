/**
 * 保留期清理（11.4）—— 服务端定时 sweep。
 * 此前 RETENTION 策略只配置未执行（常量零消费方，隐私承诺未落地）：
 * - chat_messages：chatHistoryDays（90 天）
 * - events B 类（短期，expires_at 过期即清；A 类永久保留，9.5 语义）
 * - refresh_sessions：过期 30 天后清理（轮换撤销行保留取证窗口）
 * - command_receipts / memory_audit_log：180 天上限
 * 幂等可重入（delete 按时间条件）；每 24h 由服务入口触发。
 */
import { RETENTION } from '@pet/config';
import type pg from 'pg';

/** 幂等回执 / 审计日志保留天数（无专门 RETENTION 条目，取 180 天保守上限） */
const STALE_RECORD_DAYS = 180;
/** 已过期 refresh session 的取证保留窗口（9.8 防重放：轮换后旧 token 不可用即可清） */
const EXPIRED_SESSION_RETENTION_DAYS = 30;

export interface RetentionSweepResult {
  removedChatMessages: number;
  removedEphemeralEvents: number;
  removedExpiredSessions: number;
  removedStaleReceipts: number;
  removedStaleAudit: number;
}

export async function runRetentionSweep(pool: pg.Pool): Promise<RetentionSweepResult> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    // 11.4 聊天记录保留期（90 天）
    const chat = await client.query(
      `delete from chat_messages where created_at < now() - make_interval(days => $1)`,
      [RETENTION.chatHistoryDays],
    );
    // B 类短期事件：expires_at 过期即清（9.5）；A 类永久保留
    const ephemeral = await client.query(
      `delete from events where reliability = 'B' and expires_at is not null and expires_at < now()`,
    );
    // 过期 refresh session：留 30 天取证窗口后清理（含已轮换撤销行）
    const sessions = await client.query(
      `delete from refresh_sessions where expires_at < now() - make_interval(days => $1)`,
      [EXPIRED_SESSION_RETENTION_DAYS],
    );
    // 幂等回执 / 审计日志：180 天上限（防无界膨胀）
    const receipts = await client.query(
      `delete from command_receipts where created_at < now() - make_interval(days => $1)`,
      [STALE_RECORD_DAYS],
    );
    const audit = await client.query(
      `delete from memory_audit_log where created_at < now() - make_interval(days => $1)`,
      [STALE_RECORD_DAYS],
    );
    await client.query('commit');
    return {
      removedChatMessages: chat.rowCount ?? 0,
      removedEphemeralEvents: ephemeral.rowCount ?? 0,
      removedExpiredSessions: sessions.rowCount ?? 0,
      removedStaleReceipts: receipts.rowCount ?? 0,
      removedStaleAudit: audit.rowCount ?? 0,
    };
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}
