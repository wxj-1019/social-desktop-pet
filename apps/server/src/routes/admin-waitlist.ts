/**
 * 管理 API —— waitlist / 邀请（列表、发放、过期）。
 * 发放复用 WaitlistService.invite（状态机 + 邀请邮件 + 兑换码只存哈希），
 * 并注入事务内审计钩子：邀请落库与审计同生共死。过期同样走"动作+审计"单事务。
 */
import { Hono } from 'hono';
import type pg from 'pg';

import type { JwtService } from '../auth/jwt.js';
import type { PgAdminUserStore } from '../db/admin-stores.js';
import { writeAdminAuditOn } from '../lib/admin-audit.js';
import { clientIpOf } from '../lib/auth-rate-limit.js';
import { isValidUuid } from '../lib/validate.js';

import type { AdminVariables } from './admin.js';
import { requireAdminAuth } from './admin.js';

export interface AdminWaitlistDeps {
  pool: pg.Pool;
  jwt: JwtService;
  adminUsers: PgAdminUserStore;
  waitlist: {
    invite(
      emails: string[],
      hooks?: {
        /** 邀请落库同一事务内的审计写入（admin 运营路径注入；审计失败 → 邀请回滚） */
        auditOnInvite?: (
          exec: { query(text: string, params?: unknown[]): Promise<unknown> },
          email: string,
        ) => Promise<void>;
      },
    ): Promise<{ invited: Array<{ email: string; code: string }>; skipped: string[] }>;
  };
}

export function createAdminWaitlistRouter(
  deps: AdminWaitlistDeps,
): Hono<{ Variables: AdminVariables }> {
  const app = new Hono<{ Variables: AdminVariables }>();
  const auth = requireAdminAuth(deps.jwt, deps.adminUsers);

  app.get('/waitlist', auth, async (c) => {
    const q = c.req.query();
    const page = Number.isFinite(Number(q.page)) ? Math.max(1, Math.trunc(Number(q.page))) : 1;
    const pageSize = Number.isFinite(Number(q.pageSize))
      ? Math.min(100, Math.max(1, Math.trunc(Number(q.pageSize))))
      : 20;
    const status = q.status ?? '';
    const keyword = (q.q ?? '').trim();
    const count = await deps.pool.query(
      `select count(*)::int as total from waitlist w
       where ($1 = '' or w.status = $1) and ($2 = '' or w.email ilike '%' || $2 || '%')`,
      [status, keyword],
    );
    const { rows } = await deps.pool.query(
      `select w.id, w.email, w.status, w.created_at, w.invited_at, w.invite_expires_at,
              w.claimed_at
       from waitlist w
       where ($1 = '' or w.status = $1) and ($2 = '' or w.email ilike '%' || $2 || '%')
       order by w.created_at desc
       limit $3 offset $4`,
      [status, keyword, pageSize, (page - 1) * pageSize],
    );
    return c.json({
      total: Number(count.rows[0]?.total ?? 0),
      page,
      pageSize,
      items: rows.map((r) => ({
        id: String(r.id),
        email: r.email as string,
        status: r.status as string,
        createdAt: r.created_at as string,
        invitedAt: r.invited_at as string | null,
        inviteExpiresAt: r.invite_expires_at as string | null,
        claimedAt: r.claimed_at as string | null,
      })),
    });
  });

  app.post('/waitlist/:id/invite', auth, async (c) => {
    const adminId = c.get('adminId');
    const id = c.req.param('id');
    if (!isValidUuid(id)) return c.json({ error: 'invalid_input' }, 422);
    const { rows } = await deps.pool.query('select email from waitlist where id = $1', [id]);
    const row = rows[0];
    if (!row) return c.json({ error: 'not_found' }, 404);
    const ip = clientIpOf(c);
    const result = await deps.waitlist.invite([row.email as string], {
      // 邀请状态推进与审计同一事务（WaitlistService 内部保证）：审计失败 → 邀请回滚
      auditOnInvite: (exec, email) =>
        writeAdminAuditOn(exec, {
          adminId,
          action: 'waitlist.invite',
          resourceType: 'waitlist',
          resourceId: id,
          reason: email,
          ip,
        }),
    });
    const invited = result.invited[0];
    if (!invited) return c.json({ error: 'not_pending' }, 409);
    return c.json({ ok: true, code: invited.code });
  });

  app.post('/waitlist/:id/expire', auth, async (c) => {
    const adminId = c.get('adminId');
    const id = c.req.param('id');
    if (!isValidUuid(id)) return c.json({ error: 'invalid_input' }, 422);
    // 过期与审计同事务：审计失败 → 状态变更回滚
    const client = await deps.pool.connect();
    try {
      await client.query('begin');
      const updated = await client.query(
        `update waitlist set status = 'expired'
         where id = $1 and status = 'invited'
         returning email`,
        [id],
      );
      if ((updated.rowCount ?? 0) === 0) {
        await client.query('rollback');
        return c.json({ error: 'not_invited' }, 409);
      }
      await writeAdminAuditOn(client, {
        adminId,
        action: 'waitlist.expire',
        resourceType: 'waitlist',
        resourceId: id,
        reason: updated.rows[0]?.email as string | undefined,
        ip: clientIpOf(c),
      });
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    return c.json({ ok: true });
  });

  return app;
}
