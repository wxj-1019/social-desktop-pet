import { describe, expect, it } from 'vitest';

import { MemoryCheckpointer } from '../runtime/index.js';

import { buildMemoryExtractFlow } from './memory-extract.js';

describe('memory-extract graph (10.6)', () => {
  const baseState = {
    threadId: 't1',
    ownerUserId: '22222222-2222-2222-2222-222222222222',
    ownerTurns: ['我最近在准备考试。', '我喜欢抹茶。'],
    persistedCount: 0,
  };

  it('compiles and executes the full mem0-style pipeline to END', async () => {
    const graph = buildMemoryExtractFlow();
    const result = await graph.invoke(baseState, { threadId: 't1' });
    // 骨架路径：extract → injection_check → dedupe → tiered_confirm → persist → END
    expect(result.candidates).toBeDefined();
    expect(result.dedupeActions).toBeDefined();
    expect(result.pendingConfirmation).toBeDefined();
    expect(result.persistedCount).toBe(0); // 骨架阶段不真实落库
  });

  it('emits node_start/node_end for every node (11.2 audit trail)', async () => {
    const graph = buildMemoryExtractFlow();
    const spans: string[] = [];
    await graph.invoke(baseState, {
      threadId: 't2',
      emit: (e) => spans.push(`${e.type}:${'node' in e ? e.node : e.type}`),
    });
    const nodeStarts = spans.filter((s) => s.startsWith('node_start'));
    expect(nodeStarts).toHaveLength(5); // 5 个节点
  });

  it('exposes its structure for visualization/debugging', async () => {
    const graph = buildMemoryExtractFlow();
    const structure = graph.getStructure();
    expect(structure.nodes).toEqual(
      expect.arrayContaining([
        'extract_candidates',
        'injection_check',
        'dedupe_arbitrate',
        'tiered_confirm',
        'persist',
      ]),
    );
    // 线性流水线：真实节点间的每条边 from→to 都应是已注册节点
    for (const { from, to } of structure.edges) {
      // __START__ / __END__ 是哨兵，不在 nodes 里
      if (from === '__START__' || to === '__END__') continue;
      expect(structure.nodes).toContain(from);
      expect(structure.nodes).toContain(to);
    }
  });

  it('checkpoints work with MemoryCheckpointer (13.5 replay source)', async () => {
    const checkpoints = new MemoryCheckpointer<typeof baseState>();
    await checkpoints.save('t4', 'persist', baseState);
    const loaded = await checkpoints.load('t4');
    expect(loaded?.node).toBe('persist');
    expect(loaded?.state.ownerUserId).toBe(baseState.ownerUserId);
  });
});
