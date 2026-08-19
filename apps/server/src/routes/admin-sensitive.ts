/**
 * 管理 API —— 敏感数据（聊天/记忆）。
 * 默认只返回脱敏摘要（PII 掩码 + 头部截断，短文也不整段透出）；原文经一次性短时授权获取。
 * 用户维度读取沿用 claims 事务（RLS 兼容）；授权的消费、原文读取与审计在同一事务内完成
 * （任一步失败整体回滚，授权不会被"白烧"）。
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { Hono } from 'hono';
import type pg from 'pg';

import type { JwtService } from '../auth/jwt.js';
import { hashRefreshToken } from '../auth/session.js';
import type { PgAdminUserStore } from '../db/admin-stores.js';
import { rlsClaimsJson } from '../db/pool.js';
import { writeAdminAuditOn } from '../lib/admin-audit.js';
import { AuthRateLimiter, clientIpOf } from '../lib/auth-rate-limit.js';
import { isValidDate, isValidUuid } from '../lib/validate.js';

import { withUserClaims } from './admin-users.js';
import type { AdminVariables } from './admin.js';
import { requireAdminAuth } from './admin.js';

/** 敏感授权创建限流（设计 §7：敏感授权按 IP 限流，防批量导出） */
const grantLimiter = new AuthRateLimiter();

/** 摘要保留的头部长度：短文也不整段透出（摘要仅用于运营定位记录，原文走一次性授权） */
const SUMMARY_HEAD_CHARS = 12;

/** PII 掩码规则（顺序敏感：身份证 18 位需先于银行卡 15-19 位匹配） */
const PII_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/https?:\/\/\S+/g, '[链接]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[邮箱]'],
  [/(?<!\d)(?:\+?86)?1[3-9]\d{9}(?!\d)/g, '[手机号]'],
  [/(?<!\d)\d{17}[0-9Xx](?!\d)/g, '[身份证号]'],
  [/(?<!\d)\d{15,19}(?!\d)/g, '[银行卡号]'],
];

function maskPii(text: string): string {
  let out = text;
  for (const [pattern, label] of PII_PATTERNS) out = out.replace(pattern, label);
  return out;
}

function summarize(content: string): string {
  const masked = maskPii(content);
  if (masked.length <= SUMMARY_HEAD_CHARS) return masked;
  return `${masked.slice(0, SUMMARY_HEAD_CHARS)}…`;
}

/** 单次授权的最大时间跨度（天）：与 usage 查询同上限，防一次授权拖全历史 */
const MAX_GRANT_SPAN_DAYS = 31;
const DAY_MS = 86_400_000;

export interface AdminSensitiveDeps {
  pool: pg.Pool;
  jwt: JwtService;
  adminUsers: PgAdminUserStore;
}

export function createAdminSensitiveRouter(
  deps: AdminSensitiveDeps,
): Hono<{ Variables: AdminVariables }> {
  const app = new Hono<{ Variables: AdminVariables }>();
  const auth = requireAdminAuth(deps.jwt, deps.adminUsers);

  app.get('/users/:userId/chat-summary', auth, async (c) => {
    const userId = c.req.param('userId');
    if (!isValidUuid(userId)) return c.json({ error: 'invalid_input' }, 422);
    const q = c.req.query();
    const page = Number.isFinite(Number(q.page)) ? Math.max(1, Math.trunc(Number(q.page))) : 1;
    const pageSize = Number.isFinite(Number(q.pageSize))
      ? Math.min(100, Math.max(1, Math.trunc(Number(q.pageSize))))
      : 20;
    const from = q.from ?? '';
    const to = q.to ?? '';
    // from/to 必须是日历级合法日期，否则 Postgres 日期 cast 会 500（2026-02-30 等）；非法 → 422
    for (const key of ['from', 'to'] as const) {
      if (q[key] !== undefined && !isValidDate(q[key])) {
        return c.json({ error: 'invalid_input' }, 422);
      }
    }
    const { rows } = await withUserClaims(deps.pool, userId, (client) =>
      client.query(
        `select message_id, role, content, created_at
         from chat_messages
         where user_id = $1
           and ($2 = '' or created_at >= $2::date)
           and ($3 = '' or created_at < $3::date + interval '1 day')
         order by created_at desc
         limit $4 offset $5`,
        [userId, from, to, pageSize, (page - 1) * pageSize],
      ),
    );
    return c.json({
      items: rows.map((r) => ({
        messageId: String(r.message_id),
        role: r.role as string,
        createdAt: r.created_at as string,
        summary: summarize(r.content as string),
      })),
    });
  });

  app.get('/users/:userId/memories-summary', auth, async (c) => {
    const userId = c.req.param('userId');
    if (!isValidUuid(userId)) return c.json({ error: 'invalid_input' }, 422);
    const q = c.req.query();
    const page = Number.isFinite(Number(q.page)) ? Math.max(1, Math.trunc(Number(q.page))) : 1;
    const pageSize = Number.isFinite(Number(q.pageSize))
      ? Math.min(100, Math.max(1, Math.trunc(Number(q.pageSize))))
      : 20;
    const status = q.status ?? '';
    const { rows } = await withUserClaims(deps.pool, userId, (client) =>
      client.query(
        `select memory_id, category, sensitivity, value, created_at
         from private_memories
         where owner_user_id = $1
           and ($2 = '' or memory_status = $2)
         order by created_at desc
         limit $3 offset $4`,
        [userId, status, pageSize, (page - 1) * pageSize],
      ),
    );
    return c.json({
      items: rows.map((r) => ({
        memoryId: String(r.memory_id),
        category: r.category as string,
        sensitivity: r.sensitivity as string,
        createdAt: r.created_at as string,
        summary: summarize(r.value as string),
      })),
    });
  });

  // ---- 一次性敏感访问授权（短时、单次、绑定管理员+用户+资源类型）----

  const GRANT_TTL_MS = 5 * 60_000;

  app.post('/sensitive-access', auth, async (c) => {
    const adminId = c.get('adminId');
    const ipCheck = grantLimiter.check(`sensitive-grant-ip:${clientIpOf(c)}`);
    if (!ipCheck.allowed) {
      return c.json({ error: 'rate_limit', retryAfterSec: ipCheck.retryAfterSec }, 429);
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      targetUserId?: string;
      resourceType?: string;
      reason?: unknown;
      scope?: Record<string, unknown>;
    };
    const resourceType = body.resourceType ?? '';
    if (!['chat', 'private_memory', 'bond_memory'].includes(resourceType)) {
      return c.json({ error: 'invalid_input' }, 422);
    }
    // 非字符串 reason（如数字）直接 422，而非 .trim() 抛 TypeError → 500
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < 5 || reason.length > 500) return c.json({ error: 'invalid_input' }, 422);
    // targetUserId 是 uuid 绑定参数，先校验格式再进库
    if (!body.targetUserId || !isValidUuid(body.targetUserId)) {
      return c.json({ error: 'invalid_input' }, 422);
    }
    // 范围必填（设计 §4.5：禁止批量导出）：scope.from 为起始日期（含），
    // scope.to 可选（含当天）；内容读取按此时界过滤
    const scope = (body.scope ?? {}) as { from?: unknown; to?: unknown };
    const from = typeof scope.from === 'string' ? scope.from : '';
    const to = typeof scope.to === 'string' ? scope.to : '';
    if (!isValidDate(from)) return c.json({ error: 'invalid_input' }, 422);
    if (to !== '' && !isValidDate(to)) return c.json({ error: 'invalid_input' }, 422);
    if (to !== '' && to < from) return c.json({ error: 'invalid_input' }, 422);
    // 跨度上限：防止单次授权拖取全历史（重复申请仍受限流 + 审计约束）
    const spanDays = Math.round((Date.parse(to || from) - Date.parse(from)) / DAY_MS);
    if (spanDays > MAX_GRANT_SPAN_DAYS) return c.json({ error: 'invalid_input' }, 422);
    const exists = await deps.pool.query('select 1 from auth.users where id = $1', [
      body.targetUserId,
    ]);
    if ((exists.rowCount ?? 0) === 0) return c.json({ error: 'not_found' }, 404);

    const grantId = randomUUID();
    const token = randomBytes(32).toString('base64url');
    // 授权落库与 sensitive.grant 审计同事务：审计失败 → 授权不生效
    const client = await deps.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into admin_sensitive_grants
           (grant_id, admin_id, target_user_id, resource_type, resource_scope, grant_token_hash, reason, expires_at)
         values ($1, $2, $3, $4, $5::jsonb, $6, $7, now() + make_interval(secs => $8))`,
        [
          grantId,
          adminId,
          body.targetUserId,
          resourceType,
          JSON.stringify({ from, to }),
          hashRefreshToken(token),
          reason,
          GRANT_TTL_MS / 1000,
        ],
      );
      await writeAdminAuditOn(client, {
        adminId,
        action: 'sensitive.grant',
        resourceType,
        resourceId: body.targetUserId,
        reason,
        ip: clientIpOf(c),
      });
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    return c.json(
      { grantId, token, expiresAt: new Date(Date.now() + GRANT_TTL_MS).toISOString() },
      201,
    );
  });

  app.get('/sensitive-access/:grantId/content', auth, async (c) => {
    const adminId = c.get('adminId');
    const grantId = c.req.param('grantId');
    if (!isValidUuid(grantId)) return c.json({ error: 'invalid_input' }, 422);
    const grantToken = c.req.header('x-grant-token') ?? '';
    if (!grantToken) return c.json({ error: 'invalid_input' }, 422);

    const { rows } = await deps.pool.query(
      `select g.grant_id, g.target_user_id, g.resource_type, g.resource_scope, g.reason,
              extract(epoch from g.expires_at) * 1000 as expires_at, g.used_at
       from admin_sensitive_grants g
       where g.grant_id = $1 and g.admin_id = $2`,
      [grantId, adminId],
    );
    const grant = rows[0];
    if (!grant) return c.json({ error: 'not_found' }, 404);
    if (grant.used_at !== null || Number(grant.expires_at) < Date.now()) {
      return c.json({ error: 'grant_used_or_expired' }, 410);
    }

    const userId = String(grant.target_user_id);
    const resourceType = grant.resource_type as string;
    // 授权范围（创建时强制 from 必填）：内容查询按此时界过滤，杜绝一次授权读取整个历史
    const scope = (grant.resource_scope ?? {}) as { from?: string; to?: string };
    const scopeFrom = typeof scope.from === 'string' ? scope.from : '';
    const scopeTo = typeof scope.to === 'string' ? scope.to : '';
    // 创建时已校验；此处兜底（历史 grant 或异常数据不放大读取范围）
    if (!isValidDate(scopeFrom)) return c.json({ error: 'invalid_input' }, 422);

    // 消费、原文读取与 sensitive.read 审计同一事务：
    // - UPDATE 带 used_at is null and expires_at > now()（乐观锁 + 过期原子判定，
    //   消除"校验与消费之间过期"的竞态窗口）
    // - 后续任一查询/审计失败 → 整体回滚，授权不被"白烧"
    const client = await deps.pool.connect();
    try {
      await client.query('begin');
      const consumed = await client.query(
        `update admin_sensitive_grants set used_at = now()
         where grant_id = $1 and admin_id = $2 and grant_token_hash = $3
           and used_at is null and expires_at > now()
         returning grant_id`,
        [grantId, adminId, hashRefreshToken(grantToken)],
      );
      if ((consumed.rowCount ?? 0) === 0) {
        await client.query('rollback');
        return c.json({ error: 'grant_used_or_expired' }, 410);
      }
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        rlsClaimsJson(userId),
      ]);

      let items: unknown[] = [];
      if (resourceType === 'chat') {
        const result = await client.query(
          `select message_id, role, content, created_at from chat_messages
           where user_id = $1
             and created_at >= $2::date
             and created_at < $3::date + interval '1 day'
           order by created_at desc limit 200`,
          [userId, scopeFrom, scopeTo || scopeFrom],
        );
        items = result.rows;
      } else if (resourceType === 'private_memory') {
        const result = await client.query(
          `select memory_id, category, sensitivity, value, created_at from private_memories
           where owner_user_id = $1
             and created_at >= $2::date
             and created_at < $3::date + interval '1 day'
           order by created_at desc limit 200`,
          [userId, scopeFrom, scopeTo || scopeFrom],
        );
        items = result.rows;
      } else {
        const result = await client.query(
          `select bm.memory_id, bm.content, bm.created_at
           from bond_memories bm
           join bonds b on b.bond_id = bm.bond_id
           join pets pa on pa.pet_id = b.pet_a_id
           join pets pb on pb.pet_id = b.pet_b_id
           where (pa.owner_user_id = $1 or pb.owner_user_id = $1)
             and bm.created_at >= $2::date
             and bm.created_at < $3::date + interval '1 day'
           order by bm.created_at desc limit 200`,
          [userId, scopeFrom, scopeTo || scopeFrom],
        );
        items = result.rows;
      }

      await writeAdminAuditOn(client, {
        adminId,
        action: 'sensitive.read',
        resourceType,
        resourceId: userId,
        reason: grant.reason ?? undefined,
        ip: clientIpOf(c),
      });
      await client.query('commit');
      // 原文响应禁止缓存（一次性授权语义：浏览器/代理不得保留原文副本）
      c.header('Cache-Control', 'no-store');
      return c.json({ resourceType, items });
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  });

  return app;
}
