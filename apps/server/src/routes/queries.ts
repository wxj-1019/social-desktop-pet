/**
 * 查询路由 —— 客户端基础数据（登录后首屏）。
 * GET /me：当前用户资料 + 设备状态（9.8 active_display_device_id）
 * GET /friends：active 好友列表（昵称 + 宠物名；供好友页渲染）
 */
import { type Hono } from 'hono';
import type pg from 'pg';

import type { JwtService } from '../auth/jwt.js';
import type { RealtimeServer } from '../realtime/ws.js';

import { requireAuth } from './business.js';

export interface QueryDeps {
  pool: pg.Pool;
  jwt: JwtService;
  /** Presence 快照查询（/friends 附在线标识，9.2） */
  realtime: RealtimeServer;
}

export function registerQueryRoutes(
  app: Hono<{ Variables: { userId: string; deviceId: string } }>,
  deps: QueryDeps,
): void {
  const auth = requireAuth(deps.jwt, deps.pool);

  app.get('/me', auth, async (c) => {
    const userId = c.get('userId');
    const deviceId = c.get('deviceId');
    const { rows } = await deps.pool.query(
      `select p.user_id, p.nickname, p.avatar, p.active_display_device_id,
              d.platform, d.app_version, d.last_seen_at
       from profiles p
       join devices d on d.device_id = $2::uuid
       where p.user_id = $1`,
      [userId, deviceId],
    );
    const row = rows[0];
    if (!row) return c.json({ error: 'profile 不存在' }, 404);
    return c.json({
      userId,
      nickname: String(row.nickname),
      avatar: row.avatar ?? null,
      activeDisplayDeviceId: row.active_display_device_id
        ? String(row.active_display_device_id)
        : null,
      device: {
        deviceId,
        platform: String(row.platform),
        appVersion: row.app_version ?? null,
        lastSeenAt: (row.last_seen_at as Date).toISOString(),
      },
    });
  });

  app.get('/friends', auth, async (c) => {
    const userId = c.get('userId');
    const { rows } = await deps.pool.query(
      `select case
                when f.user_low_id = $1 then f.user_high_id
                else f.user_low_id
              end as friend_user_id,
              p.nickname, p.avatar,
              f.friendship_id, f.accepted_at
       from friendships f
       join profiles p on p.user_id = case
                when f.user_low_id = $1 then f.user_high_id
                else f.user_low_id
              end
       where f.status = 'active' and (f.user_low_id = $1 or f.user_high_id = $1)
       order by f.accepted_at`,
      [userId],
    );
    return c.json({
      friends: rows.map((r) => ({
        userId: String(r.friend_user_id),
        nickname: String(r.nickname),
        avatar: r.avatar ?? null,
        friendshipId: String(r.friendship_id),
        acceptedAt: (r.accepted_at as Date).toISOString(),
        // 9.2 Presence 快照（内存在线态；后续变化由 presence.changed 事件增量更新）
        online: deps.realtime.isOnline(String(r.friend_user_id)),
      })),
    });
  });
}
