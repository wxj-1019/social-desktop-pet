/**
 * chat → 异步记忆抽取触发测试（10.6）。
 * POST /chat 流式完成后（memoryExtractTriggered=true 且注入 memoryStore）应
 * fire-and-forget 跑真实 runMemoryExtract 全链（规则抽取 → 去重 → 落库到注入的
 * mock store）；无 memoryStore 时跳过抽取。
 */
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';

import type { BusinessVariables } from './business.js';
import { registerChatRoutes } from './chat.js';

const jwt = new JwtService({ secret: 'test-secret' });
const USER_ID = 'user-1';
const TURN_ID = '11111111-1111-4111-8111-111111111111';

function makePool() {
  const client = {
    query: vi.fn(async (sql: string) => {
      const first = sql.trim().toLowerCase();
      // 每日预算记账（12.7）：request_count 1 → 未超限
      if (first.startsWith('insert into chat_usage')) return { rows: [{ request_count: 1 }] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  // 抽取窗口行（memory_extracted_at 可为 null=未抽取 / Date=已抽取，幂等测试覆盖）
  type TurnRow = { message_id: string; content: string; memory_extracted_at: Date | null };
  const pool = {
    connect: vi.fn(async () => client),
    // saveChatMessages（insert）与 runMemoryExtract（select 最近 user turn +
    // 原子抢占标记 update）共用；默认抢占成功（返回 message_id）
    query: vi.fn(async (sql: string) => {
      const first = sql.trim().toLowerCase();
      if (first.startsWith('select message_id, content, memory_extracted_at from chat_messages')) {
        const row: TurnRow = {
          message_id: TURN_ID,
          content: '我喜欢抹茶。',
          memory_extracted_at: null,
        };
        return { rows: [row] };
      }
      // 幂等抢占：最新 turn 未被标记时抢到（返回行）；已标记（where 不命中）→ 空
      if (first.startsWith('update chat_messages set memory_extracted_at')) {
        return { rows: [{ message_id: TURN_ID }] };
      }
      return { rows: [] };
    }),
  };
  return { pool, client };
}

/** mock 记忆存储：记录落库调用（真实图 → 注入 store 的边界） */
function makeMemoryStore() {
  return {
    findSimilar: vi.fn(async () => []),
    persistMemory: vi.fn(async () => ({ memoryId: 'mem-1' })),
    invalidateMemory: vi.fn(async () => undefined),
    createConfirmation: vi.fn(async () => ({ confirmationId: 'conf-1' })),
    logAudit: vi.fn(async () => undefined),
  };
}

async function postChat(app: Hono<{ Variables: BusinessVariables }>, message: string) {
  const token = await jwt.sign({ sub: USER_ID, deviceId: 'dev-1' });
  const res = await app.request('/chat', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message, threadId: 't-1' }),
  });
  // 泵完整 SSE 流（streamSSE 回调在流消费时执行）
  await res.text();
  return res;
}

describe('POST /chat 触发异步记忆抽取（10.6）', () => {
  it('流式完成后全链抽取：规则命中 → store.persistMemory 落库（owner + source_turn_ids）', async () => {
    const { pool } = makePool();
    const memoryStore = makeMemoryStore();
    const honoApp = new Hono<{ Variables: BusinessVariables }>();
    registerChatRoutes(honoApp, {
      jwt,
      pool: pool as never,
      memoryStore: memoryStore as never,
    });

    const res = await postChat(honoApp, '我喜欢抹茶。');

    expect(res.status).toBe(200);
    // 抽取异步 fire-and-forget：等它跑完（全微任务链，无定时器）
    await vi.waitFor(() => expect(memoryStore.findSimilar).toHaveBeenCalled());
    expect(memoryStore.persistMemory).toHaveBeenCalledTimes(1);
    expect(memoryStore.persistMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: USER_ID,
        value: '我喜欢抹茶',
        category: 'preference',
        sourceTurnIds: [TURN_ID],
      }),
    );
    // 审计（11.2）：auto_save 必记
    expect(memoryStore.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auto_save' }),
    );
    // 对话消息已落库（saveChatMessages 在触发前执行）
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('insert into chat_messages'),
      expect.anything(),
    );
    // 抽取前原子抢占最新 turn 的抽取标记（memory_extracted_at，防并发重复抽取）
    await vi.waitFor(() =>
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('update chat_messages set memory_extracted_at'),
        expect.anything(),
      ),
    );
  });

  it('最新 user turn 已抽取过 → 跳过（幂等标记）', async () => {
    const { pool } = makePool();
    // 覆盖抽取窗口查询：最新 turn 的 memory_extracted_at 已打标 → 幂等跳过
    const orig = pool.query.getMockImplementation()!;
    pool.query.mockImplementation(async (sql: string) => {
      if (
        String(sql).includes('from chat_messages') &&
        String(sql).includes('memory_extracted_at')
      ) {
        return {
          rows: [{ message_id: TURN_ID, content: '我喜欢抹茶。', memory_extracted_at: new Date() }],
        };
      }
      // 已标记的 turn：抢占 update 的 where（memory_extracted_at is null）不命中 → 空返回
      if (String(sql).includes('update chat_messages set memory_extracted_at')) {
        return { rows: [] };
      }
      return orig(sql);
    });
    const memoryStore = makeMemoryStore();
    const honoApp = new Hono<{ Variables: BusinessVariables }>();
    registerChatRoutes(honoApp, {
      jwt,
      pool: pool as never,
      memoryStore: memoryStore as never,
    });

    const res = await postChat(honoApp, '我喜欢抹茶。');
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 10));
    expect(memoryStore.persistMemory).not.toHaveBeenCalled();
    expect(memoryStore.findSimilar).not.toHaveBeenCalled();
    // 抢占 update 带幂等条件（memory_extracted_at is null），已标记行不会被重复标记
    expect(
      pool.query.mock.calls.some(
        ([sql]) =>
          String(sql).includes('update chat_messages set memory_extracted_at') &&
          String(sql).includes('memory_extracted_at is null'),
      ),
    ).toBe(true);
  });

  it('未注入 memoryStore → 跳过抽取（不查 owner turns）', async () => {
    const { pool } = makePool();
    const honoApp = new Hono<{ Variables: BusinessVariables }>();
    registerChatRoutes(honoApp, { jwt, pool: pool as never });

    const res = await postChat(honoApp, '我喜欢抹茶。');
    expect(res.status).toBe(200);

    const memorySelects = pool.query.mock.calls.filter(([sql]) =>
      String(sql).includes('select message_id, content, memory_extracted_at from chat_messages'),
    );
    expect(memorySelects).toHaveLength(0);
  });
});
