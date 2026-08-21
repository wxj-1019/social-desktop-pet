/**
 * Presence 广播 —— 9.2 在线状态闭环。
 *
 * - onPresenceChanged：用户上线/下线 → 查 active 好友 → deliverEvent 投递
 *   `presence.changed`（B 类短期可靠 + expiresAt=ephemeralActionEventHours，
 *   过期由 retention sweep 与 /sync 惰性清理——B 类机制的首个真实生产者）。
 * - onAuthenticated：每次连接鉴权成功刷新 devices.last_seen_at（修复此前
 *   只在设备注册时写一次、在线口径失真的问题）。
 *
 * 失败只记日志不抛（presence 是低优先级通知，不阻塞连接生命周期）。
 */
import type pg from 'pg';

import { DEFAULT_FEATURE_FLAGS, RETENTION } from '@pet/config';

import { deliverEvent } from '../lib/inbox.js';
import { logger } from '../lib/logger.js';

import type { RealtimeServer } from './ws.js';

export interface PresenceHooks {
  onPresenceChanged: (userId: string, online: boolean) => void;
  onAuthenticated: (userId: string, deviceId: string | null) => void;
}

/** 好友查询（单好友槽 MVP：全量 active 好友；多好友后数量仍受好友数约束） */
const FRIEND_IDS_SQL = `
  select case when f.user_low_id = $1 then f.user_high_id else f.user_low_id end as friend_user_id
  from friendships f
  where f.status = 'active' and (f.user_low_id = $1 or f.user_high_id = $1)`;

/** 按连接刷新 last_seen_at（设备维度；连接建立即视为在线活动） */
async function touchDevice(pool: pg.Pool, userId: string, deviceId: string | null): Promise<void> {
  if (!deviceId) return;
  try {
    await pool.query(
      'update devices set last_seen_at = now() where device_id = $1 and user_id = $2',
      [deviceId, userId],
    );
  } catch (e) {
    logger.warn('presence.touch_device_failed', { userId, error: (e as Error).message });
  }
}

async function broadcastPresence(
  pool: pg.Pool,
  realtime: RealtimeServer,
  userId: string,
  online: boolean,
): Promise<void> {
  try {
    // P1-7：presence 广播开关（默认开；关闭后仅本地在线态，不做好友侧广播）
    if (!DEFAULT_FEATURE_FLAGS.presenceBroadcast) return;
    const { rows } = await pool.query(FRIEND_IDS_SQL, [userId]);
    const recipients = rows.map((r) => String(r.friend_user_id));
    if (recipients.length === 0) return;
    const expiresAt = new Date(Date.now() + RETENTION.ephemeralActionEventHours * 3_600_000);
    await deliverEvent({
      pool,
      realtime,
      roomId: null,
      type: 'presence.changed',
      payload: { userId, online },
      reliability: 'B',
      expiresAt,
      recipients,
    });
  } catch (e) {
    logger.warn('presence.broadcast_failed', {
      userId,
      online,
      error: (e as Error).message,
    });
  }
}

/** 组装 RealtimeServer 需要的 presence 钩子 */
export function createPresenceHooks(pool: pg.Pool, realtime: RealtimeServer): PresenceHooks {
  return {
    onPresenceChanged: (userId, online) => void broadcastPresence(pool, realtime, userId, online),
    onAuthenticated: (userId, deviceId) => void touchDevice(pool, userId, deviceId),
  };
}
