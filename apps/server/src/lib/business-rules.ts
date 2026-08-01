/**
 * 业务规则纯函数 —— 可单测，不碰 DB。
 * SQL 薄层（routes/*）只做数据读写，判定逻辑集中在此。
 */
import { createHash, randomBytes } from 'node:crypto';

/** 好友配对规范化（3.1/9.9：user_low_id < user_high_id） */
export function normalizeFriendshipPair(a: string, b: string): { low: string; high: string } {
  return a < b ? { low: a, high: b } : { low: b, high: a };
}

/** 6.3 邀请 token：≥32 随机字节，URL-safe Base64；服务端只存 sha256 哈希 */
export function createInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface GiftQuotaInput {
  /** 该用户今天已送出的免费点心数 */
  todayCount: number;
  /** 每日免费点心上限（config 或默认值） */
  dailyLimit: number;
  /** 目标是否为 active 好友 */
  isActiveFriend: boolean;
  /** 双方是否存在拉黑 */
  isBlocked: boolean;
}

export type GiftQuotaResult = { ok: true } | { ok: false; reason: string };

/** 9.4 第 3 步：验证关系/拉黑/每日配额（幂等键在路由层单独校验） */
export function canSendGift(input: GiftQuotaInput): GiftQuotaResult {
  if (input.isBlocked) return { ok: false, reason: 'blocked' };
  if (!input.isActiveFriend) return { ok: false, reason: 'not_friend' };
  if (input.todayCount >= input.dailyLimit) return { ok: false, reason: 'daily_limit' };
  return { ok: true };
}

/** 9.5 /sync 分页上限 */
export const SYNC_PAGE_LIMIT = 200;
