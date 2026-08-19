import { describe, expect, it, vi } from 'vitest';

import { AdminSessionManager } from '../auth/admin-session.js';
import type { AdminSession, AdminSessionStore } from '../auth/admin-session.js';
import { JwtService } from '../auth/jwt.js';

import { createAdminAdminsRouter } from './admin-admins.js';

const JWT = new JwtService({ secret: 'admin-test-secret-admin-test-secret' });

class MemoryAdminStore implements AdminSessionStore {
  sessions = new Map<string, AdminSession>();
  async save(s: AdminSession) {
    this.sessions.set(s.tokenHash, s);
  }
  async load(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }
  async rotateToken() {
    return false;
  }
  async revokeToken() {}
  async revokeAllForAdmin() {}
}

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';

function buildRouter(opts: { activeCount?: number; targetStatus?: string; passwordHash?: string }) {
  const allQueries: Array<{ sql: string; params?: unknown[] }> = [];
  const route = async (sql: string, params?: unknown[]) => {
    allQueries.push({ sql, params });
    // 全量 active 行锁（并发停用串行化的关键）：rowCount 即 active 数
    if (sql.includes("status = 'active' order by id for update"))
      return {
        rows: Array.from({ length: opts.activeCount ?? 2 }, () => ({ id: 'x' })),
        rowCount: opts.activeCount ?? 2,
      };
    if (sql.includes('where id = $1 for update'))
      return opts.targetStatus
        ? { rows: [{ id: TARGET_ID, status: opts.targetStatus }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    if (sql.includes("status = 'active', updated_at"))
      return { rows: [], rowCount: opts.targetStatus === 'disabled' ? 1 : 0 };
    return { rows: [], rowCount: 0 };
  };
  const pool = {
    query: vi.fn(route),
    connect: vi.fn(async () => ({ query: vi.fn(route), release: vi.fn() })),
  };
  const adminUsers = {
    getById: vi.fn(async () => ({ id: ADMIN_ID, email: 'admin@pet.dev', status: 'active' })),
    list: vi.fn(async () => [
      {
        id: ADMIN_ID,
        email: 'admin@pet.dev',
        status: 'active',
        lastLoginAt: null,
        createdAt: '2026-08-18T00:00:00Z',
      },
    ]),
    getWithHash: vi.fn(async () =>
      opts.passwordHash
        ? { id: ADMIN_ID, passwordHash: opts.passwordHash, status: 'active' }
        : null,
    ),
  };
  const sessions = new AdminSessionManager(new MemoryAdminStore());
  const app = createAdminAdminsRouter({
    pool: pool as never,
    jwt: JWT,
    adminUsers: adminUsers as never,
    adminSessions: sessions,
  });
  return { app, adminUsers, queries: allQueries };
}

async function adminToken() {
  return JWT.signAdmin(ADMIN_ID);
}

describe('admin admins routes（管理员生命周期）', () => {
  it('lists admins', async () => {
    const { app } = buildRouter({});
    const res = await app.request('/admins', {
      headers: { authorization: `Bearer ${await adminToken()}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ email: string }> };
    expect(body.items[0]!.email).toBe('admin@pet.dev');
  });

  it('disable: status + revoke sessions + audit in one transaction', async () => {
    const { app, queries } = buildRouter({ activeCount: 2, targetStatus: 'active' });
    const res = await app.request(`/admins/${TARGET_ID}/disable`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await adminToken()}` },
    });
    expect(res.status).toBe(200);
    const sqls = queries.map((q) => q.sql);
    // 并发串行化关键：先锁全部 active 行（for update），再判定目标与数量，最后才停用
    const lockIdx = sqls.findIndex((s) => s.includes("status = 'active' order by id for update"));
    const targetIdx = sqls.findIndex((s) => s.includes('where id = $1 for update'));
    const disableIdx = sqls.findIndex((s) => s.includes("set status = 'disabled'"));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(targetIdx).toBeGreaterThan(lockIdx);
    expect(disableIdx).toBeGreaterThan(targetIdx);
    // 停用状态 + 撤销全部会话 + 审计，全部在同一事务（begin → ... → commit）
    expect(sqls.some((s) => s.includes('update admin_sessions set revoked_at'))).toBe(true);
    const auditIdx = sqls.findIndex(
      (s) => s.includes('insert into admin_audit_log') && queries[sqls.indexOf(s)] !== undefined,
    );
    expect(auditIdx).toBeGreaterThan(disableIdx);
    expect(sqls.lastIndexOf('commit')).toBeGreaterThan(auditIdx);
  });

  it('disable self → 422；last active admin → 409', async () => {
    const { app } = buildRouter({ activeCount: 2, targetStatus: 'active' });
    const selfRes = await app.request(`/admins/${ADMIN_ID}/disable`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await adminToken()}` },
    });
    expect(selfRes.status).toBe(422);
    expect(await selfRes.json()).toEqual({ error: 'cannot_disable_self' });

    const lastOne = buildRouter({ activeCount: 1, targetStatus: 'active' });
    const lastRes = await lastOne.app.request(`/admins/${TARGET_ID}/disable`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await adminToken()}` },
    });
    expect(lastRes.status).toBe(409);
    expect(await lastRes.json()).toEqual({ error: 'last_active_admin' });
  });

  it('enable of disabled admin succeeds with in-tx audit', async () => {
    const { app, queries } = buildRouter({ targetStatus: 'disabled' });
    const res = await app.request(`/admins/${TARGET_ID}/enable`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await adminToken()}` },
    });
    expect(res.status).toBe(200);
    expect(
      queries.some(
        (q) => q.sql.includes('insert into admin_audit_log') && q.params?.[1] === 'admin.enable',
      ),
    ).toBe(true);
  });

  it('change-password: wrong current → 401；weak new → 422', async () => {
    const { hashPasswordArgon2 } = await import('../auth/password.js');
    const goodHash = await hashPasswordArgon2('Current@123456');
    const { app } = buildRouter({ passwordHash: goodHash });

    const wrong = await app.request('/auth/change-password', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await adminToken()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ currentPassword: 'nope-wrong-one', newPassword: 'NewStrong@123456' }),
    });
    expect(wrong.status).toBe(401);

    const weak = await app.request('/auth/change-password', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await adminToken()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ currentPassword: 'Current@123456', newPassword: 'short' }),
    });
    expect(weak.status).toBe(422);
  });

  it('change-password success: new hash stored + own sessions revoked + audit', async () => {
    const { hashPasswordArgon2 } = await import('../auth/password.js');
    const goodHash = await hashPasswordArgon2('Current@123456');
    const { app, queries } = buildRouter({ passwordHash: goodHash });
    const res = await app.request('/auth/change-password', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await adminToken()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ currentPassword: 'Current@123456', newPassword: 'NewStrong@123456' }),
    });
    expect(res.status).toBe(200);
    const pwdUpdate = queries.find((q) => q.sql.includes('set password_hash'));
    expect(pwdUpdate).toBeDefined();
    // 新哈希是 PHC 字符串，且不包含明文
    expect(String(pwdUpdate!.params![1])).toContain('$argon2');
    expect(String(pwdUpdate!.params![1])).not.toContain('NewStrong@123456');
    expect(queries.some((q) => q.sql.includes('update admin_sessions set revoked_at'))).toBe(true);
    expect(
      queries.some(
        (q) =>
          q.sql.includes('insert into admin_audit_log') &&
          q.params?.[1] === 'admin.password_change',
      ),
    ).toBe(true);
  });
});
