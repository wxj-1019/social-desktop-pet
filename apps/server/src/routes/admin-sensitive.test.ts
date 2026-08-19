import { describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';

import { createAdminSensitiveRouter } from './admin-sensitive.js';

const JWT = new JwtService({ secret: 'admin-test-secret-admin-test-secret' });

function buildRouter(
  rowsByFragment: Array<{ fragment: string; rows: unknown[]; rowCount?: number }>,
) {
  const allQueries: Array<{ sql: string; params?: unknown[] }> = [];
  const record = (sql: string, params?: unknown[]) => allQueries.push({ sql, params });
  const route = async (sql: string, params?: unknown[]) => {
    record(sql, params);
    const hit = rowsByFragment.find((r) => sql.includes(r.fragment));
    return { rows: hit?.rows ?? [], rowCount: hit?.rowCount ?? hit?.rows.length ?? 0 };
  };
  const pool = {
    connect: vi.fn(async () => ({
      query: vi.fn(route),
      release: vi.fn(),
    })),
    query: vi.fn(route),
  };
  const adminUsers = {
    getById: vi.fn(async () => ({ id: 'a1', email: 'admin@pet.dev', status: 'active' })),
  };
  const app = createAdminSensitiveRouter({
    pool: pool as never,
    jwt: JWT,
    adminUsers: adminUsers as never,
  });
  return { app, pool, queries: allQueries };
}

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('admin sensitive routes', () => {
  it('chat summary masks PII and never returns full short content (真实脱敏)', async () => {
    const { app } = buildRouter([
      {
        fragment: 'from chat_messages',
        rows: [
          {
            message_id: 'm1',
            role: 'user',
            content: '邮箱 tom@example.com',
            created_at: '2026-08-18T00:00:00Z',
          },
          {
            message_id: 'm2',
            role: 'user',
            content: '手机 13812345678',
            created_at: '2026-08-18T00:00:01Z',
          },
          {
            message_id: 'm3',
            role: 'user',
            content: '卡号 6222000012345678 请保存',
            created_at: '2026-08-18T00:00:02Z',
          },
          {
            message_id: 'm4',
            role: 'assistant',
            content: '脱敏摘要测试'.repeat(11), // 44 字符长文
            created_at: '2026-08-18T00:00:03Z',
          },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request(`/users/${USER_ID}/chat-summary?page=1&pageSize=20`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ summary: string }> };
    // PII 掩码：邮箱/手机号/银行卡号绝不以原文出现
    for (const item of body.items) {
      expect(item.summary).not.toContain('tom@example.com');
      expect(item.summary).not.toContain('13812345678');
      expect(item.summary).not.toContain('6222000012345678');
    }
    expect(body.items[0]!.summary).toContain('[邮箱]');
    expect(body.items[1]!.summary).toContain('[手机号]');
    expect(body.items[2]!.summary).toContain('[银行卡号]');
    // 短文不整段透出：摘要统一头部截断（12 字 + 省略号）
    expect(body.items[3]!.summary).toBe('脱敏摘要测试'.repeat(2) + '…');
    for (const item of body.items) {
      expect(item.summary.length).toBeLessThanOrEqual(13);
    }
  });

  it('chat summary rejects malformed from/to dates (422)', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request(`/users/${USER_ID}/chat-summary?from=not-a-date`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid_input' });
  });

  it('memories summary returns masked value', async () => {
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
    const res = await app.request(`/users/${USER_ID}/memories-summary?page=1`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ summary: string }> };
    expect(body.items[0]!.summary).toBe('喜欢抹茶拿铁，加双份浓缩…');
  });

  it('creates a single-use grant with in-transaction audit', async () => {
    const { app, queries } = buildRouter([
      { fragment: 'select 1 from auth.users', rows: [{ exists: 1 }], rowCount: 1 },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/sensitive-access', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        targetUserId: USER_ID,
        resourceType: 'chat',
        reason: '用户投诉需要核查对话',
        scope: { from: '2026-08-01', to: '2026-08-02' },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      grantId: string;
      token: string;
      expiresAt: string;
    };
    expect(body.grantId).toBeTruthy();
    expect(body.token.length).toBeGreaterThan(20);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // insert SQL 参数里只存哈希，不存明文；insert 在事务 client 上执行
    const insertCall = queries.find((q) => q.sql.includes('insert into admin_sensitive_grants'));
    expect(insertCall).toBeDefined();
    expect(insertCall!.params!.includes(body.token)).toBe(false);
    // sensitive.grant 审计与 insert 同事务（同一 client 序列，begin → insert → audit → commit）
    const insertIdx = queries.findIndex((q) =>
      q.sql.includes('insert into admin_sensitive_grants'),
    );
    const auditIdx = queries.findIndex(
      (q) => q.sql.includes('insert into admin_audit_log') && q.params?.[1] === 'sensitive.grant',
    );
    expect(auditIdx).toBeGreaterThan(insertIdx);
    expect(queries.some((q, i) => i > auditIdx && q.sql === 'commit')).toBe(true);
  });

  it('rejects grant with too-short reason', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/sensitive-access', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        targetUserId: USER_ID,
        resourceType: 'chat',
        reason: '短',
        scope: { from: '2026-08-01' },
      }),
    });
    expect(res.status).toBe(422);
  });

  it('rejects grant with non-string reason (422, not 500)', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/sensitive-access', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        targetUserId: USER_ID,
        resourceType: 'chat',
        reason: 12345,
        scope: { from: '2026-08-01' },
      }),
    });
    expect(res.status).toBe(422);
  });

  it('rejects grant with non-uuid targetUserId (422, not PG 22P02)', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/sensitive-access', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        targetUserId: 'not-a-uuid',
        resourceType: 'chat',
        reason: '用户投诉需要核查对话',
        scope: { from: '2026-08-01' },
      }),
    });
    expect(res.status).toBe(422);
  });

  it('rejects grant without scope.from（禁止无范围批量导出）', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/sensitive-access', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        targetUserId: USER_ID,
        resourceType: 'chat',
        reason: '用户投诉需要核查对话',
        scope: {},
      }),
    });
    expect(res.status).toBe(422);
  });

  it('rejects grant with non-calendar or inverted date range', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    for (const scope of [
      { from: '2026-02-30' }, // 非日历日期
      { from: '2026-08-02', to: '2026-08-01' }, // to < from
      { from: 'not-a-date' },
    ]) {
      const res = await app.request('/sensitive-access', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          targetUserId: USER_ID,
          resourceType: 'chat',
          reason: '用户投诉需要核查对话',
          scope,
        }),
      });
      expect(res.status, JSON.stringify(scope)).toBe(422);
    }
  });

  it('rejects grant spanning more than 31 days（跨度上限，防一次授权拖全历史）', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/sensitive-access', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        targetUserId: USER_ID,
        resourceType: 'chat',
        reason: '用户投诉需要核查对话',
        scope: { from: '2026-01-01', to: '2026-08-01' },
      }),
    });
    expect(res.status).toBe(422);
  });

  it('rejects content request with non-uuid grantId (422)', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/sensitive-access/not-a-uuid/content', {
      headers: { authorization: `Bearer ${token}`, 'x-grant-token': 'raw-token' },
    });
    expect(res.status).toBe(422);
  });

  it('consumes the grant atomically: consume + read + audit in one transaction, no-store', async () => {
    const { app, queries } = buildRouter([
      {
        fragment: 'select g.grant_id',
        rows: [
          {
            grant_id: '11111111-1111-4111-8111-111111111111',
            target_user_id: 'u1',
            resource_type: 'chat',
            resource_scope: { from: '2026-08-01', to: '2026-08-02' },
            reason: '测试',
            expires_at: 9999999999999,
            used_at: null,
          },
        ],
      },
      { fragment: 'update admin_sensitive_grants set used_at', rows: [], rowCount: 1 },
      {
        fragment: 'from chat_messages',
        rows: [
          {
            message_id: 'm1',
            role: 'user',
            content: '完整原文',
            created_at: '2026-08-18T00:00:00Z',
          },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request(
      '/sensitive-access/11111111-1111-4111-8111-111111111111/content',
      {
        headers: { authorization: `Bearer ${token}`, 'x-grant-token': 'raw-token' },
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ content: string }> };
    expect(body.items[0]!.content).toBe('完整原文');
    // 原文响应禁止缓存（一次性授权语义）
    expect(res.headers.get('cache-control')).toBe('no-store');
    // 内容查询必须携带授权时界（scope 生效，防批量导出）
    const chatQuery = queries.find((q) => q.sql.includes('from chat_messages'));
    expect(chatQuery).toBeDefined();
    expect(chatQuery!.params).toEqual(['u1', '2026-08-01', '2026-08-02']);
    // 消费 UPDATE 必须原子判定过期（消除校验与消费之间的过期竞态窗口）
    const consume = queries.find((q) =>
      q.sql.includes('update admin_sensitive_grants set used_at'),
    );
    expect(consume!.sql).toContain('expires_at > now()');
    // sensitive.read 审计在消费之后、同一事务内（commit 之前）
    const consumeIdx = queries.findIndex((q) =>
      q.sql.includes('update admin_sensitive_grants set used_at'),
    );
    const auditIdx = queries.findIndex(
      (q) => q.sql.includes('insert into admin_audit_log') && q.params?.[1] === 'sensitive.read',
    );
    expect(auditIdx).toBeGreaterThan(consumeIdx);
    const commitIdx = queries.map((q) => q.sql).lastIndexOf('commit');
    expect(commitIdx).toBeGreaterThan(auditIdx);
  });

  it('rejects a used grant with 410', async () => {
    const { app } = buildRouter([
      {
        fragment: 'select g.grant_id',
        rows: [
          {
            grant_id: '11111111-1111-4111-8111-111111111111',
            target_user_id: 'u1',
            resource_type: 'chat',
            resource_scope: '{}',
            reason: '测试',
            expires_at: 9999999999999,
            used_at: '2026-08-18T00:00:00Z',
          },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request(
      '/sensitive-access/11111111-1111-4111-8111-111111111111/content',
      {
        headers: { authorization: `Bearer ${token}`, 'x-grant-token': 'raw-token' },
      },
    );
    expect(res.status).toBe(410);
  });
});
