/**
 * 拜访路由 —— 基础版。
 *
 * 9.8 撤销双保险的应用层校验点：每次拜访落库前校验
 *   active_display_device_id = 当前设备（旧设备被停用后拒绝云端功能）；
 * 9.4 可靠写入：visits + 权威事件 + 双方 inbox + WS 通知。
 */
import { type Hono } from 'hono';
import type pg from 'pg';

import type { JwtService } from '../auth/jwt.js';
import { deliverEvent } from '../lib/inbox.js';
import { findActiveFriendship, findOrCreateRoom, isBlocked } from '../lib/relationships.js';
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
  const auth = requireAuth(deps.jwt);

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

      // visits + 权威事件（A 类，双方 inbox）
      const { rows: vRows } = await client.query(
        `insert into visits (from_user, to_user, type, status)
         values ($1, $2, $3, 'arrived') returning visit_id, bond_id`,
        [userId, toUserId, type],
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
      return c.json({ visitId, eventId: delivered.eventId });
    } catch (e) {
      await client.query('rollback');
      return c.json({ error: (e as Error).message }, 500);
    } finally {
      client.release();
    }
  });
}
