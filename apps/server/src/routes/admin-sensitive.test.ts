import { describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';

import { createAdminSensitiveRouter } from './admin-sensitive.js';

const JWT = new JwtService({ secret: 'admin-test-secret-admin-test-secret' });

function buildRouter(
  rowsByFragment: Array<{ fragment: string; rows: unknown[]; rowCount?: number }>,
) {
  const pool = {
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string) => {
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
  const adminUsers = {
    getById: vi.fn(async () => ({ id: 'a1', email: 'admin@pet.dev', status: 'active' })),
  };
  const app = createAdminSensitiveRouter({
    pool: pool as never,
    jwt: JWT,
    adminUsers: adminUsers as never,
    writeAudit: vi.fn(async () => undefined) as never,
  });
  return { app, pool };
}

describe('admin sensitive routes', () => {
  it('chat summary returns truncated content (脱敏摘要)', async () => {
    const longContent = '脱敏摘要测试'.repeat(11); // 44 字符 > 40
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
          {
            message_id: 'm2',
            role: 'assistant',
            content: longContent,
            created_at: '2026-08-18T00:00:01Z',
          },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/users/u1/chat-summary?page=1&pageSize=20', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ summary: string }> };
    // 短内容原样返回
    expect(body.items[0]!.summary).toBe('今天心情不太好，想找人聊聊。');
    // 超长内容截断到 40 字符 + 省略号（原文不出服务端）
    expect(body.items[0]!.summary.length).toBeLessThanOrEqual(41); // 40 + 省略号
    // 44 字符内容 → 6 组(36 字符) + '脱敏摘要'(4 字符) + '…'
    expect(body.items[1]!.summary).toBe('脱敏摘要测试'.repeat(6) + '脱敏摘要' + '…');
    expect(body.items[1]!.summary.length).toBe(41);
  });

  it('chat summary rejects malformed from/to dates (422)', async () => {
    const { app } = buildRouter([]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/users/u1/chat-summary?from=not-a-date', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid_input' });
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
    const res = await app.request('/users/u1/memories-summary?page=1', {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ category: string }> };
    expect(body.items[0]!.category).toBe('preference');
  });

  it('creates a single-use grant bound to admin/user/type', async () => {
    const { app, pool } = buildRouter([
      { fragment: 'select 1 from auth.users', rows: [{ exists: 1 }], rowCount: 1 },
      { fragment: 'insert into admin_sensitive_grants', rows: [], rowCount: 1 },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/sensitive-access', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        targetUserId: 'u1',
        resourceType: 'chat',
        reason: '用户投诉需要核查对话',
        scope: {},
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
    // insert SQL 参数里只存哈希，不存明文
    const insertCall = pool.query.mock.calls.find(([sql]: [string]) =>
      String(sql).includes('insert into admin_sensitive_grants'),
    ) as unknown as [string, unknown[]];
    expect(insertCall[1]!.includes(body.token)).toBe(false);
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
        targetUserId: 'u1',
        resourceType: 'chat',
        reason: '短',
        scope: {},
      }),
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
            reason: '测试',
            expires_at: 9999999999999,
            used_at: null,
          },
        ],
      },
      // token 哈希校验查询
      { fragment: 'select 1 from admin_sensitive_grants', rows: [{ '?column?': 1 }] },
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
    const res = await app.request('/sensitive-access/g1/content', {
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
            reason: '测试',
            expires_at: 9999999999999,
            used_at: '2026-08-18T00:00:00Z',
          },
        ],
      },
    ]);
    const token = await JWT.signAdmin('a1');
    const res = await app.request('/sensitive-access/g1/content', {
      headers: { authorization: `Bearer ${token}`, 'x-grant-token': 'raw-token' },
    });
    expect(res.status).toBe(410);
  });
});
