import { describe, expect, it } from 'vitest';

import type { ChatFlowState } from './chat-flow-state.js';
import { initialChatFlowState } from './chat-flow-state.js';
import {
  compositeScore,
  fuseAndScore,
  retrieveMemoryNodeFactory,
  rrfFuse,
  timeDecay,
  MEMORY_HALF_LIFE_MS,
  type MemoryRetrievalStore,
  type RetrievedMemory,
} from './memory-retrieval.js';

function hit(
  id: string,
  value = '记忆内容',
  createdAt = '2026-08-01T00:00:00.000Z',
): RetrievedMemory {
  return {
    memoryId: id,
    value,
    category: 'preference',
    sourceType: 'user_stated',
    sensitivity: 'low',
    importance: 5,
    visibility: 'private',
    purpose: 'private_chat',
    createdAt,
  };
}

describe('rrfFuse（10.7 RRF 合并）', () => {
  it('双列表按 memoryId 合并：1/(60+rank_vec) + 1/(60+rank_fts)', () => {
    const fused = rrfFuse([hit('a'), hit('b')], [hit('b'), hit('c')]);
    // a 只出现在向量臂 rank1；b 双臂 rank2/rank1；c 只在全文臂 rank2
    expect(fused.get('a')?.rrf).toBeCloseTo(1 / 61);
    expect(fused.get('b')?.rrf).toBeCloseTo(1 / 62 + 1 / 61);
    expect(fused.get('c')?.rrf).toBeCloseTo(1 / 62);
  });

  it('单列表退化：仅该列表排名（embedding 就绪前 FTS-only 路径）', () => {
    const fused = rrfFuse([], [hit('a'), hit('b')]);
    expect(fused.get('a')?.rrf).toBeCloseTo(1 / 61);
    expect(fused.get('b')?.rrf).toBeCloseTo(1 / 62);
    expect(fused.size).toBe(2);
  });
});

describe('timeDecay（指数降权不删除）', () => {
  it('刚写入权重 1；半衰期后 0.5；两倍半衰期后 0.25', () => {
    expect(timeDecay(0)).toBe(1);
    expect(timeDecay(MEMORY_HALF_LIFE_MS)).toBeCloseTo(0.5);
    expect(timeDecay(MEMORY_HALF_LIFE_MS * 2)).toBeCloseTo(0.25);
  });

  it('永不为负（长期记忆只降权不删除）', () => {
    expect(timeDecay(MEMORY_HALF_LIFE_MS * 10)).toBeGreaterThan(0);
  });
});

describe('compositeScore + fuseAndScore（综合分排序）', () => {
  it('综合分 = 0.6·相关性(归一化) + 0.2·衰减 + 0.2·importance（三项可比，相关性主导）', () => {
    const maxRrf = 1 / 61;
    const score = compositeScore(maxRrf, maxRrf, 0, 5);
    expect(score).toBeCloseTo(0.6 * 1 + 0.2 * 1 + 0.2 * 0.5);
  });

  it('双臂命中的记忆显著优先于单臂（RRF 融合价值）', () => {
    const now = Date.now();
    const recent = new Date(now - 1000).toISOString();
    const dual: RetrievedMemory = {
      ...hit('dual', '双臂命中', recent),
      importance: 1,
    };
    const single: RetrievedMemory = {
      ...hit('single', '单臂命中', recent),
      importance: 10,
    };
    // dual 在双臂 rank1；single 只在单臂 rank1 → 即使 importance 满值也不能反超
    const out = fuseAndScore([dual, single], [dual], 2, now);
    expect(out[0]?.memoryId).toBe('dual');
  });

  it('排序后截断 topK', () => {
    const now = Date.now();
    const out = fuseAndScore(
      [hit('a', 'x'), hit('b', 'y')],
      [hit('c', 'z'), hit('d', 'w')],
      2,
      now,
    );
    expect(out).toHaveLength(2);
    // top-2 应是双臂 rank1 的 a/c
    expect(new Set(out.map((m) => m.memoryId))).toEqual(new Set(['a', 'c']));
  });

  it('importance 加权：同相关性下 importance 更高者靠前（微调不主导）', () => {
    const now = Date.now();
    const recent = new Date(now - 1000).toISOString();
    const highImp: RetrievedMemory = { ...hit('hi', '重要承诺'), importance: 9, createdAt: recent };
    const lowImp: RetrievedMemory = { ...hit('lo', '普通偏好'), importance: 2, createdAt: recent };
    const out = fuseAndScore([highImp, lowImp], [], 1, now);
    expect(out[0]?.memoryId).toBe('hi');
  });

  it('时间衰减：同臂同 importance，近期记忆靠前（30 天半衰期）', () => {
    const now = Date.now();
    const fresh: RetrievedMemory = {
      ...hit('fresh', '刚记住'),
      createdAt: new Date(now - 1000).toISOString(),
    };
    const old: RetrievedMemory = {
      ...hit('old', '一个月前'),
      createdAt: new Date(now - MEMORY_HALF_LIFE_MS * 2).toISOString(),
    };
    const out = fuseAndScore([fresh, old], [], 2, now);
    expect(out[0]?.memoryId).toBe('fresh');
  });
});

describe('retrieveMemoryNodeFactory（10.7 检索节点）', () => {
  const base = (message: string): ChatFlowState =>
    initialChatFlowState({
      threadId: 't1',
      userId: 'u1',
      deviceId: 'd1',
      userMessage: message,
      scenario: 'private_chat',
    });

  it('无 store 降级：返回空检索（框架阶段不误用）', async () => {
    const node = retrieveMemoryNodeFactory();
    const out = await node(base('在吗'), { threadId: 't1', emit: () => undefined });
    expect(out).toEqual({ retrievedMemories: [], retrievedMemoryIds: [] });
  });

  it('有 store：召回 → 打分 → 写入 retrievedMemories/retrievedMemoryIds', async () => {
    const store: MemoryRetrievalStore = {
      recallMemories: async () => ({
        vectorHits: [hit('m1', '喜欢抹茶')],
        ftsHits: [hit('m2', '在准备考试')],
      }),
    };
    const node = retrieveMemoryNodeFactory(store);
    const out = await node(base('喝什么'), { threadId: 't1', emit: () => undefined });
    expect(out.retrievedMemoryIds).toHaveLength(2);
    expect(out.retrievedMemories?.map((m) => m.value)).toEqual(['喜欢抹茶', '在准备考试']);
  });

  it('friend_visit 场景把 purpose 透传给 store（10.7 权限过滤输入）', async () => {
    const store: MemoryRetrievalStore = {
      recallMemories: async (input) => {
        expect(input.purpose).toBe('friend_visit');
        return { vectorHits: [], ftsHits: [] };
      },
    };
    const node = retrieveMemoryNodeFactory(store);
    const state = initialChatFlowState({
      threadId: 't2',
      userId: 'u1',
      deviceId: 'd1',
      userMessage: '在吗',
      scenario: 'friend_visit',
    });
    const out = await node(state, { threadId: 't2', emit: () => undefined });
    expect(out.retrievedMemories).toEqual([]);
  });
});
