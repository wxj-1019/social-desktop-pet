/**
 * 管理 API —— 敏感数据（聊天/记忆）。
 * 默认只返回脱敏摘要（内容截断 40 字符）；原文经一次性短时授权获取（Task 18）。
 * 用户维度读取沿用 withUserClaims（RLS 兼容）。
 */
import { Hono } from 'hono';
import type pg from 'pg';

import type { JwtService } from '../auth/jwt.js';
import type { PgAdminUserStore } from '../db/admin-stores.js';

import { withUserClaims } from './admin-users.js';
import type { AdminVariables } from './admin.js';
import { requireAdminAuth } from './admin.js';

const SUMMARY_LIMIT = 40;

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

  return app;
}
