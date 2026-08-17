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
});
