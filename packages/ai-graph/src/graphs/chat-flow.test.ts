import { describe, expect, it } from 'vitest';

import { StateGraph, type NodeFn } from '../runtime/index.js';
import { END, START } from '../runtime/types.js';

import { crisisResponseNode, retrieveMemoryNode, authNode } from './chat-flow-nodes.js';
import { initialChatFlowState } from './chat-flow-state.js';
import type { ChatFlowState } from './chat-flow-state.js';
import { buildChatFlow } from './chat-flow.js';

describe('chat-flow graph', () => {
  it('compiles and executes the scaffold path to END', async () => {
    const graph = buildChatFlow();
    const state = initialChatFlowState({
      threadId: 't1',
      userId: 'u1',
      deviceId: 'd1',
      userMessage: '你好',
      scenario: 'private_chat',
    });
    const result = await graph.invoke(state, { threadId: 't1' });
    // 骨架路径：classify=none → retrieve → build_context(L1) → generate → moderate → approve → END
    expect(result.authenticated).toBe(true);
    expect(result.modelOutput?.dialogue).toContain('你好');
    expect(result.memoryExtractTriggered).toBe(true);
  });

  it('routes to crisis when classify returns non-none crisisLevel (11.8 conditional edge)', async () => {
    // 用一个返回危机分类的自定义 classify 节点，验证条件边把执行导向 crisis_response
    const crisisClassify: NodeFn<ChatFlowState> = async () => ({
      inputClassification: { categories: ['self_harm'], crisisLevel: 'high', confidence: 0.9 },
    });

    const graph = new StateGraph<ChatFlowState>()
      .addNode('auth', authNode)
      .addNode('classify_input', crisisClassify)
      .addNode('retrieve_memory', retrieveMemoryNode)
      .addNode('crisis_response', crisisResponseNode)
      .addEdge(START, 'auth')
      .addEdge('auth', 'classify_input')
      .addConditionalEdge('classify_input', (s) =>
        s.inputClassification?.crisisLevel && s.inputClassification.crisisLevel !== 'none'
          ? 'crisis_response'
          : 'retrieve_memory',
      )
      .addEdge('retrieve_memory', END)
      .addEdge('crisis_response', END)
      .compile();

    const state = initialChatFlowState({
      threadId: 't2',
      userId: 'u1',
      deviceId: 'd1',
      userMessage: '...',
      scenario: 'private_chat',
    });
    const result = await graph.invoke(state, { threadId: 't2' });
    expect(result.crisisLevel).toBe('high');
    expect(result.memoryExtractTriggered).toBe(false);
  });

  it('emits node_start/node_end spans for observability (11.2)', async () => {
    const graph = buildChatFlow();
    const events: string[] = [];
    const state = initialChatFlowState({
      threadId: 't3',
      userId: 'u1',
      deviceId: 'd1',
      userMessage: 'hi',
      scenario: 'private_chat',
    });
    await graph.invoke(state, {
      threadId: 't3',
      emit: (e) => events.push(e.type),
    });
    expect(events).toContain('node_start');
    expect(events).toContain('node_end');
  });

  it('generateNode streams token events and final dialogue matches (SSE 链路基础)', async () => {
    const graph = buildChatFlow();
    const tokens: string[] = [];
    const state = initialChatFlowState({
      threadId: 't4',
      userId: 'u1',
      deviceId: 'd1',
      userMessage: '今天天气不错',
      scenario: 'private_chat',
    });
    const result = await graph.invoke(state, {
      threadId: 't4',
      emit: (e) => {
        if (e.type === 'token') tokens.push(e.text);
      },
    });
    // token 流非空且拼接结果 = modelOutput.dialogue（客户端按序拼 token 可得完整回复）
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.join('')).toBe(result.modelOutput?.dialogue);
    expect(result.modelOutput?.dialogue).toContain('今天天气不错');
  });
});
