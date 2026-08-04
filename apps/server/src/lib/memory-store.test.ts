/**
 * PgMemoryExtractStore 测试 —— 10.7 向量臂注入行为（脚本化 fake client）。
 *
 * 覆盖：persistMemory 落库 embedding（有/无 provider）；recallMemories 查询向量
 * 生成与向量臂 SQL（有/无 provider 降级 FTS-only）。
 */
import type { EmbeddingProvider } from '@pet/ai-graph';
import { describe, expect, it, vi } from 'vitest';

import { PgMemoryExtractStore } from './memory-store.js';

const USER_ID = '22222222-2222-4222-8222-222222222222';

const EMBEDDER: EmbeddingProvider = {
  embed: async (texts) => texts.map((t) => [t.length, 1, 0]),
};

/** 脚本化 client：begin/commit/rollback/set_config 跳过，业务 SQL 按序吐 rows */
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

/** 仅取业务数据查询 */
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

describe('persistMemory embedding 落库（10.7）', () => {
  it('有 provider → insert 带 embedding 向量参数', async () => {
    const client = scriptedClient([{ rows: [{ memory_id: 'm-1' }] }]);
    const store = new PgMemoryExtractStore(makePool(client) as never, EMBEDDER);

    await store.persistMemory({
      ownerUserId: USER_ID,
      category: 'preference',
      value: '我喜欢抹茶',
      importance: 5,
      sourceType: 'user_stated',
      sensitivity: 'low',
      sourceTurnIds: [],
    });

    const [sql, params] = dataCalls(client)[0] as [string, unknown[]];
    expect(sql).toContain('embedding');
    expect(sql).toContain('$10::vector');
    // 输入序嵌入：value 长度 5（"我喜欢抹茶"）
    expect(params[9]).toBe(JSON.stringify([5, 1, 0]));
  });

  it('无 provider → embedding 参数为 null（FTS-only 降级）', async () => {
    const client = scriptedClient([{ rows: [{ memory_id: 'm-1' }] }]);
    const store = new PgMemoryExtractStore(makePool(client) as never);

    await store.persistMemory({
      ownerUserId: USER_ID,
      category: 'preference',
      value: '我喜欢抹茶',
      importance: 5,
      sourceType: 'user_stated',
      sensitivity: 'low',
      sourceTurnIds: [],
    });

    const params = dataCalls(client)[0]?.[1] as unknown[];
    expect(params[9]).toBeNull();
  });

  it('嵌入失败不阻塞落库（降级 FTS-only + 日志）', async () => {
    const failing: EmbeddingProvider = {
      embed: async () => {
        throw new Error('embedding api down');
      },
    };
    const client = scriptedClient([{ rows: [{ memory_id: 'm-1' }] }]);
    const store = new PgMemoryExtractStore(makePool(client) as never, failing);

    await store.persistMemory({
      ownerUserId: USER_ID,
      category: 'preference',
      value: '我喜欢抹茶',
      importance: 5,
      sourceType: 'user_stated',
      sensitivity: 'low',
      sourceTurnIds: [],
    });
    const params = dataCalls(client)[0]?.[1] as unknown[];
    expect(params[9]).toBeNull(); // 记忆照常落库，向量缺失由回填脚本补齐
  });
});

describe('recallMemories 向量臂（10.7）', () => {
  it('有 provider → 生成查询向量并跑向量臂 SQL（HNSW 余弦）', async () => {
    const client = scriptedClient([{ rows: [] }, { rows: [] }]);
    const store = new PgMemoryExtractStore(makePool(client) as never, EMBEDDER);

    await store.recallMemories({
      ownerUserId: USER_ID,
      query: '喝什么',
      purpose: 'private_chat',
      topK: 6,
    });

    const calls = dataCalls(client);
    // 0=FTS 臂，1=向量臂
    const [vecSql, vecParams] = calls[1] as [string, unknown[]];
    expect(vecSql).toContain('embedding <=> $4::vector');
    expect(vecSql).toContain('embedding is not null');
    // 查询向量参数（JSON 序列化后经 $4::vector 转换；"喝什么"=3 字符）
    expect(vecParams[3]).toBe(JSON.stringify([3, 1, 0]));
    expect(vecParams[4]).toBe(20);
  });

  it('无 provider → 只跑 FTS 臂（RRF 单臂退化，检索语义不变）', async () => {
    const client = scriptedClient([{ rows: [] }]);
    const store = new PgMemoryExtractStore(makePool(client) as never);

    await store.recallMemories({
      ownerUserId: USER_ID,
      query: '喝什么',
      purpose: 'private_chat',
      topK: 6,
    });

    const calls = dataCalls(client);
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.[0])).toContain('ts_rank_cd');
  });
});
