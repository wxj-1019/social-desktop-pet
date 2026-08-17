/**
 * 好友邀请路由 —— 6.3。
 * 创建：≥32 随机字节 token（URL-safe Base64），服务端只存 sha256 哈希，7 天过期、一次使用。
 * 接受：校验哈希 + pending + 未过期 → 事务：标记 used + 建好友关系（low/high 规范化）+ 房间 + 双方 inbox。
 * 邀请链接不含邮箱/私人数据（6.3 安全要求）。
 */
import { type Hono } from 'hono';
import type pg from 'pg';

import type { JwtService } from '../auth/jwt.js';
import { createInviteToken, hashToken, normalizeFriendshipPair } from '../lib/business-rules.js';
import { deliverEvent } from '../lib/inbox.js';
import { findActiveFriendship, findOrCreateRoom, isBlocked } from '../lib/relationships.js';
import type { RealtimeServer } from '../realtime/ws.js';

import { requireAuth, type BusinessVariables } from './business.js';

export interface InviteDeps {
  pool: pg.Pool;
  realtime: RealtimeServer;
  jwt: JwtService;
}

export function registerInviteRoutes(
  app: Hono<{ Variables: BusinessVariables }>,
  deps: InviteDeps,
): void {
  const auth = requireAuth(deps.jwt, deps.pool);

  // 创建邀请（6.3）
  app.post('/invite', auth, async (c) => {
    const userId = c.get('userId');
    const { token, tokenHash } = createInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    const { rows } = await deps.pool.query(
      `insert into friend_invites (inviter_id, token_hash, expires_at, status)
       values ($1, $2, $3, 'pending')
       returning invite_id`,
      [userId, tokenHash, expiresAt],
    );
    return c.json({ inviteId: rows[0]?.invite_id, token, expiresAt: expiresAt.toISOString() }, 201);
  });

  // 接受邀请（6.3：重新校验登录用户 + 邀请状态；token 一次性）
  app.post('/invite/accept', auth, async (c) => {
    const userId = c.get('userId');
    const { token } = (await c.req.json()) as { token?: string };
    if (typeof token !== 'string' || token.length === 0) {
      return c.json({ error: '缺少 token' }, 400);
    }
    const tokenHash = hashToken(token);

    const client = await deps.pool.connect();
    try {
      await client.query('begin');

      // 邀请校验（pending + 未过期；for update 防并发双接受）
      const { rows: inviteRows } = await client.query(
        `select invite_id, inviter_id, expires_at, status
         from friend_invites
         where token_hash = $1
         for update`,
        [tokenHash],
      );
      const invite = inviteRows[0];
      if (!invite || invite.status !== 'pending' || new Date(invite.expires_at) < new Date()) {
        await client.query('rollback');
        return c.json({ error: 'invite 无效或已过期' }, 410);
      }
      const inviterId = String(invite.inviter_id);
      if (inviterId === userId) {
        await client.query('rollback');
        return c.json({ error: '不能接受自己的邀请' }, 400);
      }

      // 关系校验：不可与已拉黑/已存在 active 好友的人建关系
      if (await isBlocked(client, inviterId, userId)) {
        await client.query('rollback');
        return c.json({ error: 'blocked' }, 403);
      }
      if (await findActiveFriendship(client, inviterId, userId)) {
        await client.query('rollback');
        return c.json({ error: '已是好友' }, 409);
      }

      // 标记邀请已使用（一次使用，6.3）
      await client.query(`update friend_invites set status = 'used' where invite_id = $1`, [
        invite.invite_id,
      ]);

      // 建好友关系（low/high 规范化）+ 房间
      const { low, high } = normalizeFriendshipPair(inviterId, userId);
      const { rows: fRows } = await client.query(
        `insert into friendships (user_low_id, user_high_id, status, accepted_at)
         values ($1, $2, 'active', now())
         returning friendship_id`,
        [low, high],
      );
      const friendshipId = String(fRows[0]?.friendship_id);
      const roomId = await findOrCreateRoom(client, inviterId, userId);

      // 权威事件：好友建立（双方 inbox，9.3）
      const result = await deliverEvent({
        pool: deps.pool,
        realtime: deps.realtime,
        client,
        roomId,
        type: 'friend.connected',
        payload: { friendshipId, inviterId, acceptedAt: new Date().toISOString() },
        reliability: 'A',
        recipients: [inviterId, userId],
      });

      await client.query('commit');
      return c.json({ friendshipId, roomId, eventId: result.eventId }, 201);
    } catch (e) {
      await client.query('rollback');
      return c.json({ error: (e as Error).message }, 500);
    } finally {
      client.release();
    }
  });
}
