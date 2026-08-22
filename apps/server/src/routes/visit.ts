/**
 * 拜访路由 —— 基础版。
 *
 * 9.8 撤销双保险的应用层校验点：每次拜访落库前校验
 *   active_display_device_id = 当前设备（旧设备被停用后拒绝云端功能）；
 * 9.4 可靠写入：visits + 权威事件 + 双方 inbox + WS 通知。
 */
import { type Hono } from 'hono';
import type pg from 'pg';

import { LIMITS } from '@pet/config';

import type { JwtService } from '../auth/jwt.js';
import { deliverEvent, flushPendingDeliveries } from '../lib/inbox.js';
import { logger } from '../lib/logger.js';
import {
  advanceBond,
  findActiveFriendship,
  findOrCreateRoom,
  isBlocked,
} from '../lib/relationships.js';
import type { RealtimeServer } from '../realtime/ws.js';

import { requireAuth, type BusinessVariables } from './business.js';

const VISIT_TYPES = ['wave', 'share_snack', 'leave_message'] as const;

export interface VisitDeps {
  pool: pg.Pool;
  realtime: RealtimeServer;
  jwt: JwtService;
}

export function registerVisitRoutes(
  app: Hono<{ Variables: BusinessVariables }>,
  deps: VisitDeps,
): void {
  const auth = requireAuth(deps.jwt, deps.pool);

  app.post('/visit', auth, async (c) => {
    const userId = c.get('userId');
    const deviceId = c.get('deviceId');
    const { toUserId, type } = (await c.req.json()) as { toUserId?: string; type?: string };

    if (
      typeof toUserId !== 'string' ||
      !VISIT_TYPES.includes(type as (typeof VISIT_TYPES)[number])
    ) {
      return c.json({ error: '缺少 toUserId 或 type 非法（wave/share_snack/leave_message）' }, 400);
    }

    const client = await deps.pool.connect();
    try {
      await client.query('begin');

      // 9.8 撤销双保险：应用层校验 active_display_device_id
      const { rows: profRows } = await client.query(
        'select active_display_device_id from profiles where user_id = $1',
        [userId],
      );
      const activeDevice = profRows[0]?.active_display_device_id;
      if (activeDevice !== null && String(activeDevice) !== deviceId) {
        await client.query('rollback');
        return c.json({ error: 'device_revoked' }, 403);
      }

      // 关系校验：active 好友 + 未拉黑
      if (await isBlocked(client, userId, toUserId)) {
        await client.query('rollback');
        return c.json({ error: 'blocked' }, 403);
      }
      const friendship = await findActiveFriendship(client, userId, toUserId);
      if (!friendship) {
        await client.query('rollback');
        return c.json({ error: 'not_friend' }, 403);
      }

      const roomId = await findOrCreateRoom(client, userId, toUserId);

      // 7.4 羁绊推进 + visits.bond_id 回填（0005 预留的 nullable 列由此接通）
      const bond = await advanceBond(client, friendship);

      // 6.5 配额：每位好友每天最多 N 次可见拜访事件（此前 LIMITS 配置从未执行）
      const { rows: cntRows } = await client.query(
        `select count(*)::int as cnt from visits
         where from_user = $1 and to_user = $2
           and created_at >= date_trunc('day', now())`,
        [userId, toUserId],
      );
      const todayVisits = Number(cntRows[0]?.cnt ?? 0);
      if (todayVisits >= LIMITS.visitsPerFriendPerDay) {
        await client.query('rollback');
        return c.json({ error: 'visit_limit' }, 429);
      }

      // visits + 权威事件（A 类，双方 inbox）
      const { rows: vRows } = await client.query(
        `insert into visits (from_user, to_user, type, status, bond_id)
         values ($1, $2, $3, 'arrived', $4) returning visit_id`,
        [userId, toUserId, type, bond.bond_id],
      );
      const visitId = String(vRows[0]?.visit_id);

      const delivered = await deliverEvent({
        pool: deps.pool,
        realtime: deps.realtime,
        client,
        roomId,
        type: 'visit.arrived',
        payload: { visitId, type, fromUserId: userId, toUserId },
        reliability: 'A',
        recipients: [userId, toUserId],
      });

      await client.query('commit');
      // 提交后才推 WS（9.4：deliverEvent 外部事务不提前推送）
      flushPendingDeliveries(deps.realtime, delivered.pendingDeliveries);
      return c.json({
        visitId,
        eventId: delivered.eventId,
        bond: { stage: bond.stage, progress: bond.progress, stageUpgraded: bond.stageUpgraded },
      });
    } catch (e) {
      await client.query('rollback');
      logger.error('visit_failed', { error: (e as Error).message });
      return c.json({ error: 'internal_error' }, 500);
    } finally {
      client.release();
    }
  });
}
