/**
 * 免费点心路由 —— 9.4 可靠写入流程的完整实现。
 *
 * 1. 客户端提交 gift.send_free_snack（幂等键 user_id+device_id+client_event_id）
 * 2. 服务端从 JWT 取身份，不信任 Payload（9.4 第 2 步）
 * 3. 验证：幂等回执 → 拉黑/好友关系/每日配额（第 3 步）
 * 4. 同一事务：gift_events + 权威事件 + 双方 inbox + 幂等回执（第 4 步）
 * 5. 提交后 Realtime 通知（第 5 步；deliverEvent 内部处理）
 * 6. 响应与 WS 事件同一 eventId（第 6 步）
 */
import { type Hono } from 'hono';
import type pg from 'pg';

import { LIMITS } from '@pet/config';

import type { JwtService } from '../auth/jwt.js';
import { canSendGift } from '../lib/business-rules.js';
import { deliverEvent, flushPendingDeliveries } from '../lib/inbox.js';
import {
  findActiveFriendship,
  findOrCreateRoom,
  findReceipt,
  isBlocked,
  todayGiftCount,
} from '../lib/relationships.js';
import type { RealtimeServer } from '../realtime/ws.js';

import { requireAuth, type BusinessVariables } from './business.js';

/** 免费点心白名单（6.6：服务端白名单内；snack_id 不信任客户端任意值） */
export const FREE_SNACK_WHITELIST = ['snack_cookie', 'snack_candy', 'snack_tea'];

export interface GiftDeps {
  pool: pg.Pool;
  realtime: RealtimeServer;
  jwt: JwtService;
}

export function registerGiftRoutes(
  app: Hono<{ Variables: BusinessVariables }>,
  deps: GiftDeps,
): void {
  const auth = requireAuth(deps.jwt, deps.pool);

  app.post('/gift', auth, async (c) => {
    const userId = c.get('userId');
    const deviceId = c.get('deviceId');
    const { toUserId, snackId, clientEventId } = (await c.req.json()) as {
      toUserId?: string;
      snackId?: string;
      clientEventId?: string;
    };

    // 参数校验
    if (
      typeof toUserId !== 'string' ||
      typeof snackId !== 'string' ||
      typeof clientEventId !== 'string' ||
      clientEventId.length === 0
    ) {
      return c.json({ error: '缺少 toUserId/snackId/clientEventId' }, 400);
    }
    if (!FREE_SNACK_WHITELIST.includes(snackId)) {
      return c.json({ error: 'snackId 不在白名单' }, 400);
    }

    // 幂等：已有回执 → 直接返回重放结果（9.6）
    const existing = await findReceipt(deps.pool, userId, deviceId, clientEventId);
    if (existing) {
      return c.json({ replayed: true, result: existing.result });
    }

    const client = await deps.pool.connect();
    try {
      await client.query('begin');

      // 验证：拉黑 / 好友关系 / 每日配额（9.4 第 3 步）
      const blocked = await isBlocked(client, userId, toUserId);
      const friendship = await findActiveFriendship(client, userId, toUserId);
      const todayCount = await todayGiftCount(client, userId);
      const verdict = canSendGift({
        todayCount,
        dailyLimit: LIMITS.dailyGiftPerFriend,
        isActiveFriend: friendship !== null,
        isBlocked: blocked,
      });
      if (!verdict.ok) {
        await client.query('rollback');
        return c.json({ error: verdict.reason }, 403);
      }
      const roomId = await findOrCreateRoom(client, userId, toUserId);

      // 同一事务：gift_events + 权威事件 + 双方 inbox + 幂等回执
      const { rows: gRows } = await client.query(
        `insert into gift_events (from_user, to_user, snack_id, status)
         values ($1, $2, $3, 'sent') returning gift_id`,
        [userId, toUserId, snackId],
      );
      const giftId = String(gRows[0]?.gift_id);

      const delivered = await deliverEvent({
        pool: deps.pool,
        realtime: deps.realtime,
        client,
        roomId,
        type: 'gift.snack_sent',
        payload: { giftId, snackId, fromUserId: userId, toUserId },
        reliability: 'A',
        recipients: [userId, toUserId],
      });

      await client.query(
        `insert into command_receipts (user_id, device_id, client_event_id, event_id, result)
         values ($1, $2, $3, $4, $5::jsonb)`,
        [
          userId,
          deviceId,
          clientEventId,
          delivered.eventId,
          JSON.stringify({ giftId, eventId: delivered.eventId }),
        ],
      );

      await client.query('commit');
      // 提交后才推 WS（9.4：deliverEvent 外部事务不提前推送）
      flushPendingDeliveries(deps.realtime, delivered.pendingDeliveries);
      return c.json({ giftId, eventId: delivered.eventId, inboxSeq: delivered.inboxSeqs[userId] });
    } catch (e) {
      await client.query('rollback');
      return c.json({ error: (e as Error).message }, 500);
    } finally {
      client.release();
    }
  });
}
