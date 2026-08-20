/**
 * 管理 API —— 社交互动中心（P0）。
 *
 * 数据源：gift_events / visits / friendships / events（A 类强可靠事件总线），
 * 全部只读聚合查询——互动数据在业务侧送礼/拜访/接受邀请时事务落库，
 * 本路由只做运营视角的流式与聚合读取，不改变业务语义。
 *
 * 三个端点：
 *   GET /social/daily   —— 按日聚合（礼物/拜访/新建好友/互动活跃用户，含区间汇总）
 *   GET /social/events  —— 统一互动事件流（gift.snack_sent / visit.arrived / friend.connected）
 *   GET /users/:userId/social —— 单用户互动历史（礼物收发 / 拜访 / 好友关系）
 */
import { Hono } from 'hono';
import type pg from 'pg';

import type { JwtService } from '../auth/jwt.js';
import type { PgAdminUserStore } from '../db/admin-stores.js';
import { isValidDate, isValidUuid } from '../lib/validate.js';

import type { AdminVariables } from './admin.js';
import { requireAdminAuth } from './admin.js';

/** 互动事件类型白名单（events.type；防任意字符串过滤导致的无效查询） */
const SOCIAL_EVENT_TYPES = ['gift.snack_sent', 'visit.arrived', 'friend.connected'] as const;

const MAX_RANGE_DAYS = 31;
const DAY_MS = 86_400_000;

export interface AdminSocialDeps {
  pool: pg.Pool;
  jwt: JwtService;
  adminUsers: PgAdminUserStore;
}

/** 解析并校验日期区间（同 admin-usage 语义：非法/超 31 天 → null） */
function parseRange(
  from: string | undefined,
  to: string | undefined,
): { from: string; to: string } | null {
  const fromDate = from ?? new Date(Date.now() - 7 * DAY_MS).toISOString().slice(0, 10);
  const toDate = to ?? new Date().toISOString().slice(0, 10);
  if (!isValidDate(fromDate) || !isValidDate(toDate)) return null;
  if (fromDate > toDate) return null;
  const days = Math.round((Date.parse(toDate) - Date.parse(fromDate)) / DAY_MS);
  if (days > MAX_RANGE_DAYS) return null;
  return { from: fromDate, to: toDate };
}

export function createAdminSocialRouter(
  deps: AdminSocialDeps,
): Hono<{ Variables: AdminVariables }> {
  const app = new Hono<{ Variables: AdminVariables }>();
  const auth = requireAdminAuth(deps.jwt, deps.adminUsers);

  // ---- 按日聚合：礼物 / 拜访 / 新建好友 / 互动活跃用户 ----
  app.get('/social/daily', auth, async (c) => {
    const range = parseRange(c.req.query('from'), c.req.query('to'));
    if (!range) return c.json({ error: 'invalid_input' }, 422);

    const { rows } = await deps.pool.query(
      `select d.day,
              coalesce(g.cnt, 0)::int as gifts,
              coalesce(v.cnt, 0)::int as visits,
              coalesce(f.cnt, 0)::int as new_friends,
              coalesce(a.cnt, 0)::int as active_users
       from generate_series($1::date, $2::date, interval '1 day') as d(day)
       left join (
         select created_at::date as day, count(*) as cnt
         from gift_events where created_at >= $1::date and created_at < ($2::date + 1)
         group by 1
       ) g on g.day = d.day
       left join (
         select created_at::date as day, count(*) as cnt
         from visits where created_at >= $1::date and created_at < ($2::date + 1)
         group by 1
       ) v on v.day = d.day
       left join (
         select accepted_at::date as day, count(*) as cnt
         from friendships where accepted_at is not null
           and accepted_at >= $1::date and accepted_at < ($2::date + 1)
         group by 1
       ) f on f.day = d.day
       left join (
         select day, count(distinct u) as cnt from (
           select created_at::date as day, from_user as u from gift_events
           where created_at >= $1::date and created_at < ($2::date + 1)
           union
           select created_at::date as day, from_user as u from visits
           where created_at >= $1::date and created_at < ($2::date + 1)
         ) t group by 1
       ) a on a.day = d.day
       order by d.day`,
      [range.from, range.to],
    );
    const items = rows.map((r) => ({
      date: r.day as string,
      gifts: Number(r.gifts),
      visits: Number(r.visits),
      newFriends: Number(r.new_friends),
      activeUsers: Number(r.active_users),
    }));
    return c.json({
      summary: {
        gifts: items.reduce((s, i) => s + i.gifts, 0),
        visits: items.reduce((s, i) => s + i.visits, 0),
        newFriends: items.reduce((s, i) => s + i.newFriends, 0),
        activeUsers: items.reduce((s, i) => s + i.activeUsers, 0),
      },
      items,
    });
  });

  // ---- 统一互动事件流（events 总线 + 用户邮箱） ----
  app.get('/social/events', auth, async (c) => {
    const q = c.req.query();
    const page = Number.isFinite(Number(q.page)) ? Math.max(1, Math.trunc(Number(q.page))) : 1;
    const pageSize = Number.isFinite(Number(q.pageSize))
      ? Math.min(100, Math.max(1, Math.trunc(Number(q.pageSize))))
      : 50;
    const type = SOCIAL_EVENT_TYPES.includes(q.type as (typeof SOCIAL_EVENT_TYPES)[number])
      ? (q.type as string)
      : '';
    if (q.type && !type) return c.json({ error: 'invalid_input' }, 422);
    if (
      (q.from !== undefined && !isValidDate(q.from)) ||
      (q.to !== undefined && !isValidDate(q.to))
    ) {
      return c.json({ error: 'invalid_input' }, 422);
    }
    // 未提供日期时用宽区间兜底（避免 ''::date cast 报错；类型保持日期语义）
    const from = q.from ?? '1970-01-01';
    const to = q.to ?? '2999-12-31';
    const keyword = (q.q ?? '').trim();

    const filters = `e.type = any(array['gift.snack_sent','visit.arrived','friend.connected']::text[])
       and ($1 = '' or e.type = $1)
       and e.created_at >= $2::date
       and e.created_at < ($3::date + 1)
       and ($4 = '' or fu.email ilike '%' || $4 || '%' or tu.email ilike '%' || $4 || '%')`;
    const joinUsers = `left join auth.users fu
         on fu.id::text = coalesce(e.payload->>'fromUserId', e.payload->>'inviterId')
       left join auth.users tu on tu.id::text = e.payload->>'toUserId'`;

    const count = await deps.pool.query(
      `select count(*)::int as total from events e ${joinUsers} where ${filters}`,
      [type, from, to, keyword],
    );
    const { rows } = await deps.pool.query(
      `select e.event_id, e.type, e.payload, e.created_at,
              fu.email as from_email, tu.email as to_email
       from events e ${joinUsers}
       where ${filters}
       order by e.created_at desc
       limit $5 offset $6`,
      [type, from, to, keyword, pageSize, (page - 1) * pageSize],
    );
    return c.json({
      total: Number(count.rows[0]?.total ?? 0),
      page,
      pageSize,
      items: rows.map((r) => ({
        eventId: String(r.event_id),
        type: r.type as string,
        payload: r.payload as Record<string, unknown>,
        fromEmail: (r.from_email as string) ?? null,
        toEmail: (r.to_email as string) ?? null,
        createdAt: r.created_at as string,
      })),
    });
  });

  // ---- 单用户互动历史（用户详情抽屉数据源） ----
  app.get('/users/:userId/social', auth, async (c) => {
    const userId = c.req.param('userId');
    if (!isValidUuid(userId)) return c.json({ error: 'invalid_input' }, 422);

    const gifts = await deps.pool.query(
      `select g.gift_id, g.snack_id, g.status, g.created_at,
              case when g.from_user = $1 then 'sent' else 'received' end as direction,
              case when g.from_user = $1 then tu.email else fu.email end as peer_email
       from gift_events g
       left join auth.users fu on fu.id = g.from_user
       left join auth.users tu on tu.id = g.to_user
       where g.from_user = $1 or g.to_user = $1
       order by g.created_at desc
       limit 20`,
      [userId],
    );
    const visits = await deps.pool.query(
      `select v.visit_id, v.type, v.status, v.created_at,
              case when v.from_user = $1 then 'sent' else 'received' end as direction,
              case when v.from_user = $1 then tu.email else fu.email end as peer_email
       from visits v
       left join auth.users fu on fu.id = v.from_user
       left join auth.users tu on tu.id = v.to_user
       where v.from_user = $1 or v.to_user = $1
       order by v.created_at desc
       limit 20`,
      [userId],
    );
    const friendships = await deps.pool.query(
      `select f.friendship_id, f.status, f.accepted_at, f.created_at,
              case when f.user_low_id = $1 then uh.email else ul.email end as friend_email
       from friendships f
       join auth.users ul on ul.id = f.user_low_id
       join auth.users uh on uh.id = f.user_high_id
       where f.user_low_id = $1 or f.user_high_id = $1
       order by f.created_at desc`,
      [userId],
    );

    return c.json({
      gifts: gifts.rows.map((r) => ({
        giftId: String(r.gift_id),
        snackId: r.snack_id as string,
        status: r.status as string,
        direction: r.direction as string,
        peerEmail: (r.peer_email as string) ?? null,
        createdAt: r.created_at as string,
      })),
      visits: visits.rows.map((r) => ({
        visitId: String(r.visit_id),
        type: r.type as string,
        status: r.status as string,
        direction: r.direction as string,
        peerEmail: (r.peer_email as string) ?? null,
        createdAt: r.created_at as string,
      })),
      friendships: friendships.rows.map((r) => ({
        friendshipId: String(r.friendship_id),
        status: r.status as string,
        friendEmail: r.friend_email as string,
        acceptedAt: (r.accepted_at as string) ?? null,
        createdAt: r.created_at as string,
      })),
    });
  });

  return app;
}
