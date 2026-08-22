/**
 * /sync 路由 —— 9.5 慢路径补齐（A 类事件，理论上可永久补齐）。
 *
 * - 客户端发现序列缺口或离线超过快速路径窗口（默认 72h）时调用
 * - 单次最多返回 SYNC_PAGE_LIMIT（200）条，客户端循环调用直到追上
 * - B 类短期事件过期后服务端直接推进游标，不返回内容
 * - 同时推进 device_cursors（9.5 游标策略）
 * - 不传 afterInboxSeq（或空）→ 从 device_cursors 恢复上次游标（P1-6：
 *   客户端重启后增量同步，不再从 0 全量重放历史事件）
 */
import { type Hono } from 'hono';
import type pg from 'pg';

import type { JwtService } from '../auth/jwt.js';
import { SYNC_PAGE_LIMIT } from '../lib/business-rules.js';
import { logger } from '../lib/logger.js';

import { requireAuth, type BusinessVariables } from './business.js';

export interface SyncDeps {
  pool: pg.Pool;
  jwt: JwtService;
}

export function registerSyncRoutes(
  app: Hono<{ Variables: BusinessVariables }>,
  deps: SyncDeps,
): void {
  const auth = requireAuth(deps.jwt, deps.pool);

  app.get('/sync', auth, async (c) => {
    const userId = c.get('userId');
    const deviceId = c.get('deviceId');
    const rawAfter = c.req.query('afterInboxSeq');
    if (rawAfter !== undefined && (!/^\d+$/.test(rawAfter) || Number(rawAfter) < 0)) {
      return c.json({ error: 'afterInboxSeq 非法' }, 400);
    }

    // 单事务：查增量 + 清理过期 B 类 + 推进游标（9.5）
    const client = await deps.pool.connect();
    try {
      await client.query('begin');

      // P1-6：未传游标 → 从 device_cursors 恢复（重启增量同步；无游标则 0）
      let after = 0;
      if (rawAfter !== undefined) {
        after = Number(rawAfter);
      } else {
        const { rows: cur } = await client.query(
          'select last_inbox_seq from device_cursors where device_id = $1',
          [deviceId],
        );
        after = cur[0] ? Number(cur[0].last_inbox_seq) : 0;
      }

      // 过期 B 类：直接删除并推进（不返回内容，9.5）
      await client.query(
        `delete from user_inbox where user_id = $1
         and inbox_seq in (
           select i.inbox_seq from user_inbox i
           join events e on e.event_id = i.event_id
           where i.user_id = $1 and e.reliability = 'B' and e.expires_at < now()
         )`,
        [userId],
      );

      const { rows } = await client.query(
        `select i.inbox_seq,
                e.event_id, e.room_id, e.room_seq, e.type, e.payload, e.reliability, e.created_at
         from user_inbox i
         join events e on e.event_id = i.event_id
         where i.user_id = $1 and i.inbox_seq > $2
         order by i.inbox_seq
         limit $3`,
        [userId, after, SYNC_PAGE_LIMIT],
      );

      const events = rows.map((r) => ({
        inboxSeq: Number(r.inbox_seq),
        event: {
          eventId: String(r.event_id),
          roomId: r.room_id ? String(r.room_id) : null,
          roomSeq: r.room_seq ? Number(r.room_seq) : null,
          type: String(r.type),
          payload: r.payload,
          reliability: String(r.reliability),
          serverTimestamp: (r.created_at as Date).toISOString(),
        },
      }));

      // 推进游标（9.5）
      const nextSeq = events.length > 0 ? Number(events[events.length - 1]?.inboxSeq) : after;
      await client.query(
        `insert into device_cursors (device_id, last_inbox_seq)
         values ($1, $2)
         on conflict (device_id) do update set last_inbox_seq = $2, updated_at = now()`,
        [deviceId, nextSeq],
      );

      await client.query('commit');
      return c.json({ events, nextInboxSeq: nextSeq, hasMore: events.length >= SYNC_PAGE_LIMIT });
    } catch (e) {
      await client.query('rollback');
      logger.error('sync_failed', { error: (e as Error).message });
      return c.json({ error: 'internal_error' }, 500);
    } finally {
      client.release();
    }
  });
}
