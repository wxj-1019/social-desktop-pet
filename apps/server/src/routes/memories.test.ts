/**
 * /memories 路由测试 —— 10.6 / D-3 分级确认 HITL 收口。
 * 用脚本化 fake pool 模拟 SQL 返回，覆盖 summary/confirm/reject/invalidate 四条路径。
 */
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';

import { registerMemoriesRoutes } from './memories.js';

const jwt = new JwtService({ secret: 'test-secret' });

const CONFIRM_ROW = {
  confirmation_id: '99999999-9999-4999-8999-999999999999',
  category: 'fact',
  value: '我有糖尿病',
  importance: 7,
  source_type: 'user_stated',
  sensitivity: 'high',
  source_turn_ids: ['11111111-1111-4111-8111-111111111111'],
  created_at: new Date('2026-08-03T10:00:00Z'),
};

/** 脚本化 fake client：按调用顺序吐 rows（begin/commit/rollback/set_config 等控制语句跳过） */
function scriptedClient(script: Array<{ rows: unknown[] }>) {
  let i = 0;
  return {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      const first = sql.trim().toLowerCase();
      if (
        first.startsWith('begin') ||
        first.startsWith('commit') ||
        first.startsWith('rollback') ||
        first.startsWith('select set_config')
      ) {
        return { rows: [] };
      }
      return script[i++] ?? { rows: [] };
    }),
    release: vi.fn(),
  };
}

function makePool(client: ReturnType<typeof scriptedClient>) {
  return { connect: vi.fn(async () => client) };
}

/** 仅取业务数据查询（剔除 begin/commit/rollback/set_config 控制语句） */
function dataCalls(client: ReturnType<typeof scriptedClient>) {
  return client.query.mock.calls.filter(([sql]) => {
    const first = String(sql).trim().toLowerCase();
    return !(
      first.startsWith('begin') ||
      first.startsWith('commit') ||
      first.startsWith('rollback') ||
      first.startsWith('select set_config')
    );
  });
}

type TestApp = Hono<{ Variables: { userId: string; deviceId: string } }>;

function makeApp(pool: unknown): TestApp {
  const app = new Hono<{ Variables: { userId: string; deviceId: string } }>();
  registerMemoriesRoutes(app, { pool: pool as never, jwt });
  return app;
}

async function authedRequest(
  app: TestApp,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Response> {
  const token = await jwt.sign({ sub: 'user-1', deviceId: 'dev-1' });
  return app.request(path, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

describe('GET /memories/summary', () => {
  it('返回 pending 确认列表 + 最近自动保存（契约字段完整）', async () => {
    const client = scriptedClient([
      { rows: [CONFIRM_ROW] }, // pending
      {
        rows: [
          {
            memory_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            value: '我喜欢抹茶',
            created_at: new Date('2026-08-03T10:00:30Z'),
          },
        ],
      },
    ]);
    const app = makeApp(makePool(client));

    const res = await authedRequest(app, '/memories/summary');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pending: Array<{ confirmationId: string }>;
      recentlySaved: Array<{ memoryId: string }>;
    };
    expect(body.pending).toHaveLength(1);
    expect(body.pending[0]).toMatchObject({
      confirmationId: '99999999-9999-4999-8999-999999999999',
      value: '我有糖尿病',
      sensitivity: 'high',
      sourceTurnIds: ['11111111-1111-4111-8111-111111111111'],
    });
    expect(body.recentlySaved[0]?.memoryId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  it('未鉴权 → 401', async () => {
    const app = makeApp(makePool(scriptedClient([])));
    const res = await app.request('/memories/summary');
    expect(res.status).toBe(401);
  });
});

describe('POST /memories/confirm', () => {
  it('确认落库（user_confirmed=true）+ 置 confirmed + 审计', async () => {
    const client = scriptedClient([
      { rows: [CONFIRM_ROW] }, // select for update
      { rows: [{ memory_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }] }, // insert private_memories
      { rows: [] }, // update status
      { rows: [] }, // insert audit
    ]);
    const app = makeApp(makePool(client));

    const res = await authedRequest(app, '/memories/confirm', {
      method: 'POST',
      body: { confirmationId: CONFIRM_ROW.confirmation_id },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ memoryId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });

    // 落库 insert 的用户确认位（数据查询序：0=select for update, 1=insert）
    const insertSql = String(dataCalls(client)[1]?.[0]);
    expect(insertSql).toContain('user_confirmed');
    expect(insertSql).toContain('true');
    // 命名空间是参数 $8，不是字面量
    const insertParams = dataCalls(client)[1]?.[1] as unknown[];
    expect(insertParams).toContain('star-isle:private_chat');
  });

  it('携带修改值 → source_type=user_confirmed 且用新值落库', async () => {
    const client = scriptedClient([
      { rows: [CONFIRM_ROW] },
      { rows: [{ memory_id: 'm-1' }] },
      { rows: [] },
      { rows: [] },
    ]);
    const app = makeApp(makePool(client));

    const res = await authedRequest(app, '/memories/confirm', {
      method: 'POST',
      body: { confirmationId: CONFIRM_ROW.confirmation_id, value: '我有二型糖尿病' },
    });
    expect(res.status).toBe(200);
    const params = dataCalls(client)[1]?.[1] as unknown[];
    expect(params).toContain('我有二型糖尿病');
    expect(params).toContain('user_confirmed');
  });

  it('已处理/不存在 → 410', async () => {
    const client = scriptedClient([{ rows: [] }]);
    const app = makeApp(makePool(client));
    const res = await authedRequest(app, '/memories/confirm', {
      method: 'POST',
      body: { confirmationId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(res.status).toBe(410);
  });

  it('缺 confirmationId → 400', async () => {
    const app = makeApp(makePool(scriptedClient([])));
    const res = await authedRequest(app, '/memories/confirm', {
      method: 'POST',
      body: {},
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /memories/reject', () => {
  it('置 rejected + 审计 user_rejected', async () => {
    const client = scriptedClient([
      { rows: [CONFIRM_ROW] }, // select for update
      { rows: [] }, // update status
      { rows: [] }, // insert audit
    ]);
    const app = makeApp(makePool(client));

    const res = await authedRequest(app, '/memories/reject', {
      method: 'POST',
      body: { confirmationId: CONFIRM_ROW.confirmation_id },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const auditSql = String(dataCalls(client)[2]?.[0]);
    expect(auditSql).toContain('user_rejected');
  });
});

describe('POST /memories/:memoryId/invalidate', () => {
  it('撤销自动保存：置 invalidated + 审计', async () => {
    const client = scriptedClient([
      {
        rows: [
          {
            value: '我喜欢抹茶',
            source_turn_ids: ['11111111-1111-4111-8111-111111111111'],
          },
        ],
      }, // update ... returning
      { rows: [] }, // insert audit
    ]);
    const app = makeApp(makePool(client));

    const res = await authedRequest(
      app,
      '/memories/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/invalidate',
      { method: 'POST' },
    );
    expect(res.status).toBe(200);
    const updateSql = String(dataCalls(client)[0]?.[0]);
    expect(updateSql).toContain("memory_status = 'invalidated'");
    expect(updateSql).toContain('owner_user_id = $2');
  });

  it('不存在/已撤销 → 404', async () => {
    const client = scriptedClient([{ rows: [] }]);
    const app = makeApp(makePool(client));
    const res = await authedRequest(
      app,
      '/memories/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/invalidate',
      { method: 'POST' },
    );
    expect(res.status).toBe(404);
  });
});
