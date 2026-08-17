/**
 * 管理 API —— 敏感数据（聊天/记忆）。
 * 默认只返回脱敏摘要（内容截断 40 字符）；原文经一次性短时授权获取（Task 18）。
 * 用户维度读取沿用 withUserClaims（RLS 兼容）。
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { Hono } from 'hono';
import type pg from 'pg';

import type { JwtService } from '../auth/jwt.js';
import { hashRefreshToken } from '../auth/session.js';
import type { PgAdminUserStore } from '../db/admin-stores.js';

import { withUserClaims } from './admin-users.js';
import type { AdminVariables } from './admin.js';
import { requireAdminAuth } from './admin.js';

const SUMMARY_LIMIT = 40;
const ADMIN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function summarize(content: string): string {
  return content.length > SUMMARY_LIMIT ? `${content.slice(0, SUMMARY_LIMIT)}…` : content;
}

export interface AdminSensitiveDeps {
  pool: pg.Pool;
  jwt: JwtService;
  adminUsers: PgAdminUserStore;
  writeAudit(entry: {
    adminId: string;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    reason?: string | null;
    ip?: string | null;
  }): Promise<void>;
}

export function createAdminSensitiveRouter(
  deps: AdminSensitiveDeps,
): Hono<{ Variables: AdminVariables }> {
  const app = new Hono<{ Variables: AdminVariables }>();
  const auth = requireAdminAuth(deps.jwt, deps.adminUsers);

  app.get('/users/:userId/chat-summary', auth, async (c) => {
    const userId = c.req.param('userId');
    const q = c.req.query();
    const page = Number.isFinite(Number(q.page)) ? Math.max(1, Math.trunc(Number(q.page))) : 1;
    const pageSize = Number.isFinite(Number(q.pageSize))
      ? Math.min(100, Math.max(1, Math.trunc(Number(q.pageSize))))
      : 20;
    const from = q.from ?? '';
    const to = q.to ?? '';
    // from/to 必须是 YYYY-MM-DD，否则 Postgres 日期 cast 会 500；非法 → 422（同 audit-log 契约）
    for (const key of ['from', 'to'] as const) {
      if (q[key] !== undefined && !ADMIN_DATE_RE.test(q[key])) {
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
    const body = (await c.req.json().catch(() => ({}))) as {
      targetUserId?: string;
      resourceType?: string;
      reason?: string;
      scope?: Record<string, unknown>;
    };
    const resourceType = body.resourceType ?? '';
    if (!['chat', 'private_memory', 'bond_memory'].includes(resourceType)) {
      return c.json({ error: 'invalid_input' }, 422);
    }
    const reason = (body.reason ?? '').trim();
    if (reason.length < 5 || reason.length > 500) return c.json({ error: 'invalid_input' }, 422);
    if (!body.targetUserId) return c.json({ error: 'invalid_input' }, 422);
    const exists = await deps.pool.query('select 1 from auth.users where id = $1', [
      body.targetUserId,
    ]);
    if ((exists.rowCount ?? 0) === 0) return c.json({ error: 'not_found' }, 404);

    const grantId = randomUUID();
    const token = randomBytes(32).toString('base64url');
    await deps.pool.query(
      `insert into admin_sensitive_grants
         (grant_id, admin_id, target_user_id, resource_type, resource_scope, grant_token_hash, reason, expires_at)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, now() + make_interval(secs => $8))`,
      [
        grantId,
        adminId,
        body.targetUserId,
        resourceType,
        JSON.stringify(body.scope ?? {}),
        hashRefreshToken(token),
        reason,
        GRANT_TTL_MS / 1000,
      ],
    );
    await deps.writeAudit({
      adminId,
      action: 'sensitive.grant',
      resourceType,
      resourceId: body.targetUserId,
      reason,
      ip: c.req.header('x-forwarded-for'),
    });
    return c.json(
      { grantId, token, expiresAt: new Date(Date.now() + GRANT_TTL_MS).toISOString() },
      201,
    );
  });

  app.get('/sensitive-access/:grantId/content', auth, async (c) => {
    const adminId = c.get('adminId');
    const grantId = c.req.param('grantId');
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
    // 令牌校验（哈希比对）
    const { rows: tokenRows } = await deps.pool.query(
      `select 1 from admin_sensitive_grants
       where grant_id = $1 and grant_token_hash = $2 and used_at is null
         and expires_at > now()`,
      [grantId, hashRefreshToken(grantToken)],
    );
    if ((tokenRows.length ?? 0) === 0) return c.json({ error: 'grant_used_or_expired' }, 410);

    // 单次消费（乐观锁）
    const consumed = await deps.pool.query(
      `update admin_sensitive_grants set used_at = now()
       where grant_id = $1 and used_at is null returning grant_id`,
      [grantId],
    );
    if ((consumed.rowCount ?? 0) === 0) return c.json({ error: 'grant_used_or_expired' }, 410);

    const userId = String(grant.target_user_id);
    const resourceType = grant.resource_type as string;
    let items: unknown[] = [];

    if (resourceType === 'chat') {
      const result = await withUserClaims(deps.pool, userId, (client) =>
        client.query(
          `select message_id, role, content, created_at from chat_messages
           where user_id = $1 order by created_at desc limit 200`,
          [userId],
        ),
      );
      items = result.rows;
    } else if (resourceType === 'private_memory') {
      const result = await withUserClaims(deps.pool, userId, (client) =>
        client.query(
          `select memory_id, category, sensitivity, value, created_at from private_memories
           where owner_user_id = $1 order by created_at desc limit 200`,
          [userId],
        ),
      );
      items = result.rows;
    } else {
      const result = await withUserClaims(deps.pool, userId, (client) =>
        client.query(
          `select bm.memory_id, bm.content, bm.created_at
           from bond_memories bm
           join bonds b on b.bond_id = bm.bond_id
           join pets pa on pa.pet_id = b.pet_a_id
           join pets pb on pb.pet_id = b.pet_b_id
           where pa.owner_user_id = $1 or pb.owner_user_id = $1
           order by bm.created_at desc limit 200`,
          [userId],
        ),
      );
      items = result.rows;
    }

    await deps.writeAudit({
      adminId,
      action: 'sensitive.read',
      resourceType,
      resourceId: userId,
      reason: grant.reason ?? undefined,
      ip: c.req.header('x-forwarded-for'),
    });
    return c.json({ resourceType, items });
  });

  return app;
}
