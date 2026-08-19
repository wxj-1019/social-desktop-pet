/**
 * 管理 API —— 用量（chat_usage 聚合）。
 * 服务端统一限制最大时间跨度（31 天），防止后台查询压垮业务库。
 */
import { Hono } from 'hono';
import type pg from 'pg';

import type { JwtService } from '../auth/jwt.js';
import type { PgAdminUserStore } from '../db/admin-stores.js';
import { isValidUuid } from '../lib/validate.js';

import type { AdminVariables } from './admin.js';
import { requireAdminAuth } from './admin.js';

const MAX_RANGE_DAYS = 31;
const DAY_MS = 86_400_000;

export interface AdminUsageDeps {
  pool: pg.Pool;
  jwt: JwtService;
  adminUsers: PgAdminUserStore;
}

export function createAdminUsageRouter(deps: AdminUsageDeps): Hono<{ Variables: AdminVariables }> {
  const app = new Hono<{ Variables: AdminVariables }>();
  const auth = requireAdminAuth(deps.jwt, deps.adminUsers);

  /**
   * 校验 YYYY-MM-DD 是真实存在的日历日期。
   * 不能直接信任 Date.parse：V8 会把 02-30 / 非闰年 02-29 滚动成合法时间戳（03-02 / 03-01），
   * 月 13 则返回 NaN（NaN 比较恒 false 也拦不住）——两者漏过都会让 $1::date 在 Postgres 抛错（500）。
   * 用 Date.UTC 回读比对分量即可完整拦截（闰年 02-29 仍视为合法）。
   */
  function isCalendarDate(s: string): boolean {
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(5, 7));
    const d = Number(s.slice(8, 10));
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }

  /** 解析并校验日期区间；非法或超 31 天返回 null（调用方返回 422） */
  function parseRange(
    from: string | undefined,
    to: string | undefined,
  ): { from: string; to: string } | null {
    const fromDate = from ?? new Date(Date.now() - 7 * DAY_MS).toISOString().slice(0, 10);
    const toDate = to ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) return null;
    if (!isCalendarDate(fromDate) || !isCalendarDate(toDate)) return null;
    if (fromDate > toDate) return null;
    const days = Math.round((Date.parse(toDate) - Date.parse(fromDate)) / DAY_MS);
    if (days > MAX_RANGE_DAYS) return null;
    return { from: fromDate, to: toDate };
  }

  // 模型过滤值直接作为绑定参数（不拼接 SQL），空串 = 不过滤
  function modelFilter(model: string | undefined): string {
    return (model ?? '').trim().slice(0, 200);
  }

  /** 区间内实际用到的模型列表（运营筛选下拉的数据源；空区间返回空表） */
  app.get('/usage/models', auth, async (c) => {
    const q = c.req.query();
    const range = parseRange(q.from, q.to);
    if (!range) return c.json({ error: 'invalid_input' }, 422);
    const { rows } = await deps.pool.query(
      `select distinct model from chat_usage
       where usage_date between $1::date and $2::date
         and model is not null and model <> ''
       order by model`,
      [range.from, range.to],
    );
    return c.json({ models: rows.map((r) => r.model as string) });
  });

  app.get('/usage', auth, async (c) => {
    const q = c.req.query();
    const range = parseRange(q.from, q.to);
    if (!range) return c.json({ error: 'invalid_input' }, 422);
    const model = modelFilter(q.model);

    const { rows } = await deps.pool.query(
      `select usage_date,
              sum(request_count)::int as requests,
              sum(token_estimate)::int as tokens,
              sum(fail_count)::int as fails,
              sum(limit_hits)::int as limit_hits
       from chat_usage
       where usage_date between $1::date and $2::date
         and ($3 = '' or model = $3)
       group by usage_date
       order by usage_date desc`,
      [range.from, range.to, model],
    );
    const summary = await deps.pool.query(
      `select coalesce(sum(request_count), 0)::int as requests,
              coalesce(sum(token_estimate), 0)::int as tokens,
              coalesce(sum(fail_count), 0)::int as fails,
              coalesce(sum(limit_hits), 0)::int as limit_hits
       from chat_usage where usage_date between $1::date and $2::date
         and ($3 = '' or model = $3)`,
      [range.from, range.to, model],
    );
    const s = (summary.rows[0] ?? {}) as {
      requests?: number;
      tokens?: number;
      fails?: number;
      limit_hits?: number;
    };
    return c.json({
      summary: {
        requests: Number(s.requests ?? 0),
        tokens: Number(s.tokens ?? 0),
        fails: Number(s.fails ?? 0),
        limitHits: Number(s.limit_hits ?? 0),
      },
      items: rows.map((r) => ({
        usageDate: r.usage_date as string,
        requests: Number(r.requests),
        tokens: Number(r.tokens),
        fails: Number(r.fails),
        limitHits: Number(r.limit_hits),
      })),
    });
  });

  app.get('/usage/users/:userId', auth, async (c) => {
    const userId = c.req.param('userId');
    if (!isValidUuid(userId)) return c.json({ error: 'invalid_input' }, 422);
    const q = c.req.query();
    const range = parseRange(q.from, q.to);
    if (!range) return c.json({ error: 'invalid_input' }, 422);

    const { rows } = await deps.pool.query(
      `select usage_date, request_count as requests, token_estimate as tokens,
              fail_count as fails, limit_hits as limit_hits, model
       from chat_usage
       where user_id = $1 and usage_date between $2::date and $3::date
       order by usage_date desc`,
      [userId, range.from, range.to],
    );
    return c.json({
      items: rows.map((r) => ({
        usageDate: r.usage_date as string,
        requests: Number(r.requests),
        tokens: Number(r.tokens),
        fails: Number(r.fails),
        limitHits: Number(r.limit_hits),
        model: (r.model as string) || null,
      })),
    });
  });

  return app;
}
