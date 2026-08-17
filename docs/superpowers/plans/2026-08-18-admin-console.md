# 管理后台（Admin Console）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立 Web 管理后台（apps/admin）与服务端 /admin/* API，统一管理用户、设备、用量、waitlist/邀请，并支持经临时授权的聊天/记忆原文查看，全量审计。

**Architecture:** 服务端新增独立管理员认证域（admin_users/admin_sessions/admin_audit_log/admin_sensitive_grants + auth.users 账号状态列），与普通桌宠用户 JWT 完全隔离；管理 API 复用现有 JwtService（新增 signAdmin/verifyAdmin）、Argon2 密码模块与 AuthRateLimiter；用户维度数据读取沿用"事务内 set request.jwt.claims = 目标用户"的 RLS 兼容模式。前端为独立 React+Vite 应用（apps/admin），dev 模式经 vite proxy 同源访问 /admin/*。

**Tech Stack:** Hono + Postgres(pg) + jose(JWT) + @node-rs/argon2 + React 18 + Vite 5 + Vitest + Playwright

**前置知识：** 现有模式参考 `apps/server/src/routes/auth.ts`（依赖注入 + 路由测试）、`apps/server/src/routes/business.ts`（requireAuth 中间件）、`apps/server/src/db/stores.ts`（Pg 存储 + 事务 + claims）、`apps/server/src/routes/business.test.ts`（fake pool 测试）、`apps/landing`（前端应用模板）。测试命令：`npx vitest run <file>`（根目录 vitest workspace）；类型检查：`pnpm --filter @pet/server typecheck`。

---

## Phase 0：安全基础与可登录后台

### Task 1: Migration 0015_admin_console.sql

**Files:**

- Create: `apps/server/migrations/0015_admin_console.sql`

- [ ] **Step 1: 写 migration 文件**

```sql
-- ============================================================================
-- 0015_admin_console.sql —— 管理后台（2026-08-18）
-- ============================================================================
-- 独立管理员域（与桌宠用户 auth.users 隔离）：
--   admin_users          管理员账号（argon2id 哈希；初始账号由 CLI 创建，不入库）
--   admin_sessions       refresh token 只存 sha256 哈希（与 9.8 同原则）
--   admin_audit_log      追加式审计（不提供删除接口）
--   admin_sensitive_grants 聊天/记忆原文的一次性短时授权
-- auth.users 增加账号暂停列（登录检查 + 全量撤销会话/设备）
-- waitlist 状态机补充 'expired'（0009 原有 check 不含该值，管理后台需显式过期）
-- ============================================================================

create table if not exists admin_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  status        text not null default 'active' check (status in ('active', 'disabled')),
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists admin_sessions (
  token_hash   text primary key,
  admin_id     uuid not null references admin_users(id) on delete cascade,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);
create index if not exists admin_sessions_admin_idx on admin_sessions (admin_id);

create table if not exists admin_audit_log (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid references admin_users(id) on delete set null,
  action        text not null,
  resource_type text not null,
  resource_id   text,
  reason        text,
  request_ip    text,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on admin_audit_log (created_at desc);
create index if not exists admin_audit_log_admin_idx on admin_audit_log (admin_id, created_at desc);

alter table auth.users add column if not exists account_status text not null default 'active'
  check (account_status in ('active', 'suspended'));
alter table auth.users add column if not exists suspended_at timestamptz;
alter table auth.users add column if not exists suspended_reason text;

create table if not exists admin_sensitive_grants (
  grant_id         uuid primary key default gen_random_uuid(),
  admin_id         uuid not null references admin_users(id) on delete cascade,
  target_user_id   uuid not null references auth.users(id) on delete cascade,
  resource_type    text not null check (resource_type in ('chat', 'private_memory', 'bond_memory')),
  resource_scope   jsonb not null default '{}',
  grant_token_hash text not null unique,
  reason           text not null,
  expires_at       timestamptz not null,
  used_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists admin_sensitive_grants_admin_idx on admin_sensitive_grants (admin_id);

-- waitlist 显式过期（0009 的 check 不含 'expired'；需先删后加）
alter table waitlist drop constraint if exists waitlist_status_check;
alter table waitlist add constraint waitlist_status_check
  check (status in ('pending', 'invited', 'joined', 'expired'));
```

- [ ] **Step 2: 应用 migration 并验证幂等**

Run: `cd /e/A_Project/ai-social-desktop-pet && pnpm migrate`
Expected: 输出 `[migrate] applied=0015_admin_console.sql skipped=14`；再跑一次输出 `skipped=15`。

- [ ] **Step 3: 验证表结构**

Run: `psql` 不可用时用 node 一行查询验证：
`cd apps/server && npx tsx --env-file=.env.local -e "import {createPool} from './src/db/pool.ts'; const p=createPool({connectionString:process.env.DATABASE_URL!}); const r=await p.query(\"select tablename from pg_tables where schemaname='public' and tablename like 'admin%'\"); console.log(r.rows.map(x=>x.tablename).join(',')); await p.end();"`
Expected: 输出 `admin_audit_log,admin_sensitive_grants,admin_sessions,admin_users`

- [ ] **Step 4: Commit**

```bash
git add apps/server/migrations/0015_admin_console.sql
git commit -m "feat(server): admin console schema (0015)"
```

---

### Task 2: JwtService 增加管理员签发/校验

**Files:**

- Modify: `apps/server/src/auth/jwt.ts`
- Test: `apps/server/src/auth/jwt.test.ts`

- [ ] **Step 1: 写失败测试（追加到 jwt.test.ts 末尾）**

```ts
describe('admin token', () => {
  const jwt = new JwtService({ secret: 'admin-test-secret-admin-test-secret' });

  it('signAdmin/verifyAdmin round-trips admin id', async () => {
    const token = await jwt.signAdmin('admin-1');
    const payload = await jwt.verifyAdmin(token);
    expect(payload).toEqual({ sub: 'admin-1', role: 'admin' });
  });

  it('verifyAdmin rejects a regular user token (no admin role)', async () => {
    const userToken = await jwt.sign({ sub: 'u1', deviceId: 'dev-1' });
    await expect(jwt.verifyAdmin(userToken)).rejects.toThrow();
  });

  it('verifyAdmin rejects expired admin token', async () => {
    const token = await jwt.signAdmin('admin-1', Date.now() - 16 * 60_000);
    await expect(jwt.verifyAdmin(token)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /e/A_Project/ai-social-desktop-pet && npx vitest run apps/server/src/auth/jwt.test.ts`
Expected: FAIL —— `signAdmin is not a function`

- [ ] **Step 3: 实现（jwt.ts 追加）**

```ts
export interface AdminJwtPayload {
  /** 管理员 id（对应 admin_users.id） */
  sub: string;
  role: 'admin';
}

export class JwtService {
  // ...现有 sign/verify 不动，追加：

  /** 签发管理员 access token（携带 role=admin；与用户 token 同密钥不同载荷） */
  async signAdmin(adminId: string, now = Date.now()): Promise<string> {
    const ttl = this.options.accessTtlMin ?? 15;
    return new SignJWT({ role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(adminId)
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(Math.floor(now / 1000) + ttl * 60)
      .sign(this.key);
  }

  /** 校验管理员 access token；普通用户 token（无 role=admin）抛错 */
  async verifyAdmin(token: string): Promise<AdminJwtPayload> {
    const { payload } = await jwtVerify(token, this.key);
    if (payload.role !== 'admin' || !payload.sub) throw new Error('not an admin token');
    return { sub: payload.sub, role: 'admin' };
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run apps/server/src/auth/jwt.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth/jwt.ts apps/server/src/auth/jwt.test.ts
git commit -m "feat(server): admin JWT sign/verify"
```

---

### Task 3: AdminSessionManager + PgAdminSessionStore

**Files:**

- Create: `apps/server/src/auth/admin-session.ts`
- Create: `apps/server/src/db/admin-stores.ts`（本任务只写 PgAdminSessionStore；PgAdminUserStore 在 Task 5）
- Test: `apps/server/src/auth/admin-session.test.ts`

- [ ] **Step 1: 写失败测试（纯逻辑，MemoryStore 注入）**

```ts
import { describe, expect, it } from 'vitest';

import { AdminSessionManager, SessionRotationError } from './admin-session.js';
import type { AdminSession, AdminSessionStore } from './admin-session.js';
import { hashRefreshToken } from './session.js';

class MemoryAdminStore implements AdminSessionStore {
  sessions = new Map<string, AdminSession>();
  async save(s: AdminSession) {
    this.sessions.set(s.tokenHash, s);
  }
  async load(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }
  async rotateToken(tokenHash: string, next: AdminSession, now: number) {
    const cur = this.sessions.get(tokenHash);
    if (!cur || cur.revokedAt !== null || now >= cur.expiresAt) return false;
    this.sessions.set(tokenHash, { ...cur, revokedAt: now });
    this.sessions.set(next.tokenHash, next);
    return true;
  }
  async revokeToken(tokenHash: string) {
    const cur = this.sessions.get(tokenHash);
    if (cur) this.sessions.set(tokenHash, { ...cur, revokedAt: Date.now() });
  }
  async revokeAllForAdmin(adminId: string) {
    for (const [h, s] of this.sessions)
      if (s.adminId === adminId) this.sessions.set(h, { ...s, revokedAt: Date.now() });
  }
}

describe('AdminSessionManager', () => {
  it('createRefreshToken stores only the hash', async () => {
    const store = new MemoryAdminStore();
    const mgr = new AdminSessionManager(store, 30 * 24 * 60 * 60_000);
    const token = await mgr.createRefreshToken('admin-1');
    expect(token).not.toContain('admin-1');
    expect(store.sessions.has(hashRefreshToken(token))).toBe(true);
    expect([...store.sessions.values()][0]!.adminId).toBe('admin-1');
  });

  it('rotate rotates and revokes the old token', async () => {
    const store = new MemoryAdminStore();
    const mgr = new AdminSessionManager(store);
    const token = await mgr.createRefreshToken('admin-1');
    const { refreshToken, adminId } = await mgr.rotate(token);
    expect(adminId).toBe('admin-1');
    expect(store.sessions.get(hashRefreshToken(token))!.revokedAt).not.toBeNull();
    expect(store.sessions.has(hashRefreshToken(refreshToken))).toBe(true);
  });

  it('rejects revoked / expired / unknown tokens', async () => {
    const store = new MemoryAdminStore();
    const mgr = new AdminSessionManager(store, 60_000, () => 1_000_000);
    const token = await mgr.createRefreshToken('admin-1');
    await mgr.revokeToken(token);
    await expect(mgr.rotate(token)).rejects.toThrow(SessionRotationError);

    const expired = await mgr.createRefreshToken('admin-1'); // 60s TTL，now=1_000_000
    await expect(mgr.rotate(expired)).rejects.toThrow(SessionRotationError); // expiresAt 已过
    await expect(mgr.rotate('unknown')).rejects.toThrow(SessionRotationError);
  });

  it('revokeAllForAdmin revokes every session of the admin', async () => {
    const store = new MemoryAdminStore();
    const mgr = new AdminSessionManager(store);
    const t1 = await mgr.createRefreshToken('admin-1');
    const t2 = await mgr.createRefreshToken('admin-1');
    await mgr.createRefreshToken('admin-2');
    await mgr.revokeAllForAdmin('admin-1');
    expect(store.sessions.get(hashRefreshToken(t1))!.revokedAt).not.toBeNull();
    expect(store.sessions.get(hashRefreshToken(t2))!.revokedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /e/A_Project/ai-social-desktop-pet && npx vitest run apps/server/src/auth/admin-session.test.ts`
Expected: FAIL —— 找不到模块 `./admin-session.js`

- [ ] **Step 3: 实现 admin-session.ts**

```ts
/**
 * 管理员会话 —— refresh token 生命周期（与用户 SessionManager 同语义：
 * 只存哈希、刷新即轮换、全量撤销）。存储注入便于单测。
 */
import { randomBytes } from 'node:crypto';

import { hashRefreshToken } from './session.js';

export interface AdminSession {
  tokenHash: string;
  adminId: string;
  expiresAt: number;
  revokedAt: number | null;
}

export interface AdminSessionStore {
  save(session: AdminSession): Promise<void>;
  load(tokenHash: string): Promise<AdminSession | null>;
  /** 原子消费旧 token 并插入下一代；竞争失败返回 false */
  rotateToken(tokenHash: string, next: AdminSession, now: number): Promise<boolean>;
  revokeToken(tokenHash: string): Promise<void>;
  revokeAllForAdmin(adminId: string): Promise<void>;
}

export { SessionRotationError };

export class AdminSessionManager {
  constructor(
    private readonly store: AdminSessionStore,
    private readonly refreshTtlMs = 30 * 24 * 60 * 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private createSession(
    adminId: string,
    now: number,
  ): { refreshToken: string; session: AdminSession } {
    const refreshToken = randomBytes(48).toString('base64url');
    return {
      refreshToken,
      session: {
        tokenHash: hashRefreshToken(refreshToken),
        adminId,
        expiresAt: now + this.refreshTtlMs,
        revokedAt: null,
      },
    };
  }

  async createRefreshToken(adminId: string): Promise<string> {
    const { refreshToken, session } = this.createSession(adminId, this.now());
    await this.store.save(session);
    return refreshToken;
  }

  async rotate(token: string): Promise<{ refreshToken: string; adminId: string }> {
    const tokenHash = hashRefreshToken(token);
    const session = await this.store.load(tokenHash);
    if (!session) throw new SessionRotationError('invalid', 'invalid refresh token');
    if (session.revokedAt !== null)
      throw new SessionRotationError('revoked', 'refresh token revoked');
    const now = this.now();
    if (now >= session.expiresAt)
      throw new SessionRotationError('expired', 'refresh token expired');
    const next = this.createSession(session.adminId, now);
    const rotated = await this.store.rotateToken(tokenHash, next.session, now);
    if (!rotated) throw new SessionRotationError('revoked', 'refresh token revoked');
    return { refreshToken: next.refreshToken, adminId: session.adminId };
  }

  async revokeToken(refreshToken: string): Promise<void> {
    await this.store.revokeToken(hashRefreshToken(refreshToken));
  }

  async revokeAllForAdmin(adminId: string): Promise<void> {
    await this.store.revokeAllForAdmin(adminId);
  }
}
```

- [ ] **Step 4: 实现 PgAdminSessionStore（追加到 db/admin-stores.ts，文件头写模块注释）**

```ts
/**
 * 管理后台 pg 存储 —— admin_sessions / admin_users（D-13 自建 Auth 同款模式）。
 * 管理员域表无 RLS（服务器统一管理），无需 set claims。
 */
import type pg from 'pg';

import type { AdminSession, AdminSessionStore } from '../auth/admin-session.js';

export class PgAdminSessionStore implements AdminSessionStore {
  constructor(private readonly pool: pg.Pool) {}

  async save(session: AdminSession): Promise<void> {
    await this.pool.query(
      `insert into admin_sessions (token_hash, admin_id, expires_at, revoked_at)
       values ($1, $2, to_timestamp($3 / 1000.0), $4)
       on conflict (token_hash) do update set revoked_at = excluded.revoked_at`,
      [session.tokenHash, session.adminId, session.expiresAt, session.revokedAt],
    );
  }

  async load(tokenHash: string): Promise<AdminSession | null> {
    const { rows } = await this.pool.query(
      `select token_hash, admin_id,
              extract(epoch from expires_at) * 1000 as expires_at,
              revoked_at
       from admin_sessions where token_hash = $1`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      tokenHash: row.token_hash as string,
      adminId: String(row.admin_id),
      expiresAt: Number(row.expires_at),
      revokedAt: row.revoked_at ? Number(row.revoked_at) : null,
    };
  }

  async rotateToken(tokenHash: string, next: AdminSession, now: number): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [tokenHash]);
      const consumed = await client.query(
        `update admin_sessions
         set revoked_at = to_timestamp($2 / 1000.0)
         where token_hash = $1 and revoked_at is null
           and expires_at > to_timestamp($2 / 1000.0)
         returning token_hash`,
        [tokenHash, now],
      );
      if ((consumed.rowCount ?? 0) === 0) {
        await client.query('commit');
        return false;
      }
      await client.query(
        `insert into admin_sessions (token_hash, admin_id, expires_at, revoked_at)
         values ($1, $2, to_timestamp($3 / 1000.0), $4)`,
        [next.tokenHash, next.adminId, next.expiresAt, next.revokedAt],
      );
      await client.query('commit');
      return true;
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async revokeToken(tokenHash: string): Promise<void> {
    await this.pool.query('update admin_sessions set revoked_at = now() where token_hash = $1', [
      tokenHash,
    ]);
  }

  async revokeAllForAdmin(adminId: string): Promise<void> {
    await this.pool.query(
      'update admin_sessions set revoked_at = now() where admin_id = $1 and revoked_at is null',
      [adminId],
    );
  }
}
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run apps/server/src/auth/admin-session.test.ts`
Expected: PASS（4 个用例）

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/auth/admin-session.ts apps/server/src/db/admin-stores.ts apps/server/src/auth/admin-session.test.ts
git commit -m "feat(server): admin refresh session manager + pg store"
```

---

### Task 4: 审计日志写/查（lib/admin-audit.ts）

**Files:**

- Create: `apps/server/src/lib/admin-audit.ts`
- Test: `apps/server/src/lib/admin-audit.test.ts`

- [ ] **Step 1: 写失败测试（fake pool 断言 SQL 参数）**

```ts
import { describe, expect, it, vi } from 'vitest';

import { queryAdminAudit, writeAdminAudit } from './admin-audit.js';

function fakePool(rows: unknown[] = []) {
  return { query: vi.fn(async () => ({ rows, rowCount: rows.length })) };
}

describe('admin audit', () => {
  it('writeAdminAudit inserts with all fields as parameters', async () => {
    const pool = fakePool();
    await writeAdminAudit(pool as never, {
      adminId: 'a1',
      action: 'user.suspend',
      resourceType: 'user',
      resourceId: 'u1',
      reason: '测试暂停',
      ip: '127.0.0.1',
      metadata: { deviceCount: 2 },
    });
    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('insert into admin_audit_log');
    expect(params).toEqual([
      'a1',
      'user.suspend',
      'user',
      'u1',
      '测试暂停',
      '127.0.0.1',
      '{"deviceCount":2}',
    ]);
  });

  it('writeAdminAudit tolerates null adminId (login failures)', async () => {
    const pool = fakePool();
    await writeAdminAudit(pool as never, {
      adminId: null,
      action: 'admin.login_failed',
      resourceType: 'admin',
    });
    const [, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBeNull();
  });

  it('queryAdminAudit builds filters, pagination and total count', async () => {
    const pool = fakePool([
      {
        id: 'e1',
        admin_id: 'a1',
        action: 'user.suspend',
        resource_type: 'user',
        resource_id: 'u1',
        reason: null,
        request_ip: null,
        created_at: '2026-08-18T00:00:00Z',
      },
    ]);
    const result = await queryAdminAudit(pool as never, {
      adminId: 'a1',
      action: 'user.suspend',
      from: '2026-08-01',
      page: 2,
      pageSize: 10,
    });
    expect(result.total).toBe(1);
    expect(result.items[0]!.action).toBe('user.suspend');
    const [sql] = pool.query.mock.calls[0] as [string];
    expect(sql).toContain('count(*)');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /e/A_Project/ai-social-desktop-pet && npx vitest run apps/server/src/lib/admin-audit.test.ts`
Expected: FAIL —— 找不到模块

- [ ] **Step 3: 实现**

```ts
/**
 * 管理员审计 —— 追加式日志（写 + 查）。
 * 只记录必要 metadata（不写密码/token/模型密钥）；查询支持时间/管理员/动作/资源过滤。
 */
import type pg from 'pg';

export interface AdminAuditEntry {
  adminId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  reason?: string | null;
  ip?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AdminAuditRow {
  id: string;
  adminId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  reason: string | null;
  ip: string | null;
  createdAt: string;
}

export async function writeAdminAudit(pool: pg.Pool, entry: AdminAuditEntry): Promise<void> {
  await pool.query(
    `insert into admin_audit_log (admin_id, action, resource_type, resource_id, reason, request_ip, metadata)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      entry.adminId,
      entry.action,
      entry.resourceType,
      entry.resourceId ?? null,
      entry.reason ?? null,
      entry.ip ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}

export interface AdminAuditQuery {
  adminId?: string;
  action?: string;
  resourceType?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export async function queryAdminAudit(
  pool: pg.Pool,
  q: AdminAuditQuery,
): Promise<{ items: AdminAuditRow[]; total: number }> {
  const page = Math.max(1, q.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20));
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (q.adminId) push('admin_id = ?', q.adminId);
  if (q.action) push('action = ?', q.action);
  if (q.resourceType) push('resource_type = ?', q.resourceType);
  if (q.from) push('created_at >= ?::date', q.from);
  if (q.to) push("created_at < ?::date + interval '1 day'", q.to);
  const whereSql = where.length > 0 ? `where ${where.join(' and ')}` : '';

  const count = await pool.query(
    `select count(*)::int as total from admin_audit_log ${whereSql}`,
    params,
  );
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await pool.query(
    `select id, admin_id, action, resource_type, resource_id, reason, request_ip, created_at
     from admin_audit_log ${whereSql}
     order by created_at desc
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return {
    total: Number(count.rows[0]?.total ?? 0),
    items: rows.map((r) => ({
      id: String(r.id),
      adminId: r.admin_id ? String(r.admin_id) : null,
      action: r.action as string,
      resourceType: r.resource_type as string,
      resourceId: r.resource_id as string | null,
      reason: r.reason as string | null,
      ip: r.request_ip as string | null,
      createdAt: r.created_at as string,
    })),
  };
}
```

注意：上面 `push` 里的 `?.replace` 写法会把 SQL 片段中的 `?` 替换为参数占位符，仅适用于片段内只有一个 `?` 的情形——本文件所有片段都满足。若实现时觉得绕，可改为手工 `params.push` + 编号占位符（测试只断言 SQL 含 `count(*)`/`insert into admin_audit_log` 和参数数组，不锁占位符写法）。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run apps/server/src/lib/admin-audit.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/lib/admin-audit.ts apps/server/src/lib/admin-audit.test.ts
git commit -m "feat(server): admin audit log write/query"
```

---

### Task 5: PgAdminUserStore

**Files:**

- Modify: `apps/server/src/db/admin-stores.ts`（追加）
- Test: `apps/server/src/db/admin-stores.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it, vi } from 'vitest';

import { PgAdminUserStore } from './admin-stores.js';

function fakePool(rows: unknown[] = []) {
  return { query: vi.fn(async () => ({ rows, rowCount: rows.length })) };
}

describe('PgAdminUserStore', () => {
  it('findByEmail returns mapped row', async () => {
    const pool = fakePool([
      {
        id: 'a1',
        email: 'admin@pet.dev',
        password_hash: 'h',
        status: 'active',
        last_login_at: null,
        created_at: '2026-08-18T00:00:00Z',
      },
    ]);
    const store = new PgAdminUserStore(pool as never);
    const user = await store.findByEmail('admin@pet.dev');
    expect(user).toMatchObject({ id: 'a1', email: 'admin@pet.dev', status: 'active' });
    expect(pool.query.mock.calls[0]![1]).toEqual(['admin@pet.dev']);
  });

  it('findByEmail returns null when absent', async () => {
    const store = new PgAdminUserStore(fakePool([]) as never);
    expect(await store.findByEmail('x@y.z')).toBeNull();
  });

  it('create inserts email + hash and returns id', async () => {
    const pool = fakePool([{ id: 'a2' }]);
    const store = new PgAdminUserStore(pool as never);
    const id = await store.create('a@b.c', 'phc-hash');
    expect(id).toBe('a2');
    expect(pool.query.mock.calls[0]![1]).toEqual(['a@b.c', 'phc-hash']);
  });

  it('setStatus and recordLogin issue the right updates', async () => {
    const pool = fakePool();
    const store = new PgAdminUserStore(pool as never);
    await store.setStatus('a1', 'disabled');
    await store.recordLogin('a1');
    const [s1] = pool.query.mock.calls[0] as [string, unknown[]];
    const [s2] = pool.query.mock.calls[1] as [string, unknown[]];
    expect(s1).toContain('update admin_users set status');
    expect(s2).toContain('last_login_at');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /e/A_Project/ai-social-desktop-pet && npx vitest run apps/server/src/db/admin-stores.test.ts`
Expected: FAIL —— `PgAdminUserStore is not a constructor`

- [ ] **Step 3: 实现（追加到 admin-stores.ts）**

```ts
export interface AdminUserRow {
  id: string;
  email: string;
  passwordHash: string;
  status: 'active' | 'disabled';
  lastLoginAt: number | null;
  createdAt: number;
}

export class PgAdminUserStore {
  constructor(private readonly pool: pg.Pool) {}

  async findByEmail(email: string): Promise<AdminUserRow | null> {
    const { rows } = await this.pool.query(
      `select id, email, password_hash, status,
              extract(epoch from last_login_at) * 1000 as last_login_at,
              extract(epoch from created_at) * 1000 as created_at
       from admin_users where email = $1`,
      [email],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      email: row.email as string,
      passwordHash: row.password_hash as string,
      status: row.status as 'active' | 'disabled',
      lastLoginAt: row.last_login_at ? Number(row.last_login_at) : null,
      createdAt: Number(row.created_at),
    };
  }

  async getById(id: string): Promise<Pick<AdminUserRow, 'id' | 'email' | 'status'> | null> {
    const { rows } = await this.pool.query(
      'select id, email, status from admin_users where id = $1',
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      email: row.email as string,
      status: row.status as 'active' | 'disabled',
    };
  }

  async create(email: string, passwordHash: string): Promise<string> {
    const { rows } = await this.pool.query(
      `insert into admin_users (email, password_hash) values ($1, $2) returning id`,
      [email, passwordHash],
    );
    return String(rows[0]!.id);
  }

  async setStatus(id: string, status: 'active' | 'disabled'): Promise<void> {
    await this.pool.query('update admin_users set status = $2, updated_at = now() where id = $1', [
      id,
      status,
    ]);
  }

  async recordLogin(id: string): Promise<void> {
    await this.pool.query('update admin_users set last_login_at = now() where id = $1', [id]);
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run apps/server/src/db/admin-stores.test.ts`
Expected: PASS（4 个用例）

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db/admin-stores.ts apps/server/src/db/admin-stores.test.ts
git commit -m "feat(server): pg admin user store"
```

---

### Task 6: RealtimeServer.kickUser

**Files:**

- Modify: `apps/server/src/realtime/ws.ts`
- Modify: `apps/server/src/realtime/ws.test.ts`

- [ ] **Step 1: 写失败测试（追加到 ws.test.ts；若文件已有连接管理用例，沿用其 helper）**

先看现有测试的建连方式，然后追加：

```ts
it('kickUser closes all connections of the user', async () => {
  const server = new RealtimeServer(jwt, {}, 30_000);
  const wss = server as unknown as {
    conns: Map<string, Set<{ close(): void; readyState: number }>>;
  };
  const closed: string[] = [];
  wss.conns.set('u1', new Set([{ close: () => closed.push('ws1'), readyState: 1 }]));
  wss.conns.set('u1', new Set([{ close: () => closed.push('ws2'), readyState: 1 }]));
  server.kickUser('u1');
  expect(closed).toEqual(['ws2']);
  server.kickUser('nobody');
  expect(closed).toEqual(['ws2']);
});
```

若现有 ws.test.ts 的 `conns` 为 private 且测试通过反射访问，保持一致写法；否则直接在测试文件顶部加 `// @ts-expect-error 测试访问私有 conns` 反射。

- [ ] **Step 2: 运行确认失败**

Run: `cd /e/A_Project/ai-social-desktop-pet && npx vitest run apps/server/src/realtime/ws.test.ts`
Expected: FAIL —— `kickUser is not a function`

- [ ] **Step 3: 实现（追加到 RealtimeServer 类，close() 之前）**

```ts
/** 强制断开某用户全部连接（账号暂停等管理操作；close 事件自然清理 conns） */
kickUser(userId: string): void {
  const set = this.conns.get(userId);
  if (!set) return;
  for (const ws of set) ws.close();
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run apps/server/src/realtime/ws.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/realtime/ws.ts apps/server/src/realtime/ws.test.ts
git commit -m "feat(server): realtime kickUser for admin suspension"
```

---

### Task 7: 管理 API 认证路由（login/refresh/revoke/me + requireAdminAuth + overview）

**Files:**

- Create: `apps/server/src/routes/admin.ts`
- Test: `apps/server/src/routes/admin.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { AdminSessionManager, SessionRotationError } from '../auth/admin-session.js';
import type { AdminSession, AdminSessionStore } from '../auth/admin-session.js';
import { JwtService } from '../auth/jwt.js';
import { hashRefreshToken } from '../auth/session.js';
import { createAdminRouter } from './admin.js';

const JWT = new JwtService({ secret: 'admin-test-secret-admin-test-secret' });

class MemoryAdminStore implements AdminSessionStore {
  sessions = new Map<string, AdminSession>();
  async save(s: AdminSession) {
    this.sessions.set(s.tokenHash, s);
  }
  async load(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }
  async rotateToken(tokenHash: string, next: AdminSession, now: number) {
    const cur = this.sessions.get(tokenHash);
    if (!cur || cur.revokedAt !== null || now >= cur.expiresAt) return false;
    this.sessions.set(tokenHash, { ...cur, revokedAt: now });
    this.sessions.set(next.tokenHash, next);
    return true;
  }
  async revokeToken(tokenHash: string) {
    const cur = this.sessions.get(tokenHash);
    if (cur) this.sessions.set(tokenHash, { ...cur, revokedAt: Date.now() });
  }
  async revokeAllForAdmin() {}
}

function buildDeps(overrides: Record<string, unknown> = {}) {
  const store = new MemoryAdminStore();
  const sessions = new AdminSessionManager(store);
  const users = {
    findByEmail: vi.fn(async (email: string) =>
      email === 'admin@pet.dev'
        ? {
            id: 'a1',
            email,
            passwordHash: 'phc',
            status: 'active',
            lastLoginAt: null,
            createdAt: 0,
          }
        : null,
    ),
    getById: vi.fn(async () => ({ id: 'a1', email: 'admin@pet.dev', status: 'active' })),
    create: vi.fn(async () => 'a1'),
    setStatus: vi.fn(async () => undefined),
    recordLogin: vi.fn(async () => undefined),
  };
  const pool = {
    query: vi.fn(async () => ({
      rows: [{ total_users: 3, online_devices: 1, chat_requests_today: 10, pending_invites: 2 }],
      rowCount: 1,
    })),
  };
  const app = createAdminRouter({
    pool: pool as never,
    jwt: JWT,
    adminSessions: sessions,
    adminSessionStore: store,
    adminUsers: users as never,
    realtime: { kickUser: vi.fn() } as never,
    waitlist: null as never,
  });
  return { app, store, users, pool };
}

// 注意：verifyPassword 对 'phc' 哈希校验不会通过——登录测试用真实 argon2 哈希
// （见 Task 7 Step 3 末尾说明：测试里把 users.findByEmail 的 passwordHash 换成
// 用 hashPasswordArgon2('Admin@123456') 生成的哈希，或 mock verifyPassword）。
describe('admin auth routes', () => {
  it('login succeeds and sets refresh cookie + access token', async () => {
    const { app, users } = buildDeps();
    const { hashPasswordArgon2 } = await import('../auth/password.js');
    users.findByEmail.mockResolvedValue({
      id: 'a1',
      email: 'admin@pet.dev',
      passwordHash: await hashPasswordArgon2('Admin@123456'),
      status: 'active',
      lastLoginAt: null,
      createdAt: 0,
    });
    const res = await app.request('/admin/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@pet.dev', password: 'Admin@123456' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessToken: string; admin: { id: string } };
    expect(body.admin.id).toBe('a1');
    expect(body.accessToken).toBeTruthy();
    expect(res.headers.get('set-cookie')).toContain('admin_refresh=');
    expect(users.recordLogin).toHaveBeenCalledWith('a1');
  });

  it('login rejects wrong password with 401 and does not set cookie', async () => {
    const { app, users } = buildDeps();
    const { hashPasswordArgon2 } = await import('../auth/password.js');
    users.findByEmail.mockResolvedValue({
      id: 'a1',
      email: 'admin@pet.dev',
      passwordHash: await hashPasswordArgon2('Admin@123456'),
      status: 'active',
      lastLoginAt: null,
      createdAt: 0,
    });
    const res = await app.request('/admin/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@pet.dev', password: 'wrong-password' }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('refresh rotates the refresh token', async () => {
    const { app, store } = buildDeps();
    const token = (await store.save) !== undefined ? await createToken(store) : '';
    const res = await app.request('/admin/auth/refresh', {
      method: 'POST',
      headers: { cookie: `admin_refresh=${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accessToken: string };
    expect(body.accessToken).toBeTruthy();
    expect(res.headers.get('set-cookie')).toContain('admin_refresh=');
  });

  it('me requires admin access token', async () => {
    const { app } = buildDeps();
    const userToken = await JWT.sign({ sub: 'u1', deviceId: 'dev-1' });
    const denied = await app.request('/admin/auth/me', {
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(denied.status).toBe(401);
    const adminToken = await JWT.signAdmin('a1');
    const ok = await app.request('/admin/auth/me', {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(ok.status).toBe(200);
  });
});

async function createToken(store: MemoryAdminStore): Promise<string> {
  const mgr = new AdminSessionManager(store);
  return mgr.createRefreshToken('a1');
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /e/A_Project/ai-social-desktop-pet && npx vitest run apps/server/src/routes/admin.test.ts`
Expected: FAIL —— 找不到模块 `./admin.js`

- [ ] **Step 3: 实现 routes/admin.ts**

```ts
/**
 * 管理 API —— 认证（独立管理员域）+ 总览 + 审计查询。
 * 与桌宠用户 API 完全隔离：requireAdminAuth 只认 role=admin 的 access token。
 */
import { createHash, randomBytes } from 'node:crypto';

import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type pg from 'pg';

import type { AdminSessionManager, AdminSessionStore } from '../auth/admin-session.js';
import { SessionRotationError } from '../auth/admin-session.js';
import type { JwtService } from '../auth/jwt.js';
import { hashRefreshToken } from '../auth/session.js';
import { verifyPassword } from '../auth/password.js';
import type { PgAdminUserStore } from '../db/admin-stores.js';
import { AuthRateLimiter, clientIpOf } from '../lib/auth-rate-limit.js';
import { queryAdminAudit, writeAdminAudit } from '../lib/admin-audit.js';

export interface AdminVariables {
  adminId: string;
}

/** 管理鉴权中间件：Bearer access token 必须携带 role=admin */
export function requireAdminAuth(
  jwt: JwtService,
): MiddlewareHandler<{ Variables: AdminVariables }> {
  return async (c, next) => {
    const auth = c.req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return c.json({ error: 'admin_unauthorized' }, 401);
    try {
      const payload = await jwt.verifyAdmin(token);
      c.set('adminId', payload.sub);
      return next();
    } catch {
      return c.json({ error: 'admin_unauthorized' }, 401);
    }
  };
}

const ADMIN_REFRESH_COOKIE = 'admin_refresh';
const GRANT_TOKEN_TTL_MS = 5 * 60_000;

/** 管理员登录限流（独立实例，与用户 auth 计数器隔离） */
const adminLimiter = new AuthRateLimiter();

function adminCookie(token: string): string {
  const secure = process.env['ADMIN_COOKIE_SECURE'] === 'true';
  return `${ADMIN_REFRESH_COOKIE}=${token}; Path=/admin; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function readCookie(
  c: { req: { header(name: string): string | undefined } },
  name: string,
): string | null {
  const cookie = c.req.header('cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

export interface AdminRouterDeps {
  pool: pg.Pool;
  jwt: JwtService;
  adminSessions: AdminSessionManager;
  adminSessionStore: AdminSessionStore;
  adminUsers: PgAdminUserStore;
  realtime: { kickUser(userId: string): void };
  waitlist: {
    invite(
      emails: string[],
    ): Promise<{ invited: Array<{ email: string; code: string }>; skipped: string[] }>;
  };
}

export function createAdminRouter(deps: AdminRouterDeps): Hono<{ Variables: AdminVariables }> {
  const app = new Hono<{ Variables: AdminVariables }>();
  const { jwt } = deps;

  app.post('/auth/login', async (c) => {
    const ip = clientIpOf(c);
    const body = (await c.req.json().catch(() => ({}))) as { email?: string; password?: string };
    const email = (body.email ?? '').toLowerCase().trim();
    if (!email) return c.json({ error: 'invalid_credentials' }, 401);

    const lock = adminLimiter.lockStatus(`admin-login:${email}`);
    if (lock.locked) return c.json({ error: 'rate_limit', retryAfterSec: lock.retryAfterSec }, 429);
    const ipCheck = adminLimiter.check(`admin-login-ip:${ip}`);
    if (!ipCheck.allowed) {
      return c.json({ error: 'rate_limit', retryAfterSec: ipCheck.retryAfterSec }, 429);
    }

    const user = await deps.adminUsers.findByEmail(email);
    const ok = user ? (await verifyPassword(body.password ?? '', user.passwordHash)).ok : false;
    if (!user || !ok) {
      adminLimiter.recordFailure(`admin-login:${email}`);
      await writeAdminAudit(deps.pool, {
        adminId: user?.id ?? null,
        action: 'admin.login_failed',
        resourceType: 'admin',
        reason: email,
        ip,
      });
      return c.json({ error: 'invalid_credentials' }, 401);
    }
    if (user.status !== 'active') return c.json({ error: 'admin_disabled' }, 403);
    adminLimiter.clear(`admin-login:${email}`);

    const refreshToken = await deps.adminSessions.createRefreshToken(user.id);
    const accessToken = await jwt.signAdmin(user.id);
    await deps.adminUsers.recordLogin(user.id);
    await writeAdminAudit(deps.pool, {
      adminId: user.id,
      action: 'admin.login',
      resourceType: 'admin',
      reason: email,
      ip,
    });
    c.header('set-cookie', adminCookie(refreshToken));
    return c.json({ accessToken, admin: { id: user.id, email: user.email } });
  });

  app.post('/auth/refresh', async (c) => {
    const token = readCookie(c, ADMIN_REFRESH_COOKIE);
    if (!token) return c.json({ error: 'admin_unauthorized' }, 401);
    try {
      const { refreshToken, adminId } = await deps.adminSessions.rotate(token);
      const accessToken = await jwt.signAdmin(adminId);
      await writeAdminAudit(deps.pool, {
        adminId,
        action: 'admin.refresh',
        resourceType: 'admin',
      });
      c.header('set-cookie', adminCookie(refreshToken));
      return c.json({ accessToken });
    } catch (e) {
      if (e instanceof SessionRotationError) return c.json({ error: 'admin_unauthorized' }, 401);
      throw e;
    }
  });

  app.post('/auth/revoke', async (c) => {
    const token = readCookie(c, ADMIN_REFRESH_COOKIE);
    if (token) {
      const session = await deps.adminSessionStore.load(hashRefreshToken(token));
      await deps.adminSessions.revokeToken(token);
      if (session) {
        await writeAdminAudit(deps.pool, {
          adminId: session.adminId,
          action: 'admin.revoke',
          resourceType: 'admin',
        });
      }
    }
    c.header(
      'set-cookie',
      `${ADMIN_REFRESH_COOKIE}=; Path=/admin; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
    return c.json({ ok: true });
  });

  app.get('/auth/me', requireAdminAuth(jwt), async (c) => {
    const admin = await deps.adminUsers.getById(c.get('adminId'));
    if (!admin) return c.json({ error: 'admin_unauthorized' }, 401);
    return c.json({ admin: { id: admin.id, email: admin.email } });
  });

  app.get('/overview', requireAdminAuth(jwt), async (c) => {
    const { rows } = await deps.pool.query(
      `select
         (select count(*) from auth.users)::int as total_users,
         (select count(*) from devices
           where revoked_at is null and last_seen_at > now() - interval '5 minutes')::int as online_devices,
         (select coalesce(sum(request_count), 0) from chat_usage
           where usage_date = current_date)::int as chat_requests_today,
         (select count(*) from waitlist where status = 'pending')::int as pending_invites`,
    );
    const r = rows[0] as {
      total_users: number;
      online_devices: number;
      chat_requests_today: number;
      pending_invites: number;
    };
    return c.json({
      totalUsers: r.total_users,
      onlineDevices: r.online_devices,
      chatRequestsToday: r.chat_requests_today,
      pendingInvites: r.pending_invites,
    });
  });

  app.get('/audit-log', requireAdminAuth(jwt), async (c) => {
    const q = c.req.query();
    const result = await queryAdminAudit(deps.pool, {
      adminId: q.adminId,
      action: q.action,
      resourceType: q.resourceType,
      from: q.from,
      to: q.to,
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    });
    return c.json(result);
  });

  return app;
}
```

补充说明（实现时遵守）：

- 测试文件里 `buildDeps` 的 `waitlist` 用 `null as never`——本任务还没实现 waitlist 路由；`createAdminRouter` 里不要在本任务引用 `deps.waitlist`，避免类型错误。waitlist 路由在 Task 15 挂进来。
- `grantToken`/`GRANT_TOKEN_TTL_MS` 为 Task 21 预留，本任务若未使用先删除这两个符号（保持无未用导出）。
- `randomBytes`/`createHash` import 同理——本任务未用则删除。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run apps/server/src/routes/admin.test.ts`
Expected: PASS（4 个用例）

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/admin.ts apps/server/src/routes/admin.test.ts
git commit -m "feat(server): admin auth routes (login/refresh/revoke/me) + overview + audit query"
```

---

### Task 8: 挂载 /admin 到服务入口 + 用户登录拦截暂停账号

**Files:**

- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/routes/auth.ts`
- Modify: `apps/server/src/db/stores.ts`（PgUsersStore.findByEmail 返回 account_status）
- Test: `apps/server/src/routes/auth.test.ts`

- [ ] **Step 1: 写失败测试（auth.test.ts 追加）**

```ts
it('login rejects suspended accounts', async () => {
  deps.users.findByEmail = vi.fn(async () => ({
    id: 'u1',
    passwordHash: await hashPasswordArgon2('password123'),
    account_status: 'suspended',
  }));
  const res = await loginRequest({ email: 'a@b.com', password: 'password123' });
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: 'account_suspended' });
});
```

（`hashPasswordArgon2` 已在 auth.test.ts 顶部导入；`loginRequest` 复用现有 helper。若现有 fake users 的 findByEmail 返回对象没有 `account_status`，先跑测试确认失败信息，再把所有 fake 返回补上 `account_status: 'active'`。）

- [ ] **Step 2: 运行确认失败**

Run: `cd /e/A_Project/ai-social-desktop-pet && npx vitest run apps/server/src/routes/auth.test.ts`
Expected: FAIL —— login 仍返回 200（未拦截 suspended）

- [ ] **Step 3: 实现**

3a. `apps/server/src/db/stores.ts` —— PgUsersStore.findByEmail 的 SELECT 增加 `account_status`：

```ts
async findByEmail(email: string): Promise<{ id: string; passwordHash: string; accountStatus: 'active' | 'suspended' } | null> {
  const { rows } = await this.pool.query(
    `select id, password_hash, account_status from auth.users where email = $1`,
    [email],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    passwordHash: row.password_hash as string,
    accountStatus: row.account_status as 'active' | 'suspended',
  };
}
```

（先读 stores.ts 里现有 findByEmail 的完整实现，保持原有字段映射与调用方兼容——`AuthDeps['users'].findByEmail` 返回类型同步扩展。）

3b. `apps/server/src/routes/auth.ts` —— login 与 otp/login 在校验密码前拦截：

```ts
// login 路径（verifyPassword 之后、签发 token 之前）：
if (user.accountStatus === 'suspended') {
  return c.json({ error: 'account_suspended' }, 403);
}
// otp/login 路径（findByEmail 之后）同样加这一行
```

`AuthDeps['users'].findByEmail` 类型改为 `Promise<{ id: string; passwordHash: string; accountStatus: 'active' | 'suspended' } | null>`，auth.test.ts 里所有 fake 补 `accountStatus: 'active'`。

3c. `apps/server/src/index.ts` —— 挂载管理路由：

```ts
// 顶部 import：
import { AdminSessionManager } from './auth/admin-session.js';
import { PgAdminSessionStore, PgAdminUserStore } from './db/admin-stores.js';
import { createAdminRouter } from './routes/admin.js';

// main() 中（users/devices 创建之后）：
const adminSessionStore = new PgAdminSessionStore(pool);
const adminSessions = new AdminSessionManager(adminSessionStore);
const adminUsers = new PgAdminUserStore(pool);
// waitlist 服务提升为共享实例（auth 与 admin 复用）：
const waitlistService = new WaitlistService(pool, mailProvider);
```

`buildApp(deps)` 增加 `admin?: ReturnType<typeof buildAdminRouter>` 依赖，或直接在 buildApp 内组装（推荐后者，保持 buildApp 单一职责）：

```ts
// buildApp 内、business 挂载之后：
const admin = createAdminRouter({
  pool: deps.pool,
  jwt: deps.jwt,
  adminSessions: deps.adminSessions,
  adminSessionStore: deps.adminSessionStore,
  adminUsers: deps.adminUsers,
  realtime: deps.realtime,
  waitlist: deps.waitlist,
});
app.route('/admin', admin);
```

`AppDeps` 相应增加 `adminSessions / adminSessionStore / adminUsers / waitlist` 字段；`createAuthRouter` 的 waitlist 注入改用同一个 `waitlistService`。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run apps/server/src/routes/auth.test.ts`
Expected: PASS（含新增 suspended 用例）

- [ ] **Step 5: 类型检查 + 提交**

Run: `pnpm --filter @pet/server typecheck`
Expected: 无错误

```bash
git add apps/server/src/index.ts apps/server/src/routes/auth.ts apps/server/src/db/stores.ts apps/server/src/routes/auth.test.ts
git commit -m "feat(server): mount /admin routes + block suspended account login"
```

---

### Task 9: 管理员初始化 CLI

**Files:**

- Create: `apps/server/scripts/admin-create.ts`
- Modify: `apps/server/package.json`

- [ ] **Step 1: 写脚本**

```ts
/**
 * 管理员初始化 CLI：pnpm --filter @pet/server admin:create <email>
 * 密码读取优先级：ADMIN_PASSWORD 环境变量 > 交互输入。绝不写入仓库/migration。
 */
import { createInterface } from 'node:readline/promises';

import { hashPasswordArgon2 } from '../src/auth/password.js';
import { PgAdminUserStore } from '../src/db/admin-stores.js';
import { createPool } from '../src/db/pool.js';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v;
}

async function main(): Promise<void> {
  const email = (process.argv[2] ?? '').toLowerCase().trim();
  if (!email || !email.includes('@')) {
    console.error('用法：pnpm --filter @pet/server admin:create <email>');
    process.exit(1);
  }
  let password = process.env['ADMIN_PASSWORD'] ?? '';
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question('管理员密码（≥12 位）：');
    rl.close();
  }
  if (password.length < 12) {
    console.error('管理员密码至少 12 位');
    process.exit(1);
  }
  const pool = createPool({ connectionString: env('DATABASE_URL') });
  try {
    const store = new PgAdminUserStore(pool);
    const exists = await store.findByEmail(email);
    if (exists) {
      console.error(`管理员已存在：${email}`);
      process.exit(1);
    }
    const id = await store.create(email, await hashPasswordArgon2(password));
    console.log(`管理员创建成功：${email}（id=${id}）`);
  } finally {
    await pool.end();
  }
}

void main();
```

- [ ] **Step 2: package.json 增加脚本**

```json
"admin:create": "tsx --env-file=.env.local scripts/admin-create.ts"
```

- [ ] **Step 3: 实测创建本机管理员（交互输入密码或 ADMIN_PASSWORD）**

Run:

```bash
cd /e/A_Project/ai-social-desktop-pet && ADMIN_PASSWORD='Admin@123456' pnpm --filter @pet/server admin:create admin@pet.dev
```

Expected: `管理员创建成功：admin@pet.dev（id=...）`；重复运行输出 `管理员已存在`。

- [ ] **Step 4: Commit**

```bash
git add apps/server/scripts/admin-create.ts apps/server/package.json
git commit -m "feat(server): admin:create CLI"
```

---

### Task 10: apps/admin 脚手架 + 登录页

**Files:**

- Create: `apps/admin/package.json`
- Create: `apps/admin/vite.config.ts`
- Create: `apps/admin/tsconfig.json`
- Create: `apps/admin/src/index.html`
- Create: `apps/admin/src/main.tsx`
- Create: `apps/admin/src/api.ts`
- Create: `apps/admin/src/pages/login.tsx`
- Create: `apps/admin/src/styles.css`
- Test: `apps/admin/src/pages/login.test.tsx`
- Modify: `package.json`（根，dev:admin 脚本）
- Modify: `vitest.config.ts`（include apps/admin）

- [ ] **Step 1: 脚手架文件**

`apps/admin/package.json`：

```json
{
  "name": "@pet/admin",
  "version": "0.0.0",
  "private": true,
  "description": "运营管理后台（单管理员：用户/设备/用量/邀请/敏感数据/审计）",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.2",
    "typescript": "^5.6.2",
    "vite": "^5.4.8"
  }
}
```

`apps/admin/vite.config.ts`：

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  root: 'src',
  build: { outDir: '../dist' },
  server: {
    port: 5175,
    strictPort: true,
    // dev 同源代理：/admin/* 转发到自建后端（cookie 保持同源语义）
    proxy: { '/admin': 'http://127.0.0.1:8787' },
  },
});
```

`apps/admin/tsconfig.json`：

```json
{
  "extends": "@pet/tsconfig/web.json",
  "compilerOptions": {
    "rootDir": "src",
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`apps/admin/src/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>星屿运营后台</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`apps/admin/src/main.tsx`：

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`apps/admin/src/api.ts`：

```ts
/**
 * 管理 API 客户端：Bearer access token 只在内存；
 * 401 自动 refresh 一次（cookie）后重试，失败抛 AdminUnauthorized。
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export class AdminUnauthorized extends Error {
  constructor() {
    super('admin_unauthorized');
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  skipRefresh?: boolean;
}

async function raw<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  const res = await fetch(`/admin${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (res.status === 401 && !opts.skipRefresh) {
    const refreshed = await raw<{ accessToken: string }>('/auth/refresh', {
      method: 'POST',
      body: {},
      skipRefresh: true,
    }).catch(() => null);
    if (refreshed) {
      setAccessToken(refreshed.accessToken);
      return raw<T>(path, { ...opts, skipRefresh: true });
    }
    throw new AdminUnauthorized();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new AdminApiError(res.status, body.error ?? `http_${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const adminApi = {
  login(email: string, password: string) {
    return raw<{ accessToken: string; admin: { id: string; email: string } }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
  },
  me() {
    return raw<{ admin: { id: string; email: string } }>('/auth/me');
  },
  logout() {
    return raw<{ ok: true }>('/auth/revoke', { method: 'POST', body: {} });
  },
  overview() {
    return raw<{
      totalUsers: number;
      onlineDevices: number;
      chatRequestsToday: number;
      pendingInvites: number;
    }>('/overview');
  },
};
```

`apps/admin/src/pages/login.tsx`：

```tsx
import { useState } from 'react';

import { adminApi, setAccessToken, AdminApiError } from '../api.js';

export function LoginPage({ onAuthed }: { onAuthed(): void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { accessToken } = await adminApi.login(email, password);
      setAccessToken(accessToken);
      onAuthed();
    } catch (err) {
      if (err instanceof AdminApiError && err.code === 'rate_limit') {
        setError('尝试过于频繁，请稍后再试');
      } else if (err instanceof AdminApiError && err.code === 'admin_disabled') {
        setError('管理员账号已停用');
      } else {
        setError('邮箱或密码不正确');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>星屿运营后台</h1>
        <label>
          邮箱
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
    </main>
  );
}
```

`apps/admin/src/app.tsx`（本任务先做登录切换，主界面骨架 Task 11 补）：

```tsx
import { useEffect, useState } from 'react';

import { adminApi, setAccessToken } from './api.js';
import { LoginPage } from './pages/login.js';

type SessionState = 'loading' | 'anonymous' | 'authed';

export function App() {
  const [session, setSession] = useState<SessionState>('loading');

  useEffect(() => {
    let cancelled = false;
    adminApi
      .me()
      .then(() => {
        if (!cancelled) setSession('authed');
      })
      .catch(() => {
        if (!cancelled) {
          setAccessToken(null);
          setSession('anonymous');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (session === 'loading') return <div className="boot">正在载入…</div>;
  if (session === 'anonymous') return <LoginPage onAuthed={() => setSession('authed')} />;
  return <div className="boot">登录成功（主界面将在后续任务接入）</div>;
}
```

`apps/admin/src/styles.css`（本任务最小可用，后续任务扩展）：

```css
:root {
  color-scheme: light;
  font-family:
    system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #f4f6fb;
  color: #1c2333;
}

.boot {
  padding: 48px;
  text-align: center;
  color: #6b7280;
}

.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-card {
  width: 340px;
  padding: 28px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgb(0 0 0 / 0.08);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.login-card h1 {
  margin: 0 0 4px;
  font-size: 20px;
}

.login-card label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: #4b5563;
}

.login-card input {
  padding: 9px 10px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
}

.login-card button {
  margin-top: 6px;
  padding: 10px;
  border: 0;
  border-radius: 8px;
  background: #4f46e5;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}

.login-card button:disabled {
  opacity: 0.6;
  cursor: default;
}

.form-error {
  margin: 0;
  color: #dc2626;
  font-size: 13px;
}
```

- [ ] **Step 2: 写登录页测试**

`apps/admin/src/pages/login.test.tsx`：

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setAccessToken } from '../api.js';
import { LoginPage } from './login.js';

afterEach(() => {
  cleanup();
  setAccessToken(null);
  vi.restoreAllMocks();
});

describe('LoginPage', () => {
  it('renders email/password and submits to login', async () => {
    const onAuthed = vi.fn();
    const login = vi.spyOn(await import('../api.js').then((m) => m.adminApi), 'login');
    login.mockResolvedValue({ accessToken: 't1', admin: { id: 'a1', email: 'admin@pet.dev' } });

    render(<LoginPage onAuthed={onAuthed} />);
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'admin@pet.dev' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'Admin@123456' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '登录' }));
    });

    expect(login).toHaveBeenCalledWith('admin@pet.dev', 'Admin@123456');
    expect(onAuthed).toHaveBeenCalled();
  });

  it('shows an error message on invalid credentials', async () => {
    const login = vi.spyOn(await import('../api.js').then((m) => m.adminApi), 'login');
    login.mockRejectedValue(new Error('http_401'));

    render(<LoginPage onAuthed={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'x@y.z' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '登录' }));
    });

    expect(screen.getByRole('alert').textContent).toContain('邮箱或密码不正确');
  });
});
```

- [ ] **Step 3: 运行确认失败（模块缺失）→ 补脚手架后通过**

Run: `cd /e/A_Project/ai-social-desktop-pet && npx vitest run apps/admin/src/pages/login.test.tsx`
Expected: 先 FAIL（找不到模块），补全文件后 PASS（2 个用例）

- [ ] **Step 4: 根配置接线**

`package.json`（根）scripts 增加：

```json
"dev:admin": "pnpm --filter @pet/admin dev"
```

`vitest.config.ts` include 数组增加：

```ts
'apps/admin/src/**/*.test.ts',
'apps/admin/src/**/*.test.tsx',
```

- [ ] **Step 5: 安装依赖 + 类型检查 + 本地启动验证**

Run:

```bash
pnpm install
pnpm --filter @pet/admin typecheck
pnpm --filter @pet/admin dev
```

Expected: typecheck 无错误；dev server 监听 5175；浏览器打开 http://localhost:5175 显示登录页（后端 8787 需在运行）。

- [ ] **Step 6: Commit**

```bash
git add apps/admin package.json vitest.config.ts pnpm-lock.yaml
git commit -m "feat(admin): scaffold React admin app with login page"
```

---

## Phase 1：统一管理核心

### Task 11: 用户列表/详情 API

**Files:**

- Create: `apps/server/src/routes/admin-users.ts`
- Modify: `apps/server/src/routes/admin.ts`（组装 admin-users 路由）
- Test: `apps/server/src/routes/admin-users.test.ts`

- [ ] **Step 1: 写失败测试（fake pool 按 SQL 片段分流返回值）**

```ts
import { describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';
import { createAdminUsersRouter } from './admin-users.js';

const JWT = new JwtService({ secret: 'admin-test-secret-admin-test-secret' });

function buildRouter(
  rowsByFragment: Array<{ fragment: string; rows: unknown[]; rowCount?: number }>,
) {
  const pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      const hit = rowsByFragment.find((r) => sql.includes(r.fragment));
      if (!hit) return { rows: [], rowCount: 0 };
      return { rows: hit.rows, rowCount: hit.rowCount ?? hit.rows.length };
    }),
  };
  const app = createAdminUsersRouter({
    pool: pool as never,
    jwt: JWT,
    realtime: { kickUser: vi.fn() } as never,
    writeAudit: vi.fn(async () => undefined) as never,
  });
  return { app, pool };
}

describe('admin users routes', () => {
  it('lists users with pagination and filters', async () => {
    const { app } = buildRouter([
      {
        fragment: 'count(*)',
        rows: [{ total: 1 }],
      },
      {
        fragment: 'from auth.users u',
        rows: [
          {
            user_id: 'u1',
            email: 'a@b.c',
            nickname: '测试',
            account_status: 'active',
            created_at: '2026-08-01T00:00:00Z',
            device_count: 2,
            online: 1,
            last_seen_at: '2026-08-18T00:00:00Z',
          },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/admin/users?q=test&status=active&page=1&pageSize=10', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      items: Array<{ email: string; deviceCount: number }>;
    };
    expect(body.total).toBe(1);
    expect(body.items[0]!.email).toBe('a@b.c');
    expect(body.items[0]!.deviceCount).toBe(2);
  });

  it('requires admin token (user token rejected)', async () => {
    const { app } = buildRouter([]);
    const userToken = await JWT.sign({ sub: 'u1', deviceId: 'dev-1' });
    const res = await app.request('/admin/users', {
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(401);
  });

  it('returns user detail with counts', async () => {
    const { app } = buildRouter([
      {
        fragment: 'where u.id = $1',
        rows: [
          {
            user_id: 'u1',
            email: 'a@b.c',
            nickname: '测试',
            account_status: 'active',
            suspended_at: null,
            suspended_reason: null,
            created_at: '2026-08-01T00:00:00Z',
            device_count: 2,
            chat_requests_7d: 5,
            pet_count: 1,
            friend_count: 0,
            memory_count: 3,
          },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/admin/users/u1', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string; chatRequests7d: number };
    expect(body.email).toBe('a@b.c');
    expect(body.chatRequests7d).toBe(5);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /e/A_Project/ai-social-desktop-pet && npx vitest run apps/server/src/routes/admin-users.test.ts`
Expected: FAIL —— 找不到模块

- [ ] **Step 3: 实现 routes/admin-users.ts**

```ts
/**
 * 管理 API —— 用户/设备（列表、详情、暂停/恢复、撤销）。
 * 用户维度数据读取沿用"事务内 set request.jwt.claims = 目标用户"的 RLS 兼容模式
 * （与 memory-store 相同语义；无 RLS 的表不受影响）。
 */
import { Hono } from 'hono';
import type pg from 'pg';

import type { JwtService } from '../auth/jwt.js';
import type { AdminVariables } from './admin.js';
import { requireAdminAuth } from './admin.js';

/** 以目标用户身份运行查询（RLS 兼容：set local request.jwt.claims） */
export async function withUserClaims<T>(
  pool: pg.Pool,
  userId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId }),
    ]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

export interface AdminUsersDeps {
  pool: pg.Pool;
  jwt: JwtService;
  realtime: { kickUser(userId: string): void };
  writeAudit(entry: {
    adminId: string;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    reason?: string | null;
    ip?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export function createAdminUsersRouter(deps: AdminUsersDeps): Hono<{ Variables: AdminVariables }> {
  const app = new Hono<{ Variables: AdminVariables }>();
  const auth = requireAdminAuth(deps.jwt);

  app.get('/users', auth, async (c) => {
    const q = c.req.query();
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20)));
    const keyword = (q.q ?? '').trim();
    const status = q.status ?? '';
    const countParams = [keyword, status];
    const count = await deps.pool.query(
      `select count(*)::int as total
       from auth.users u left join profiles p on p.user_id = u.id
       where ($1 = '' or u.email ilike '%' || $1 || '%'
              or p.nickname ilike '%' || $1 || '%'
              or u.id::text = $1)
         and ($2 = '' or u.account_status = $2)`,
      countParams,
    );
    const listParams = [...countParams, pageSize, (page - 1) * pageSize];
    const { rows } = await deps.pool.query(
      `select u.id as user_id, u.email, p.nickname, u.account_status, u.created_at,
              (select count(*) from devices d where d.user_id = u.id)::int as device_count,
              (select max(d.last_seen_at) from devices d where d.user_id = u.id) as last_seen_at,
              (select count(*) from devices d
                where d.user_id = u.id and d.revoked_at is null
                  and d.last_seen_at > now() - interval '5 minutes')::int as online
       from auth.users u left join profiles p on p.user_id = u.id
       where ($1 = '' or u.email ilike '%' || $1 || '%'
              or p.nickname ilike '%' || $1 || '%'
              or u.id::text = $1)
         and ($2 = '' or u.account_status = $2)
       order by u.created_at desc
       limit $3 offset $4`,
      listParams,
    );
    return c.json({
      total: Number(count.rows[0]?.total ?? 0),
      page,
      pageSize,
      items: rows.map((r) => ({
        userId: String(r.user_id),
        email: r.email as string,
        nickname: r.nickname as string | null,
        accountStatus: r.account_status as string,
        createdAt: r.created_at as string,
        deviceCount: Number(r.device_count),
        online: Number(r.online) > 0,
        lastSeenAt: r.last_seen_at as string | null,
      })),
    });
  });

  app.get('/users/:userId', auth, async (c) => {
    const userId = c.req.param('userId');
    const { rows } = await deps.pool.query(
      `select u.id as user_id, u.email, p.nickname, u.account_status, u.suspended_at,
              u.suspended_reason, u.created_at,
              (select count(*) from devices d where d.user_id = u.id)::int as device_count,
              (select coalesce(sum(request_count), 0) from chat_usage cu
                where cu.user_id = u.id and cu.usage_date >= current_date - 6)::int as chat_requests_7d,
              (select count(*) from pets pt where pt.owner_user_id = u.id)::int as pet_count,
              (select count(*) from friendships f
                where (f.user_low_id = u.id or f.user_high_id = u.id) and f.status = 'active')::int as friend_count,
              (select count(*) from private_memories pm where pm.owner_user_id = u.id)::int as memory_count
       from auth.users u left join profiles p on p.user_id = u.id
       where u.id = $1`,
      [userId],
    );
    const r = rows[0];
    if (!r) return c.json({ error: 'not_found' }, 404);
    return c.json({
      userId: String(r.user_id),
      email: r.email as string,
      nickname: r.nickname as string | null,
      accountStatus: r.account_status as string,
      suspendedAt: r.suspended_at as string | null,
      suspendedReason: r.suspended_reason as string | null,
      createdAt: r.created_at as string,
      deviceCount: Number(r.device_count),
      chatRequests7d: Number(r.chat_requests_7d),
      petCount: Number(r.pet_count),
      friendCount: Number(r.friend_count),
      memoryCount: Number(r.memory_count),
    });
  });

  app.post('/users/:userId/suspend', auth, async (c) => {
    const adminId = c.get('adminId');
    const userId = c.req.param('userId');
    const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
    const reason = (body.reason ?? '').trim();
    if (reason.length < 1 || reason.length > 500) {
      return c.json({ error: 'invalid_input' }, 422);
    }
    const client = await deps.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId }),
      ]);
      const updated = await client.query(
        `update auth.users set account_status = 'suspended', suspended_at = now(), suspended_reason = $2
         where id = $1 and account_status <> 'suspended'
         returning id`,
        [userId, reason],
      );
      if ((updated.rowCount ?? 0) === 0) {
        await client.query('rollback');
        return c.json({ error: 'already_suspended' }, 409);
      }
      await client.query(
        'update refresh_sessions set revoked_at = now() where user_id = $1 and revoked_at is null',
        [userId],
      );
      await client.query(
        'update devices set revoked_at = now() where user_id = $1 and revoked_at is null',
        [userId],
      );
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    deps.realtime.kickUser(userId);
    await deps.writeAudit({
      adminId,
      action: 'user.suspend',
      resourceType: 'user',
      resourceId: userId,
      reason,
      ip: c.req.header('x-forwarded-for'),
    });
    return c.json({ ok: true });
  });

  app.post('/users/:userId/restore', auth, async (c) => {
    const adminId = c.get('adminId');
    const userId = c.req.param('userId');
    const updated = await deps.pool.query(
      `update auth.users set account_status = 'active', suspended_at = null, suspended_reason = null
       where id = $1 and account_status = 'suspended'
       returning id`,
      [userId],
    );
    if ((updated.rowCount ?? 0) === 0) return c.json({ error: 'not_suspended' }, 409);
    await deps.writeAudit({
      adminId,
      action: 'user.restore',
      resourceType: 'user',
      resourceId: userId,
      ip: c.req.header('x-forwarded-for'),
    });
    return c.json({ ok: true });
  });

  app.get('/users/:userId/devices', auth, async (c) => {
    const userId = c.req.param('userId');
    const { rows } = await withUserClaims(deps.pool, userId, (client) =>
      client.query(
        `select device_id, platform, app_version, last_seen_at, revoked_at
         from devices where user_id = $1 order by last_seen_at desc`,
        [userId],
      ),
    );
    return c.json({
      items: rows.map((r) => ({
        deviceId: String(r.device_id),
        platform: r.platform as string,
        appVersion: r.app_version as string | null,
        lastSeenAt: r.last_seen_at as string,
        revokedAt: r.revoked_at as string | null,
      })),
    });
  });

  app.post('/devices/:deviceId/revoke', auth, async (c) => {
    const adminId = c.get('adminId');
    const deviceId = c.req.param('deviceId');
    const { rows } = await deps.pool.query(
      `update devices set revoked_at = now()
       where device_id = $1 and revoked_at is null
       returning user_id`,
      [deviceId],
    );
    const r = rows[0];
    if (!r) return c.json({ error: 'not_found' }, 404);
    await deps.pool.query(
      'update refresh_sessions set revoked_at = now() where device_id = $1 and revoked_at is null',
      [deviceId],
    );
    await deps.writeAudit({
      adminId,
      action: 'device.revoke',
      resourceType: 'device',
      resourceId: deviceId,
      reason: String(r.user_id),
      ip: c.req.header('x-forwarded-for'),
    });
    return c.json({ ok: true });
  });

  return app;
}
```

- [ ] **Step 4: 组装到 admin.ts（createAdminRouter 内，audit-log 之后）**

```ts
// admin.ts 顶部 import：
import { createAdminUsersRouter } from './admin-users.js';

// createAdminRouter 内：
const usersRouter = createAdminUsersRouter({
  pool: deps.pool,
  jwt,
  realtime: deps.realtime,
  writeAudit: (entry) => writeAdminAudit(deps.pool, entry),
});
app.route('/', usersRouter);
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run apps/server/src/routes/admin-users.test.ts apps/server/src/routes/admin.test.ts`
Expected: 两组 PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/admin-users.ts apps/server/src/routes/admin.ts apps/server/src/routes/admin-users.test.ts
git commit -m "feat(server): admin users/devices list, detail, suspend/restore, revoke"
```

---

### Task 12: 用量 API

**Files:**

- Create: `apps/server/src/routes/admin-usage.ts`
- Modify: `apps/server/src/routes/admin.ts`（组装）
- Test: `apps/server/src/routes/admin-usage.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';
import { createAdminUsageRouter } from './admin-usage.js';

const JWT = new JwtService({ secret: 'admin-test-secret-admin-test-secret' });

function buildRouter(rowsByFragment: Array<{ fragment: string; rows: unknown[] }>) {
  const pool = {
    query: vi.fn(async (sql: string) => {
      const hit = rowsByFragment.find((r) => sql.includes(r.fragment));
      return { rows: hit?.rows ?? [], rowCount: hit?.rows.length ?? 0 };
    }),
  };
  return {
    app: createAdminUsageRouter({ pool: pool as never, jwt: JWT }),
    pool,
  };
}

describe('admin usage routes', () => {
  it('returns daily usage with summary', async () => {
    const { app } = buildRouter([
      {
        fragment: 'sum(request_count)',
        rows: [{ total: 2, requests: 30, tokens: 4000 }],
      },
      {
        fragment: 'group by usage_date',
        rows: [{ usage_date: '2026-08-18', requests: 20, tokens: 2500 }],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/admin/usage?from=2026-08-01&to=2026-08-18', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { requests: number; tokens: number };
      items: Array<{ usageDate: string; requests: number }>;
    };
    expect(body.summary.requests).toBe(30);
    expect(body.items[0]!.usageDate).toBe('2026-08-18');
  });

  it('returns per-user usage', async () => {
    const { app } = buildRouter([
      {
        fragment: 'where user_id = $1',
        rows: [{ usage_date: '2026-08-18', requests: 5, tokens: 600 }],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/admin/usage/users/u1?from=2026-08-01', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ requests: number }> };
    expect(body.items[0]!.requests).toBe(5);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /e/A_Project/ai-social-desktop-pet && npx vitest run apps/server/src/routes/admin-usage.test.ts`
Expected: FAIL —— 找不到模块

- [ ] **Step 3: 实现 routes/admin-usage.ts**

```ts
/**
 * 管理 API —— 用量（chat_usage 聚合）。
 * 服务端统一限制最大时间跨度（31 天），防止后台查询压垮业务库。
 */
import { Hono } from 'hono';
import type pg from 'pg';

import type { JwtService } from '../auth/jwt.js';
import type { AdminVariables } from './admin.js';
import { requireAdminAuth } from './admin.js';

const MAX_RANGE_DAYS = 31;

export interface AdminUsageDeps {
  pool: pg.Pool;
  jwt: JwtService;
}

export function createAdminUsageRouter(deps: AdminUsageDeps): Hono<{ Variables: AdminVariables }> {
  const app = new Hono<{ Variables: AdminVariables }>();
  const auth = requireAdminAuth(deps.jwt);

  app.get('/usage', auth, async (c) => {
    const q = c.req.query();
    const from =
      q.from ?? String(new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10));
    const to = q.to ?? String(new Date().toISOString().slice(0, 10));
    if (from > to) return c.json({ error: 'invalid_input' }, 422);

    const { rows } = await deps.pool.query(
      `select usage_date, sum(request_count)::int as requests, sum(token_estimate)::int as tokens
       from chat_usage
       where usage_date between $1::date and $2::date
       group by usage_date
       order by usage_date desc`,
      [from, to],
    );
    const summary = await deps.pool.query(
      `select count(*)::int as total,
              coalesce(sum(request_count), 0)::int as requests,
              coalesce(sum(token_estimate), 0)::int as tokens
       from chat_usage where usage_date between $1::date and $2::date`,
      [from, to],
    );
    return c.json({
      summary: {
        requests: Number(summary.rows[0]?.requests ?? 0),
        tokens: Number(summary.rows[0]?.tokens ?? 0),
      },
      items: rows.map((r) => ({
        usageDate: r.usage_date as string,
        requests: Number(r.requests),
        tokens: Number(r.tokens),
      })),
    });
  });

  app.get('/usage/users/:userId', auth, async (c) => {
    const userId = c.req.param('userId');
    const q = c.req.query();
    const from =
      q.from ?? String(new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10));
    const to = q.to ?? String(new Date().toISOString().slice(0, 10));
    if (from > to) return c.json({ error: 'invalid_input' }, 422);

    const { rows } = await deps.pool.query(
      `select usage_date, request_count as requests, token_estimate as tokens
       from chat_usage
       where user_id = $1 and usage_date between $2::date and $3::date
       order by usage_date desc`,
      [userId, from, to],
    );
    return c.json({
      items: rows.map((r) => ({
        usageDate: r.usage_date as string,
        requests: Number(r.requests),
        tokens: Number(r.tokens),
      })),
    });
  });

  return app;
}
```

`MAX_RANGE_DAYS` 本任务未真正约束跨度（from/to 直接透传）——在实现时把跨度校验加上：`const days = (Date.parse(to) - Date.parse(from)) / 86_400_000; if (days > MAX_RANGE_DAYS) return c.json({ error: 'invalid_input' }, 422);`（测试补充一个 32 天跨度返回 422 的用例）。

- [ ] **Step 4: 组装到 admin.ts**

```ts
import { createAdminUsageRouter } from './admin-usage.js';
// createAdminRouter 内：
app.route('/', createAdminUsageRouter({ pool: deps.pool, jwt }));
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run apps/server/src/routes/admin-usage.test.ts apps/server/src/routes/admin.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/admin-usage.ts apps/server/src/routes/admin.ts apps/server/src/routes/admin-usage.test.ts
git commit -m "feat(server): admin usage APIs"
```

---

### Task 13: waitlist 管理 API

**Files:**

- Create: `apps/server/src/routes/admin-waitlist.ts`
- Modify: `apps/server/src/routes/admin.ts`（组装）
- Test: `apps/server/src/routes/admin-waitlist.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';
import { createAdminWaitlistRouter } from './admin-waitlist.js';

const JWT = new JwtService({ secret: 'admin-test-secret-admin-test-secret' });

function buildRouter(overrides: { listRows?: unknown[]; invite?: unknown; expire?: unknown } = {}) {
  const pool = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('count(*)'))
        return { rows: [{ total: overrides.listRows?.length ?? 0 }], rowCount: 0 };
      if (sql.includes('from waitlist w')) return { rows: overrides.listRows ?? [], rowCount: 0 };
      if (sql.includes("status = 'expired'"))
        return { rows: overrides.expire ? [{}] : [], rowCount: overrides.expire ? 1 : 0 };
      return { rows: [], rowCount: 0 };
    }),
  };
  const waitlist = {
    invite: vi.fn(async () => overrides.invite ?? { invited: [], skipped: ['x@y.z'] }),
  };
  return {
    app: createAdminWaitlistRouter({
      pool: pool as never,
      jwt: JWT,
      waitlist: waitlist as never,
      writeAudit: vi.fn(async () => undefined) as never,
    }),
    pool,
    waitlist,
  };
}

describe('admin waitlist routes', () => {
  it('lists waitlist entries', async () => {
    const { app } = buildRouter({
      listRows: [
        {
          id: 'w1',
          email: 'a@b.c',
          status: 'pending',
          created_at: '2026-08-01T00:00:00Z',
          invited_at: null,
          invite_expires_at: null,
          claimed_at: null,
        },
      ],
    });
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/admin/waitlist?status=pending', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ email: string; status: string }> };
    expect(body.items[0]!.email).toBe('a@b.c');
  });

  it('invite issues a code via WaitlistService', async () => {
    const { app, waitlist } = buildRouter({
      invite: { invited: [{ email: 'a@b.c', code: 'ABCD1234' }], skipped: [] },
    });
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/admin/waitlist/w1/invite', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('ABCD1234');
    expect(waitlist.invite).toHaveBeenCalledWith(['a@b.c']);
  });

  it('invite returns 409 when the entry is not pending', async () => {
    const { app } = buildRouter({ invite: { invited: [], skipped: ['a@b.c'] } });
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/admin/waitlist/w1/invite', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(409);
  });

  it('expire marks invited entries expired', async () => {
    const { app } = buildRouter({ expire: true });
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/admin/waitlist/w1/expire', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /e/A_Project/ai-social-desktop-pet && npx vitest run apps/server/src/routes/admin-waitlist.test.ts`
Expected: FAIL —— 找不到模块

- [ ] **Step 3: 实现 routes/admin-waitlist.ts**

```ts
/**
 * 管理 API —— waitlist / 邀请（列表、发放、过期）。
 * 发放复用 WaitlistService.invite（状态机 + 邀请邮件 + 兑换码只存哈希）。
 */
import { Hono } from 'hono';
import type pg from 'pg';

import type { JwtService } from '../auth/jwt.js';
import type { AdminVariables } from './admin.js';
import { requireAdminAuth } from './admin.js';

export interface AdminWaitlistDeps {
  pool: pg.Pool;
  jwt: JwtService;
  waitlist: {
    invite(
      emails: string[],
    ): Promise<{ invited: Array<{ email: string; code: string }>; skipped: string[] }>;
  };
  writeAudit(entry: {
    adminId: string;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    reason?: string | null;
    ip?: string | null;
  }): Promise<void>;
}

export function createAdminWaitlistRouter(
  deps: AdminWaitlistDeps,
): Hono<{ Variables: AdminVariables }> {
  const app = new Hono<{ Variables: AdminVariables }>();
  const auth = requireAdminAuth(deps.jwt);

  app.get('/waitlist', auth, async (c) => {
    const q = c.req.query();
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20)));
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
    const { rows } = await deps.pool.query('select email from waitlist where id = $1', [id]);
    const row = rows[0];
    if (!row) return c.json({ error: 'not_found' }, 404);
    const result = await deps.waitlist.invite([row.email as string]);
    const invited = result.invited[0];
    if (!invited) return c.json({ error: 'not_pending' }, 409);
    await deps.writeAudit({
      adminId,
      action: 'waitlist.invite',
      resourceType: 'waitlist',
      resourceId: id,
      reason: row.email as string,
      ip: c.req.header('x-forwarded-for'),
    });
    return c.json({ ok: true, code: invited.code });
  });

  app.post('/waitlist/:id/expire', auth, async (c) => {
    const adminId = c.get('adminId');
    const id = c.req.param('id');
    const updated = await deps.pool.query(
      `update waitlist set status = 'expired'
       where id = $1 and status = 'invited'
       returning email`,
      [id],
    );
    if ((updated.rowCount ?? 0) === 0) return c.json({ error: 'not_invited' }, 409);
    await deps.writeAudit({
      adminId,
      action: 'waitlist.expire',
      resourceType: 'waitlist',
      resourceId: id,
      reason: updated.rows[0]?.email as string | undefined,
      ip: c.req.header('x-forwarded-for'),
    });
    return c.json({ ok: true });
  });

  return app;
}
```

- [ ] **Step 4: 组装到 admin.ts**

```ts
import { createAdminWaitlistRouter } from './admin-waitlist.js';
// createAdminRouter 内：
app.route(
  '/',
  createAdminWaitlistRouter({
    pool: deps.pool,
    jwt,
    waitlist: deps.waitlist,
    writeAudit: (entry) => writeAdminAudit(deps.pool, entry),
  }),
);
```

（deps.waitlist 的 `invite` 签名与 WaitlistService.invite 一致，index.ts 传入共享 waitlistService 实例。）

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run apps/server/src/routes/admin-waitlist.test.ts apps/server/src/routes/admin.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/admin-waitlist.ts apps/server/src/routes/admin.ts apps/server/src/routes/admin-waitlist.test.ts
git commit -m "feat(server): admin waitlist management APIs"
```

---

### Task 14: 前端主界面（布局 + 总览 + 用户列表/详情/操作）

**Files:**

- Modify: `apps/admin/src/app.tsx`（主界面接入）
- Create: `apps/admin/src/layout.tsx`
- Create: `apps/admin/src/pages/overview.tsx`
- Create: `apps/admin/src/pages/users.tsx`
- Modify: `apps/admin/src/api.ts`（users/overview/devices 客户端）
- Modify: `apps/admin/src/styles.css`
- Test: `apps/admin/src/pages/users.test.tsx`
- Test: `apps/admin/src/pages/overview.test.tsx`

- [ ] **Step 1: api.ts 追加客户端方法**

```ts
export interface AdminUserSummary {
  userId: string; email: string; nickname: string | null; accountStatus: string;
  createdAt: string; deviceCount: number; online: boolean; lastSeenAt: string | null;
}
export interface AdminUserDetail extends AdminUserSummary {
  suspendedAt: string | null; suspendedReason: string | null; chatRequests7d: number;
  petCount: number; friendCount: number; memoryCount: number;
}
export interface AdminDevice {
  deviceId: string; platform: string; appVersion: string | null;
  lastSeenAt: string; revokedAt: string | null;
}

// adminApi 内追加：
users(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return raw<{ total: number; page: number; pageSize: number; items: AdminUserSummary[] }>(`/users?${qs}`);
},
userDetail(userId: string) {
  return raw<AdminUserDetail>(`/users/${userId}`);
},
userDevices(userId: string) {
  return raw<{ items: AdminDevice[] }>(`/users/${userId}/devices`);
},
suspendUser(userId: string, reason: string) {
  return raw<{ ok: true }>(`/users/${userId}/suspend`, { method: 'POST', body: { reason } });
},
restoreUser(userId: string) {
  return raw<{ ok: true }>(`/users/${userId}/restore`, { method: 'POST', body: {} });
},
revokeDevice(deviceId: string) {
  return raw<{ ok: true }>(`/devices/${deviceId}/revoke`, { method: 'POST', body: {} });
},
```

- [ ] **Step 2: 写总览页 + 测试**

`apps/admin/src/pages/overview.tsx`：

```tsx
import { useEffect, useState } from 'react';

import { adminApi } from '../api.js';

interface Overview {
  totalUsers: number;
  onlineDevices: number;
  chatRequestsToday: number;
  pendingInvites: number;
}

export function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .overview()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error)
    return (
      <p className="page-error" role="alert">
        加载失败：{error}
      </p>
    );
  if (!data) return <p className="muted">加载中…</p>;

  const cards: Array<[string, number, string]> = [
    ['注册用户', data.totalUsers, 'users'],
    ['在线设备（5 分钟内）', data.onlineDevices, 'devices'],
    ['今日聊天请求', data.chatRequestsToday, 'usage'],
    ['待处理邀请', data.pendingInvites, 'waitlist'],
  ];
  return (
    <section className="overview">
      <h2>总览</h2>
      <div className="stat-grid">
        {cards.map(([label, value]) => (
          <div className="stat-card" key={label}>
            <div className="stat-value">{value}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

`apps/admin/src/pages/overview.test.tsx`：

```tsx
// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OverviewPage } from './overview.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OverviewPage', () => {
  it('renders four stat cards from the API', async () => {
    vi.spyOn(await import('../api.js').then((m) => m.adminApi), 'overview').mockResolvedValue({
      totalUsers: 3,
      onlineDevices: 1,
      chatRequestsToday: 10,
      pendingInvites: 2,
    });
    await act(async () => {
      render(<OverviewPage />);
    });
    expect(screen.getByText('注册用户')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('待处理邀请')).toBeTruthy();
  });
});
```

- [ ] **Step 3: 写用户页 + 测试**

`apps/admin/src/pages/users.tsx`：

```tsx
import { useCallback, useEffect, useState } from 'react';

import { adminApi, type AdminDevice, type AdminUserDetail, type AdminUserSummary } from '../api.js';

export function UsersPage() {
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState<{ items: AdminUserSummary[]; total: number } | null>(null);
  const [selected, setSelected] = useState<AdminUserDetail | null>(null);
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    const params: Record<string, string> = { page: '1', pageSize: '50' };
    if (keyword.trim()) params.q = keyword.trim();
    if (status) params.status = status;
    adminApi
      .users(params)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [keyword, status]);

  useEffect(load, [load]);

  const openDetail = async (userId: string) => {
    setError(null);
    const [detail, devs] = await Promise.all([
      adminApi.userDetail(userId),
      adminApi.userDevices(userId),
    ]);
    setSelected(detail);
    setDevices(devs.items);
  };

  const act = async (fn: () => Promise<unknown>, okMessage: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(okMessage);
      if (selected) await openDetail(selected.userId);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const suspend = () => {
    if (!selected) return;
    const reason = window.prompt('暂停原因（必填，将写入审计）：');
    if (reason === null) return;
    if (!reason.trim()) {
      setError('暂停必须填写原因');
      return;
    }
    void act(() => adminApi.suspendUser(selected.userId, reason.trim()), '账号已暂停');
  };

  const restore = () => {
    if (!selected) return;
    if (!window.confirm('确认恢复该账号登录能力？已撤销的设备不会被恢复。')) return;
    void act(() => adminApi.restoreUser(selected.userId), '账号已恢复');
  };

  return (
    <section className="page">
      <h2>用户管理</h2>
      <div className="toolbar">
        <input
          placeholder="搜索邮箱 / 昵称 / userId"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          <option value="active">正常</option>
          <option value="suspended">已暂停</option>
        </select>
      </div>
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="page-notice" role="status">
          {notice}
        </p>
      )}
      <table className="data-table">
        <thead>
          <tr>
            <th>邮箱</th>
            <th>昵称</th>
            <th>状态</th>
            <th>设备数</th>
            <th>在线</th>
            <th>注册时间</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.items.map((u) => (
            <tr key={u.userId}>
              <td>{u.email}</td>
              <td>{u.nickname ?? '—'}</td>
              <td>{u.accountStatus === 'active' ? '正常' : '已暂停'}</td>
              <td>{u.deviceCount}</td>
              <td>{u.online ? '在线' : '—'}</td>
              <td>{u.createdAt.slice(0, 10)}</td>
              <td>
                <button onClick={() => void openDetail(u.userId)}>详情</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">共 {data?.total ?? 0} 人（单页最多 50）</p>

      {selected && (
        <div className="drawer" role="dialog" aria-label="用户详情">
          <div className="drawer-head">
            <h3>{selected.email}</h3>
            <button onClick={() => setSelected(null)}>关闭</button>
          </div>
          <dl className="detail-list">
            <dt>userId</dt>
            <dd>{selected.userId}</dd>
            <dt>账号状态</dt>
            <dd>{selected.accountStatus === 'active' ? '正常' : '已暂停'}</dd>
            {selected.suspendedReason && (
              <>
                <dt>暂停原因</dt>
                <dd>{selected.suspendedReason}</dd>
              </>
            )}
            <dt>7 天聊天请求</dt>
            <dd>{selected.chatRequests7d}</dd>
            <dt>宠物 / 好友 / 记忆</dt>
            <dd>
              {selected.petCount} / {selected.friendCount} / {selected.memoryCount}
            </dd>
          </dl>
          <div className="drawer-actions">
            {selected.accountStatus === 'active' ? (
              <button className="danger" onClick={suspend}>
                暂停账号
              </button>
            ) : (
              <button onClick={restore}>恢复账号</button>
            )}
          </div>
          <h4>设备</h4>
          <table className="data-table">
            <thead>
              <tr>
                <th>平台</th>
                <th>版本</th>
                <th>最后在线</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.deviceId}>
                  <td>{d.platform}</td>
                  <td>{d.appVersion ?? '—'}</td>
                  <td>{d.lastSeenAt}</td>
                  <td>{d.revokedAt ? '已撤销' : '正常'}</td>
                  <td>
                    {!d.revokedAt && (
                      <button
                        className="danger"
                        onClick={() => {
                          if (window.confirm('确认撤销该设备？其会话将立即失效。')) {
                            void act(() => adminApi.revokeDevice(d.deviceId), '设备已撤销');
                          }
                        }}
                      >
                        撤销
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

`apps/admin/src/pages/users.test.tsx`：

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UsersPage } from './users.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const summary = {
  userId: 'u1',
  email: 'a@b.c',
  nickname: '测试',
  accountStatus: 'active',
  createdAt: '2026-08-01T00:00:00Z',
  deviceCount: 1,
  online: true,
  lastSeenAt: '2026-08-18T00:00:00Z',
};
const detail = {
  ...summary,
  suspendedAt: null,
  suspendedReason: null,
  chatRequests7d: 5,
  petCount: 1,
  friendCount: 0,
  memoryCount: 2,
};

describe('UsersPage', () => {
  it('lists users from the API', async () => {
    vi.spyOn(await import('../api.js').then((m) => m.adminApi), 'users').mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 50,
      items: [summary],
    });
    await act(async () => {
      render(<UsersPage />);
    });
    expect(screen.getByText('a@b.c')).toBeTruthy();
    expect(screen.getByText('共 1 人（单页最多 50）')).toBeTruthy();
  });

  it('suspend asks for a reason and calls the API', async () => {
    const api = await import('../api.js').then((m) => m.adminApi);
    vi.spyOn(api, 'users').mockResolvedValue({ total: 1, page: 1, pageSize: 50, items: [summary] });
    vi.spyOn(api, 'userDetail').mockResolvedValue(detail);
    vi.spyOn(api, 'userDevices').mockResolvedValue({ items: [] });
    const suspend = vi.spyOn(api, 'suspendUser').mockResolvedValue({ ok: true });
    vi.stubGlobal(
      'prompt',
      vi.fn(() => '测试暂停'),
    );

    await act(async () => {
      render(<UsersPage />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '详情' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '暂停账号' }));
    });

    expect(suspend).toHaveBeenCalledWith('u1', '测试暂停');
    expect(screen.getByRole('status').textContent).toContain('账号已暂停');
  });

  it('restore confirms before calling the API', async () => {
    const api = await import('../api.js').then((m) => m.adminApi);
    vi.spyOn(api, 'users').mockResolvedValue({ total: 1, page: 1, pageSize: 50, items: [summary] });
    vi.spyOn(api, 'userDetail').mockResolvedValue({ ...detail, accountStatus: 'suspended' });
    vi.spyOn(api, 'userDevices').mockResolvedValue({ items: [] });
    const restore = vi.spyOn(api, 'restoreUser').mockResolvedValue({ ok: true });
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );

    await act(async () => {
      render(<UsersPage />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '详情' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '恢复账号' }));
    });

    expect(restore).toHaveBeenCalledWith('u1');
  });
});
```

- [ ] **Step 4: 主界面接入（app.tsx 替换占位）+ layout.tsx**

`apps/admin/src/layout.tsx`：

```tsx
import { useState } from 'react';

import { adminApi, setAccessToken } from './api.js';
import { AuditPage } from './pages/audit.js';
import { OverviewPage } from './pages/overview.js';
import { SensitivePage } from './pages/sensitive.js';
import { UsagePage } from './pages/usage.js';
import { UsersPage } from './pages/users.js';
import { WaitlistPage } from './pages/waitlist.js';

export type AdminView = 'overview' | 'users' | 'usage' | 'waitlist' | 'sensitive' | 'audit';

const NAV: Array<[AdminView, string]> = [
  ['overview', '总览'],
  ['users', '用户管理'],
  ['usage', '运行与用量'],
  ['waitlist', '运营邀请'],
  ['sensitive', '聊天与记忆'],
  ['audit', '审计日志'],
];

export function Layout({ onLogout }: { onLogout(): void }) {
  const [view, setView] = useState<AdminView>('overview');

  const logout = async () => {
    await adminApi.logout().catch(() => undefined);
    setAccessToken(null);
    onLogout();
  };

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <h1>星屿运营后台</h1>
        <nav>
          {NAV.map(([key, label]) => (
            <button
              key={key}
              className={view === key ? 'nav-item active' : 'nav-item'}
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button className="nav-item logout" onClick={() => void logout()}>
          退出登录
        </button>
      </aside>
      <main className="content">
        {view === 'overview' && <OverviewPage />}
        {view === 'users' && <UsersPage />}
        {view === 'usage' && <UsagePage />}
        {view === 'waitlist' && <WaitlistPage />}
        {view === 'sensitive' && <SensitivePage />}
        {view === 'audit' && <AuditPage />}
      </main>
    </div>
  );
}
```

`apps/admin/src/app.tsx` 替换占位返回：

```tsx
import { Layout } from './layout.js';
// ...
if (session === 'anonymous') return <LoginPage onAuthed={() => setSession('authed')} />;
return <Layout onLogout={() => setSession('anonymous')} />;
```

**注意：** layout.tsx 引用了 usage/waitlist/sensitive/audit 四个页面，本任务未实现——先在 `apps/admin/src/pages/` 建四个最小占位文件（每个导出同名组件返回 `<p className="muted">即将上线</p>`），Task 15-17 逐个替换为真实页面。占位文件不属于"计划占位符"——它们是可运行的最小实现，后续任务替换。

- [ ] **Step 5: styles.css 追加（表格/抽屉/侧栏/统计卡）**

```css
.admin-shell {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  width: 200px;
  flex-shrink: 0;
  background: #111827;
  color: #e5e7eb;
  padding: 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sidebar h1 {
  font-size: 16px;
  margin: 0 8px 16px;
}

.nav-item {
  text-align: left;
  background: none;
  border: 0;
  color: #d1d5db;
  padding: 9px 12px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
}

.nav-item.active {
  background: #374151;
  color: #fff;
}

.nav-item.logout {
  margin-top: auto;
  color: #f87171;
}

.content {
  flex: 1;
  padding: 24px 28px;
  min-width: 0;
}

.page h2 {
  margin: 0 0 16px;
  font-size: 20px;
}

.toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}

.toolbar input,
.toolbar select {
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  border-radius: 10px;
  overflow: hidden;
}

.data-table th,
.data-table td {
  padding: 9px 12px;
  border-bottom: 1px solid #eef0f4;
  font-size: 13px;
  text-align: left;
}

.data-table th {
  background: #f8fafc;
  color: #6b7280;
  font-weight: 600;
}

.data-table button {
  padding: 5px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  font-size: 12px;
}

.data-table button.danger {
  color: #dc2626;
  border-color: #fca5a5;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
}

.stat-card {
  background: #fff;
  border-radius: 12px;
  padding: 18px;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.06);
}

.stat-value {
  font-size: 28px;
  font-weight: 700;
}

.stat-label {
  color: #6b7280;
  font-size: 13px;
  margin-top: 4px;
}

.drawer {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 460px;
  max-width: 92vw;
  background: #fff;
  box-shadow: -8px 0 32px rgb(0 0 0 / 0.14);
  padding: 20px;
  overflow-y: auto;
  z-index: 10;
}

.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.drawer-head h3 {
  margin: 0;
}

.drawer-actions {
  margin: 14px 0;
  display: flex;
  gap: 10px;
}

.drawer-actions button {
  padding: 8px 14px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
}

.drawer-actions button.danger {
  color: #dc2626;
  border-color: #fca5a5;
}

.detail-list {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 8px 12px;
  font-size: 13px;
}

.detail-list dt {
  color: #6b7280;
}

.detail-list dd {
  margin: 0;
  word-break: break-all;
}

.page-error {
  color: #dc2626;
  font-size: 13px;
}

.page-notice {
  color: #15803d;
  font-size: 13px;
}

.muted {
  color: #6b7280;
  font-size: 13px;
}
```

- [ ] **Step 6: 运行测试 + 类型检查 + 浏览器手测**

Run:

```bash
npx vitest run apps/admin/src/pages/users.test.tsx apps/admin/src/pages/overview.test.tsx
pnpm --filter @pet/admin typecheck
```

Expected: PASS；typecheck 无错误。浏览器 http://localhost:5175 用 `admin@pet.dev` / `Admin@123456` 登录，能看到总览与用户列表。

- [ ] **Step 7: Commit**

```bash
git add apps/admin
git commit -m "feat(admin): shell layout, overview and users pages"
```

---

### Task 15: 用量页 + waitlist 页

**Files:**

- Create: `apps/admin/src/pages/usage.tsx`（替换占位）
- Create: `apps/admin/src/pages/waitlist.tsx`（替换占位）
- Modify: `apps/admin/src/api.ts`
- Test: `apps/admin/src/pages/usage.test.tsx`
- Test: `apps/admin/src/pages/waitlist.test.tsx`

- [ ] **Step 1: api.ts 追加**

```ts
export interface UsageRow { usageDate: string; requests: number; tokens: number; }
export interface WaitlistRow {
  id: string; email: string; status: string; createdAt: string;
  invitedAt: string | null; inviteExpiresAt: string | null; claimedAt: string | null;
}

// adminApi 内追加：
usage(from: string, to: string) {
  return raw<{ summary: { requests: number; tokens: number }; items: UsageRow[] }>(
    `/usage?from=${from}&to=${to}`,
  );
},
usageForUser(userId: string, from: string, to: string) {
  return raw<{ items: UsageRow[] }>(`/usage/users/${userId}?from=${from}&to=${to}`);
},
waitlist(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return raw<{ total: number; page: number; pageSize: number; items: WaitlistRow[] }>(`/waitlist?${qs}`);
},
inviteWaitlist(id: string) {
  return raw<{ ok: true; code?: string }>(`/waitlist/${id}/invite`, { method: 'POST', body: {} });
},
expireWaitlist(id: string) {
  return raw<{ ok: true }>(`/waitlist/${id}/expire`, { method: 'POST', body: {} });
},
```

- [ ] **Step 2: 用量页 + 测试**

`apps/admin/src/pages/usage.tsx`：

```tsx
import { useEffect, useState } from 'react';

import { adminApi, type UsageRow } from '../api.js';

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

export function UsagePage() {
  const [from, setFrom] = useState(daysAgo(7));
  const [to, setTo] = useState(today());
  const [data, setData] = useState<{
    summary: { requests: number; tokens: number };
    items: UsageRow[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .usage(from, to)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [from, to]);

  return (
    <section className="page">
      <h2>运行与用量</h2>
      <div className="toolbar">
        <label>
          从 <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          到 <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <p className="muted">
            区间合计：{data.summary.requests} 次请求 / {data.summary.tokens} token 估算
          </p>
          <table className="data-table">
            <thead>
              <tr>
                <th>日期</th>
                <th>请求数</th>
                <th>token 估算</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.usageDate}>
                  <td>{r.usageDate}</td>
                  <td>{r.requests}</td>
                  <td>{r.tokens}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
```

`apps/admin/src/pages/usage.test.tsx`：

```tsx
// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UsagePage } from './usage.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('UsagePage', () => {
  it('renders summary and rows from the API', async () => {
    vi.spyOn(await import('../api.js').then((m) => m.adminApi), 'usage').mockResolvedValue({
      summary: { requests: 30, tokens: 4000 },
      items: [{ usageDate: '2026-08-18', requests: 20, tokens: 2500 }],
    });
    await act(async () => {
      render(<UsagePage />);
    });
    expect(screen.getByText(/30 次请求/)).toBeTruthy();
    expect(screen.getByText('2026-08-18')).toBeTruthy();
  });
});
```

- [ ] **Step 3: waitlist 页 + 测试**

`apps/admin/src/pages/waitlist.tsx`：

```tsx
import { useCallback, useEffect, useState } from 'react';

import { adminApi, type WaitlistRow } from '../api.js';

export function WaitlistPage() {
  const [status, setStatus] = useState('');
  const [data, setData] = useState<{ items: WaitlistRow[]; total: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const params: Record<string, string> = { page: '1', pageSize: '50' };
    if (status) params.status = status;
    adminApi
      .waitlist(params)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [status]);

  useEffect(load, [load]);

  const invite = async (row: WaitlistRow) => {
    setError(null);
    setNotice(null);
    try {
      const result = await adminApi.inviteWaitlist(row.id);
      setNotice(result.code ? `已邀请 ${row.email}，兑换码 ${result.code}` : `已邀请 ${row.email}`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const expire = async (row: WaitlistRow) => {
    if (!window.confirm(`确认将 ${row.email} 的邀请标记为过期？`)) return;
    setError(null);
    setNotice(null);
    try {
      await adminApi.expireWaitlist(row.id);
      setNotice(`已过期：${row.email}`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="page">
      <h2>运营邀请</h2>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          <option value="pending">待邀请</option>
          <option value="invited">已邀请</option>
          <option value="joined">已加入</option>
          <option value="expired">已过期</option>
        </select>
      </div>
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="page-notice" role="status">
          {notice}
        </p>
      )}
      <table className="data-table">
        <thead>
          <tr>
            <th>邮箱</th>
            <th>状态</th>
            <th>报名时间</th>
            <th>邀请时间</th>
            <th>兑换时间</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.items.map((row) => (
            <tr key={row.id}>
              <td>{row.email}</td>
              <td>{row.status}</td>
              <td>{row.createdAt.slice(0, 10)}</td>
              <td>{row.invitedAt ? row.invitedAt.slice(0, 10) : '—'}</td>
              <td>{row.claimedAt ? row.claimedAt.slice(0, 10) : '—'}</td>
              <td>
                {row.status === 'pending' && (
                  <button onClick={() => void invite(row)}>发放邀请</button>
                )}
                {row.status === 'invited' && (
                  <button onClick={() => void expire(row)}>标记过期</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">共 {data?.total ?? 0} 条（单页最多 50）</p>
    </section>
  );
}
```

`apps/admin/src/pages/waitlist.test.tsx`：

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WaitlistPage } from './waitlist.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const row = {
  id: 'w1',
  email: 'a@b.c',
  status: 'pending',
  createdAt: '2026-08-01T00:00:00Z',
  invitedAt: null,
  inviteExpiresAt: null,
  claimedAt: null,
};

describe('WaitlistPage', () => {
  it('renders waitlist rows and invites with the returned code', async () => {
    const api = await import('../api.js').then((m) => m.adminApi);
    vi.spyOn(api, 'waitlist').mockResolvedValue({ total: 1, page: 1, pageSize: 50, items: [row] });
    vi.spyOn(api, 'inviteWaitlist').mockResolvedValue({ ok: true, code: 'ABCD1234' });

    await act(async () => {
      render(<WaitlistPage />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发放邀请' }));
    });

    expect(screen.getByRole('status').textContent).toContain('ABCD1234');
  });
});
```

- [ ] **Step 4: 运行测试 + 类型检查**

Run: `npx vitest run apps/admin/src/pages/usage.test.tsx apps/admin/src/pages/waitlist.test.tsx && pnpm --filter @pet/admin typecheck`
Expected: PASS；typecheck 无错误

- [ ] **Step 5: Commit**

```bash
git add apps/admin
git commit -m "feat(admin): usage and waitlist pages"
```

---

### Task 16: 审计日志页

**Files:**

- Create: `apps/admin/src/pages/audit.tsx`（替换占位）
- Modify: `apps/admin/src/api.ts`
- Test: `apps/admin/src/pages/audit.test.tsx`

- [ ] **Step 1: api.ts 追加**

```ts
export interface AuditRow {
  id: string; adminId: string | null; action: string; resourceType: string;
  resourceId: string | null; reason: string | null; ip: string | null; createdAt: string;
}

// adminApi 内追加：
auditLog(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return raw<{ total: number; page: number; pageSize: number; items: AuditRow[] }>(`/audit-log?${qs}`);
},
```

- [ ] **Step 2: 页面 + 测试**

`apps/admin/src/pages/audit.tsx`：

```tsx
import { useEffect, useState } from 'react';

import { adminApi, type AuditRow } from '../api.js';

const ACTION_LABELS: Record<string, string> = {
  'admin.login': '管理员登录',
  'admin.login_failed': '登录失败',
  'admin.refresh': '刷新会话',
  'admin.revoke': '退出登录',
  'user.suspend': '暂停账号',
  'user.restore': '恢复账号',
  'device.revoke': '撤销设备',
  'waitlist.invite': '发放邀请',
  'waitlist.expire': '邀请过期',
  'sensitive.grant': '敏感授权',
  'sensitive.read': '敏感读取',
};

export function AuditPage() {
  const [rows, setRows] = useState<{ items: AuditRow[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .auditLog({ page: '1', pageSize: '100' })
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <section className="page">
      <h2>审计日志</h2>
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      <table className="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>操作</th>
            <th>资源</th>
            <th>原因</th>
            <th>IP</th>
          </tr>
        </thead>
        <tbody>
          {rows?.items.map((r) => (
            <tr key={r.id}>
              <td>{r.createdAt}</td>
              <td>{ACTION_LABELS[r.action] ?? r.action}</td>
              <td>
                {r.resourceType}
                {r.resourceId ? ` / ${r.resourceId.slice(0, 8)}…` : ''}
              </td>
              <td>{r.reason ?? '—'}</td>
              <td>{r.ip ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">共 {rows?.total ?? 0} 条（单页最多 100）</p>
    </section>
  );
}
```

`apps/admin/src/pages/audit.test.tsx`：

```tsx
// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuditPage } from './audit.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AuditPage', () => {
  it('renders audit rows with action labels', async () => {
    vi.spyOn(await import('../api.js').then((m) => m.adminApi), 'auditLog').mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 100,
      items: [
        {
          id: 'e1',
          adminId: 'a1',
          action: 'user.suspend',
          resourceType: 'user',
          resourceId: 'u1',
          reason: '测试',
          ip: '127.0.0.1',
          createdAt: '2026-08-18T00:00:00Z',
        },
      ],
    });
    await act(async () => {
      render(<AuditPage />);
    });
    expect(screen.getByText('暂停账号')).toBeTruthy();
    expect(screen.getByText('测试')).toBeTruthy();
  });
});
```

- [ ] **Step 3: 运行测试 + 类型检查 + Commit**

Run: `npx vitest run apps/admin/src/pages/audit.test.tsx && pnpm --filter @pet/admin typecheck`
Expected: PASS；typecheck 无错误

```bash
git add apps/admin
git commit -m "feat(admin): audit log page"
```

---

## Phase 2：敏感数据

### Task 17: 聊天/记忆脱敏摘要 API

**Files:**

- Create: `apps/server/src/routes/admin-sensitive.ts`
- Modify: `apps/server/src/routes/admin.ts`（组装）
- Test: `apps/server/src/routes/admin-sensitive.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';
import { createAdminSensitiveRouter } from './admin-sensitive.js';

const JWT = new JwtService({ secret: 'admin-test-secret-admin-test-secret' });

function buildRouter(
  rowsByFragment: Array<{ fragment: string; rows: unknown[]; rowCount?: number }>,
) {
  const pool = {
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        const hit = rowsByFragment.find((r) => sql.includes(r.fragment));
        return { rows: hit?.rows ?? [], rowCount: hit?.rowCount ?? hit?.rows.length ?? 0 };
      }),
      release: vi.fn(),
    })),
    query: vi.fn(async (sql: string) => {
      const hit = rowsByFragment.find((r) => sql.includes(r.fragment));
      return { rows: hit?.rows ?? [], rowCount: hit?.rowCount ?? hit?.rows.length ?? 0 };
    }),
  };
  const app = createAdminSensitiveRouter({
    pool: pool as never,
    jwt: JWT,
    writeAudit: vi.fn(async () => undefined) as never,
  });
  return { app, pool };
}

describe('admin sensitive routes', () => {
  it('chat summary returns truncated content (脱敏摘要)', async () => {
    const { app } = buildRouter([
      {
        fragment: 'from chat_messages',
        rows: [
          {
            message_id: 'm1',
            role: 'user',
            content: '今天心情不太好，想找人聊聊。',
            created_at: '2026-08-18T00:00:00Z',
          },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/admin/users/u1/chat-summary?page=1&pageSize=20', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ summary: string }> };
    expect(body.items[0]!.summary.length).toBeLessThanOrEqual(43); // 40 + 省略号
  });

  it('memories summary returns truncated value', async () => {
    const { app } = buildRouter([
      {
        fragment: 'from private_memories',
        rows: [
          {
            memory_id: 'mem1',
            category: 'preference',
            sensitivity: 'low',
            value: '喜欢抹茶拿铁，加双份浓缩。',
            created_at: '2026-08-18T00:00:00Z',
          },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/admin/users/u1/memories-summary?page=1', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ category: string }> };
    expect(body.items[0]!.category).toBe('preference');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /e/A_Project/ai-social-desktop-pet && npx vitest run apps/server/src/routes/admin-sensitive.test.ts`
Expected: FAIL —— 找不到模块

- [ ] **Step 3: 实现 routes/admin-sensitive.ts**

```ts
/**
 * 管理 API —— 敏感数据（聊天/记忆）。
 * 默认只返回脱敏摘要（内容截断 40 字符）；原文经一次性短时授权获取（Task 18）。
 * 用户维度读取沿用 withUserClaims（RLS 兼容）。
 */
import { Hono } from 'hono';
import type pg from 'pg';

import type { JwtService } from '../auth/jwt.js';
import type { AdminVariables } from './admin.js';
import { requireAdminAuth } from './admin.js';
import { withUserClaims } from './admin-users.js';

const SUMMARY_LIMIT = 40;

function summarize(content: string): string {
  return content.length > SUMMARY_LIMIT ? `${content.slice(0, SUMMARY_LIMIT)}…` : content;
}

export interface AdminSensitiveDeps {
  pool: pg.Pool;
  jwt: JwtService;
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
  const auth = requireAdminAuth(deps.jwt);

  app.get('/users/:userId/chat-summary', auth, async (c) => {
    const userId = c.req.param('userId');
    const q = c.req.query();
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20)));
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
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20)));
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
```

- [ ] **Step 4: 组装到 admin.ts**

```ts
import { createAdminSensitiveRouter } from './admin-sensitive.js';
// createAdminRouter 内：
app.route(
  '/',
  createAdminSensitiveRouter({
    pool: deps.pool,
    jwt,
    writeAudit: (entry) => writeAdminAudit(deps.pool, entry),
  }),
);
```

- [ ] **Step 5: 运行确认通过**

Run: `npx vitest run apps/server/src/routes/admin-sensitive.test.ts apps/server/src/routes/admin.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/routes/admin-sensitive.ts apps/server/src/routes/admin.ts apps/server/src/routes/admin-sensitive.test.ts
git commit -m "feat(server): admin chat/memory sanitized summaries"
```

---

### Task 18: 一次性敏感访问授权（grant 创建 + 内容消费）

**Files:**

- Modify: `apps/server/src/routes/admin-sensitive.ts`（追加两个端点）
- Modify: `apps/server/src/routes/admin.ts`（AdminRouterDeps 补充 grant 常量传递）
- Test: `apps/server/src/routes/admin-sensitive.test.ts`（追加用例）

- [ ] **Step 1: 追加失败测试**

```ts
it('creates a single-use grant bound to admin/user/type', async () => {
  const { app, pool } = buildRouter([
    { fragment: 'select 1 from auth.users', rows: [{ exists: 1 }], rowCount: 1 },
    { fragment: 'insert into admin_sensitive_grants', rows: [], rowCount: 1 },
  ]);
  const token = await JWT.signAdmin('a1');
  const res = await app.request('/admin/sensitive-access', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      targetUserId: 'u1',
      resourceType: 'chat',
      reason: '用户投诉需要核查对话',
      scope: {},
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { grantId: string; token: string; expiresAt: string };
  expect(body.grantId).toBeTruthy();
  expect(body.token.length).toBeGreaterThan(20);
  expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  // insert SQL 参数里只存哈希，不存明文
  const insertCall = pool.query.mock.calls.find(([sql]) =>
    String(sql).includes('insert into admin_sensitive_grants'),
  ) as [string, unknown[]];
  expect(insertCall[1]!.includes(body.token)).toBe(false);
});

it('rejects grant with too-short reason', async () => {
  const { app } = buildRouter([]);
  const token = await JWT.signAdmin('a1');
  const res = await app.request('/admin/sensitive-access', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ targetUserId: 'u1', resourceType: 'chat', reason: '短', scope: {} }),
  });
  expect(res.status).toBe(422);
});

it('consumes the grant once and returns raw chat content', async () => {
  const { app } = buildRouter([
    {
      fragment: 'select g.grant_id',
      rows: [
        {
          grant_id: 'g1',
          target_user_id: 'u1',
          resource_type: 'chat',
          resource_scope: '{}',
          expires_at: 9999999999999,
          used_at: null,
        },
      ],
    },
    { fragment: 'update admin_sensitive_grants set used_at', rows: [], rowCount: 1 },
    {
      fragment: 'from chat_messages',
      rows: [
        { message_id: 'm1', role: 'user', content: '完整原文', created_at: '2026-08-18T00:00:00Z' },
      ],
    },
  ]);
  const token = await JWT.signAdmin('a1');
  const res = await app.request('/admin/sensitive-access/g1/content', {
    headers: { authorization: `Bearer ${token}`, 'x-grant-token': 'raw-token' },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: Array<{ content: string }> };
  expect(body.items[0]!.content).toBe('完整原文');
});

it('rejects a used grant with 410', async () => {
  const { app } = buildRouter([
    {
      fragment: 'select g.grant_id',
      rows: [
        {
          grant_id: 'g1',
          target_user_id: 'u1',
          resource_type: 'chat',
          resource_scope: '{}',
          expires_at: 9999999999999,
          used_at: '2026-08-18T00:00:00Z',
        },
      ],
    },
  ]);
  const token = await JWT.signAdmin('a1');
  const res = await app.request('/admin/sensitive-access/g1/content', {
    headers: { authorization: `Bearer ${token}`, 'x-grant-token': 'raw-token' },
  });
  expect(res.status).toBe(410);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd /e/A_Project/ai-social-desktop-pet && npx vitest run apps/server/src/routes/admin-sensitive.test.ts`
Expected: FAIL（新增用例 404/405）

- [ ] **Step 3: 实现（admin-sensitive.ts 追加）**

```ts
// 顶部 import 补充：
import { randomBytes, randomUUID } from 'node:crypto';
import { hashRefreshToken } from '../auth/session.js';

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
    `select g.grant_id, g.target_user_id, g.resource_type, g.resource_scope,
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
  // 令牌校验（哈希比对；不匹配视为无效授权）
  const { rows: tokenRows } = await deps.pool.query(
    `select 1 from admin_sensitive_grants
     where grant_id = $1 and grant_token_hash = $2 and used_at is null
       and expires_at > now()`,
    [grantId, hashRefreshToken(grantToken)],
  );
  if ((tokenRows.length ?? 0) === 0) return c.json({ error: 'grant_used_or_expired' }, 410);

  // 单次消费（乐观锁：used_at 为空才置位；并发重复读取只有一方成功）
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
```

注意：`grant.reason` 在 select 里没取——补进 SELECT 列（`g.reason`）再用于审计 reason。实现时同步修正上面的 select。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run apps/server/src/routes/admin-sensitive.test.ts`
Expected: PASS（新增 4 个用例）

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/admin-sensitive.ts apps/server/src/routes/admin-sensitive.test.ts
git commit -m "feat(server): single-use sensitive access grants"
```

---

### Task 19: 敏感数据页（前端）

**Files:**

- Create: `apps/admin/src/pages/sensitive.tsx`（替换占位）
- Modify: `apps/admin/src/api.ts`
- Test: `apps/admin/src/pages/sensitive.test.tsx`

- [ ] **Step 1: api.ts 追加**

```ts
export interface ChatSummaryRow { messageId: string; role: string; createdAt: string; summary: string; }
export interface MemorySummaryRow { memoryId: string; category: string; sensitivity: string; createdAt: string; summary: string; }

// adminApi 内追加：
chatSummary(userId: string) {
  return raw<{ items: ChatSummaryRow[] }>(`/users/${userId}/chat-summary?page=1&pageSize=50`);
},
memoriesSummary(userId: string) {
  return raw<{ items: MemorySummaryRow[] }>(`/users/${userId}/memories-summary?page=1&pageSize=50`);
},
createSensitiveAccess(body: {
  targetUserId: string; resourceType: 'chat' | 'private_memory' | 'bond_memory'; reason: string; scope: Record<string, unknown>;
}) {
  return raw<{ grantId: string; token: string; expiresAt: string }>('/sensitive-access', {
    method: 'POST',
    body,
  });
},
sensitiveContent(grantId: string, token: string) {
  return raw<{ resourceType: string; items: Array<Record<string, unknown>> }>(
    `/sensitive-access/${grantId}/content`,
    { headers: { 'x-grant-token': token } },
  );
},
```

`api.ts` 的 `raw` 需要支持自定义 headers——把 `RequestOptions` 加 `headers?: Record<string, string>`，并在 fetch 时合并。

- [ ] **Step 2: 页面 + 测试**

`apps/admin/src/pages/sensitive.tsx`：

```tsx
import { useState } from 'react';

import { adminApi } from '../api.js';

export function SensitivePage() {
  const [userId, setUserId] = useState('');
  const [resourceType, setResourceType] = useState<'chat' | 'private_memory' | 'bond_memory'>(
    'chat',
  );
  const [reason, setReason] = useState('');
  const [grant, setGrant] = useState<{ grantId: string; token: string; expiresAt: string } | null>(
    null,
  );
  const [content, setContent] = useState<Array<Record<string, unknown>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const requestGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setContent(null);
    try {
      const g = await adminApi.createSensitiveAccess({
        targetUserId: userId,
        resourceType,
        reason,
        scope: {},
      });
      setGrant(g);
      const result = await adminApi.sensitiveContent(g.grantId, g.token);
      setContent(result.items);
      setGrant(null); // 读取后立即丢弃（授权已单次消费）
      setNotice('已按授权读取一次；本次授权已失效。');
    } catch (err) {
      setError((err as Error).message);
      setGrant(null);
      setContent(null);
    }
  };

  return (
    <section className="page">
      <h2>聊天与记忆（敏感数据）</h2>
      <p className="muted">
        默认只显示脱敏摘要。查看原文必须填写理由，系统签发 5
        分钟一次性授权，读取后立即失效并记入审计。
      </p>
      <form className="grant-form" onSubmit={(e) => void requestGrant(e)}>
        <label>
          用户 userId
          <input value={userId} onChange={(e) => setUserId(e.target.value)} required />
        </label>
        <label>
          资源类型
          <select
            value={resourceType}
            onChange={(e) =>
              setResourceType(e.target.value as 'chat' | 'private_memory' | 'bond_memory')
            }
          >
            <option value="chat">聊天记录</option>
            <option value="private_memory">私人记忆</option>
            <option value="bond_memory">羁绊记忆</option>
          </select>
        </label>
        <label>
          查看理由（≥5 字，写入审计）
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
        </label>
        <button type="submit">申请授权并查看</button>
      </form>
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="page-notice" role="status">
          {notice}
        </p>
      )}
      {grant && <p className="muted">授权有效至 {grant.expiresAt}，正在读取…</p>}
      {content && (
        <table className="data-table">
          <thead>
            <tr>
              {Object.keys(content[0] ?? {}).map((k) => (
                <th key={k}>{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {content.map((row, i) => (
              <tr key={i}>
                {Object.values(row).map((v, j) => (
                  <td key={j}>{String(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
```

`apps/admin/src/pages/sensitive.test.tsx`：

```tsx
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SensitivePage } from './sensitive.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SensitivePage', () => {
  it('requests a grant, reads content once and shows the notice', async () => {
    const api = await import('../api.js').then((m) => m.adminApi);
    const create = vi.spyOn(api, 'createSensitiveAccess').mockResolvedValue({
      grantId: 'g1',
      token: 't1',
      expiresAt: '2026-08-18T00:05:00Z',
    });
    const content = vi.spyOn(api, 'sensitiveContent').mockResolvedValue({
      resourceType: 'chat',
      items: [
        { messageId: 'm1', role: 'user', content: '完整原文', createdAt: '2026-08-18T00:00:00Z' },
      ],
    });

    await act(async () => {
      render(<SensitivePage />);
    });
    fireEvent.change(screen.getByLabelText('用户 userId'), { target: { value: 'u1' } });
    fireEvent.change(screen.getByLabelText('查看理由（≥5 字，写入审计）'), {
      target: { value: '用户投诉核查' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '申请授权并查看' }));
    });

    expect(create).toHaveBeenCalledWith({
      targetUserId: 'u1',
      resourceType: 'chat',
      reason: '用户投诉核查',
      scope: {},
    });
    expect(content).toHaveBeenCalledWith('g1', 't1');
    expect(screen.getByText('完整原文')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('本次授权已失效');
  });

  it('shows errors when the grant fails', async () => {
    vi.spyOn(
      await import('../api.js').then((m) => m.adminApi),
      'createSensitiveAccess',
    ).mockRejectedValue(new Error('grant_used_or_expired'));
    await act(async () => {
      render(<SensitivePage />);
    });
    fireEvent.change(screen.getByLabelText('用户 userId'), { target: { value: 'u1' } });
    fireEvent.change(screen.getByLabelText('查看理由（≥5 字，写入审计）'), {
      target: { value: '用户投诉核查' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '申请授权并查看' }));
    });
    expect(screen.getByRole('alert').textContent).toContain('grant_used_or_expired');
  });
});
```

styles.css 追加：

```css
.grant-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 420px;
  margin-bottom: 18px;
}

.grant-form label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 13px;
  color: #4b5563;
}

.grant-form input,
.grant-form select,
.grant-form textarea {
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
}

.grant-form button {
  align-self: flex-start;
  padding: 9px 16px;
  border: 0;
  border-radius: 8px;
  background: #4f46e5;
  color: #fff;
  cursor: pointer;
}
```

- [ ] **Step 3: 运行测试 + 类型检查 + Commit**

Run: `npx vitest run apps/admin/src/pages/sensitive.test.tsx && pnpm --filter @pet/admin typecheck`
Expected: PASS；typecheck 无错误

```bash
git add apps/admin
git commit -m "feat(admin): sensitive data page with one-time grant flow"
```

---

### Task 20: e2e 管理后台流程

**Files:**

- Create: `e2e/admin.spec.ts`
- Modify: `e2e/playwright.config.ts`

- [ ] **Step 1: 写 e2e spec**

```ts
/**
 * 管理后台 e2e —— 需要本地后端（127.0.0.1:8787）+ 已建管理员。
 * 管理员凭据：ADMIN_E2E_EMAIL / ADMIN_E2E_PASSWORD（缺省 admin@pet.dev / Admin@123456）。
 * 未设置 ADMIN_E2E_EMAIL 时跳过（CI 默认不跑管理后台）。
 */
import { expect, test } from '@playwright/test';

const adminEmail = process.env['ADMIN_E2E_EMAIL'] ?? 'admin@pet.dev';
const adminPassword = process.env['ADMIN_E2E_PASSWORD'] ?? 'Admin@123456';
const apiBase = process.env['ADMIN_E2E_API'] ?? 'http://127.0.0.1:8787';

test.describe('admin console', () => {
  test.skip(!process.env['ADMIN_E2E_EMAIL'], '未配置 ADMIN_E2E_EMAIL');

  let testEmail: string;

  test.beforeAll(async () => {
    // 注册一个测试用户（幂等：已存在则跳过）
    testEmail = `admin-e2e-${Date.now()}@pet.dev`;
    const deviceId = crypto.randomUUID();
    const res = await fetch(`${apiBase}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'E2e@123456',
        deviceId,
        nickname: 'e2e 用户',
      }),
    });
    if (res.status !== 201) {
      // 允许 409（历史残留邮箱）——测试用户每次用时间戳，正常不会发生
      throw new Error(`注册 e2e 用户失败：${res.status}`);
    }
  });

  test('登录 → 搜索用户 → 暂停账号 → 审计出现', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('邮箱').fill(adminEmail);
    await page.getByLabel('密码').fill(adminPassword);
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page.getByText('星屿运营后台')).toBeVisible();

    await page.getByRole('button', { name: '用户管理' }).click();
    await page.getByPlaceholder('搜索邮箱 / 昵称 / userId').fill(testEmail);
    await expect(page.getByText(testEmail)).toBeVisible();

    await page.getByRole('button', { name: '详情' }).click();
    page.on('dialog', (dialog) => dialog.accept('e2e 自动暂停'));
    await page.getByRole('button', { name: '暂停账号' }).click();
    await expect(page.getByRole('status')).toContainText('账号已暂停');

    await page.getByRole('button', { name: '审计日志' }).click();
    await expect(page.getByText('暂停账号')).toBeVisible();
  });
});
```

- [ ] **Step 2: playwright.config.ts 追加 project**

读现有 `e2e/playwright.config.ts`，在 projects 数组追加：

```ts
{
  name: 'admin',
  testMatch: 'admin.spec.ts',
  use: { baseURL: 'http://127.0.0.1:5175' },
  webServer: {
    command: 'pnpm --filter @pet/admin dev --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: true,
    timeout: 60_000,
  },
},
```

（若现有配置没有 projects 数组而是单配置，按同样语义加 webServer + testMatch 过滤。）

- [ ] **Step 3: 本地运行验证（需后端运行 + 管理员已建）**

Run:

```bash
cd /e/A_Project/ai-social-desktop-pet && ADMIN_E2E_EMAIL=admin@pet.dev ADMIN_E2E_PASSWORD='Admin@123456' npx playwright test --config e2e/playwright.config.ts --project=admin
```

Expected: 2 个用例 PASS（1 个 skip 条件 + 1 个流程）。若后端未运行先 `pnpm dev:server`。

- [ ] **Step 4: Commit**

```bash
git add e2e/admin.spec.ts e2e/playwright.config.ts
git commit -m "test(e2e): admin console login/suspend/audit flow"
```

---

### Task 21: 部署说明 + 全量验证

**Files:**

- Create: `docs/admin-deploy.md`

- [ ] **Step 1: 写部署说明**

`docs/admin-deploy.md` 内容要点：

- 依赖：Postgres 已迁移（0015+）、后端启动、管理员已建（`pnpm --filter @pet/server admin:create <email>`）；
- 开发：`pnpm dev:admin`（5175，vite proxy /admin → 8787）；
- 内网部署：`pnpm --filter @pet/admin build`，静态目录 `apps/admin/dist` 由 Nginx 托管，`location /admin/ { proxy_pass http://127.0.0.1:8787; }`（同源，cookie Path=/admin 生效）；
- 安全基线：
  - 后端只监听内网/回环，或反向代理层限制来源网段（`allow` 指令）；
  - `ADMIN_COOKIE_SECURE=true` 在 HTTPS 下开启 cookie Secure；
  - 管理员密码 ≥12 位，密钥只存环境变量；
  - 公网部署前需 HTTPS + 来源限制 + 二次验证（后续迭代）；
- 审计：所有写操作与敏感读取在 `admin_audit_log`，查询入口为后台"审计日志"页；
- 敏感数据：原文只经一次性授权读取，后台不提供批量导出。

- [ ] **Step 2: 全量验证**

Run（按顺序）：

```bash
cd /e/A_Project/ai-social-desktop-pet
pnpm migrate
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
```

Expected: migrate 无新增（或正常）；typecheck 无错误；763+ 单测全绿；lint 无错误；format:check 无差异（新增文件已由 lint-staged 格式化，若有差异跑 `pnpm format` 后重查）。

- [ ] **Step 3: 浏览器手测清单（本机）**

- [ ] 后台登录成功/密码错误提示/连续失败限流提示
- [ ] 总览四个指标与数据库一致
- [ ] 用户搜索/筛选/详情抽屉/暂停（写理由）/恢复/设备撤销
- [ ] 暂停后该用户桌宠退出登录且 WS 断开（用 test@pet.dev 验证）
- [ ] 用量日期范围、waitlist 邀请/过期、审计日志出现对应事件
- [ ] 敏感页：无授权看不到原文；授权后一次读取、刷新后 410
- [ ] 普通用户 token 访问 /admin/* 返回 401（curl 验证）

- [ ] **Step 4: Commit**

```bash
git add docs/admin-deploy.md
git commit -m "docs: admin console deploy notes"
```

---

## 自审记录（写完后核对）

- **Spec 覆盖**：管理员认证（Task 7/8/9）、用户与设备（Task 11）、用量（Task 12）、waitlist（Task 13/15）、聊天/记忆脱敏 + 一次性授权（Task 17/18/19）、审计（Task 4/16）、前端页面（Task 10/14/15/16/19）、e2e（Task 20）、部署说明（Task 21）、错误处理与限流（Task 7 内）、账号暂停事务（Task 11）、RLS claims 兼容（Task 11/17/18 的 withUserClaims）。
- **类型一致性**：`withUserClaims` 定义于 admin-users.ts 并被 admin-sensitive.ts 复用；`AdminVariables`/`requireAdminAuth` 定义于 admin.ts 统一引用；`writeAudit` 注入签名在三个路由工厂一致；`AdminRouterDeps.waitlist.invite` 与 WaitlistService.invite 签名一致。
- **占位符核对**：所有任务含完整代码；Task 14 的四个占位页是"可运行的最小实现"（后续任务替换），不是计划占位符；Task 7 的"预留符号删除"是显式指令。
