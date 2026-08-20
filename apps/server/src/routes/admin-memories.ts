/**
 * 管理 API —— 记忆确认队列运营视图（P0）。
 *
 * 数据源：memory_confirmations（D-3 敏感候选 HITL 队列）。
 * 运营用途：待确认积压量、确认/拒绝率、类别与敏感度分布——
 * 据此判断 memoryConfirmation feature flag 阈值是否太打扰用户
 *（确认率过低 = 该考虑把分级确认放宽）。
 */
import { Hono } from 'hono';
import type pg from 'pg';

import type { JwtService } from '../auth/jwt.js';
import type { PgAdminUserStore } from '../db/admin-stores.js';

import type { AdminVariables } from './admin.js';
import { requireAdminAuth } from './admin.js';

export interface AdminMemoriesDeps {
  pool: pg.Pool;
  jwt: JwtService;
  adminUsers: PgAdminUserStore;
}

export function createAdminMemoriesRouter(
  deps: AdminMemoriesDeps,
): Hono<{ Variables: AdminVariables }> {
  const app = new Hono<{ Variables: AdminVariables }>();
  const auth = requireAdminAuth(deps.jwt, deps.adminUsers);

  // ---- 记忆确认队列统计 ----
  app.get('/memories/queue-stats', auth, async (c) => {
    const counts = await deps.pool.query(
      `select
         count(*) filter (where status = 'pending')::int as pending,
         count(*) filter (where status = 'confirmed'
           and created_at >= now() - interval '7 days')::int as confirmed_7d,
         count(*) filter (where status = 'rejected'
           and created_at >= now() - interval '7 days')::int as rejected_7d
       from memory_confirmations`,
    );
    const byCategory = await deps.pool.query(
      `select category, count(*)::int as count
       from memory_confirmations where status = 'pending'
       group by category order by count desc`,
    );
    const bySensitivity = await deps.pool.query(
      `select sensitivity, count(*)::int as count
       from memory_confirmations where status = 'pending'
       group by sensitivity order by count desc`,
    );
    const r = (counts.rows[0] ?? {}) as {
      pending?: number;
      confirmed_7d?: number;
      rejected_7d?: number;
    };
    return c.json({
      pending: Number(r.pending ?? 0),
      confirmed7d: Number(r.confirmed_7d ?? 0),
      rejected7d: Number(r.rejected_7d ?? 0),
      byCategory: byCategory.rows.map((x) => ({
        category: x.category as string,
        count: Number(x.count),
      })),
      bySensitivity: bySensitivity.rows.map((x) => ({
        sensitivity: x.sensitivity as string,
        count: Number(x.count),
      })),
    });
  });

  return app;
}
