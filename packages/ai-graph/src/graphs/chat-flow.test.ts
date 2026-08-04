import { describe, expect, it } from 'vitest';

import type { LlmClient } from '../llm/types.js';
import { StateGraph, type NodeFn } from '../runtime/index.js';
import { END, START } from '../runtime/types.js';

import {
  crisisResponseNode,
  authNode,
  classifyInputNode,
  localReplyNode,
  type OutputModerator,
} from './chat-flow-nodes.js';
import { initialChatFlowState } from './chat-flow-state.js';
import type { ChatFlowState } from './chat-flow-state.js';
import { buildChatFlow } from './chat-flow.js';
import {
  retrieveMemoryNodeFactory,
  type MemoryRetrievalStore,
  type RetrievedMemory,
} from './memory-retrieval.js';

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
      .addNode('retrieve_memory', retrieveMemoryNodeFactory())
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

  it('危机三级固定话术（11.8）：high 附本地化资源、medium 软转介、low 温和关怀', async () => {
    const run = async (level: 'low' | 'medium' | 'high') => {
      const crisisClassify: NodeFn<ChatFlowState> = async () => ({
        inputClassification: { categories: ['self_harm'], crisisLevel: level, confidence: 0.9 },
      });
      const graph = new StateGraph<ChatFlowState>()
        .addNode('auth', authNode)
        .addNode('classify_input', crisisClassify)
        .addNode('retrieve_memory', retrieveMemoryNodeFactory())
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
        threadId: `crisis-${level}`,
        userId: 'u1',
        deviceId: 'd1',
        userMessage: '...',
        scenario: 'private_chat',
      });
      return graph.invoke(state, { threadId: `crisis-${level}` });
    };

    const high = await run('high');
    expect(high.crisisLevel).toBe('high');
    expect(high.responseText).toContain('12356');
    expect(high.responseText).toContain('120');
    expect(high.responseText).toContain('不承诺替你保密');
    expect(high.responseText).not.toContain('scaffold');

    const medium = await run('medium');
    expect(medium.responseText).toContain('12356');
    expect(medium.responseText).toContain('信任的人');

    const low = await run('low');
    expect(low.responseText).toContain('我听到你说的了');
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

  it('generateNode 解析结构化输出：流式输出解析后 dialogue，modelOutput 完整带 emotion/actionIntent/intensity', async () => {
    const json =
      '{"dialogue":"今天也要加油哦！","emotion":"warm","actionIntent":"cheer","intensity":4}';
    const mockLlm: LlmClient = {
      streamChat: async (_messages, onToken) => {
        onToken(json);
        return json;
      },
    };
    const graph = buildChatFlow({ llm: mockLlm });
    const tokens: string[] = [];
    const state = initialChatFlowState({
      threadId: 't5',
      userId: 'u1',
      deviceId: 'd1',
      userMessage: '加油',
      scenario: 'private_chat',
    });
    const result = await graph.invoke(state, {
      threadId: 't5',
      emit: (e) => {
        if (e.type === 'token') tokens.push(e.text);
      },
    });
    // 流式 = 解析后的 dialogue（不是 JSON 原文）
    expect(tokens.join('')).toBe('今天也要加油哦！');
    // 没有任何 token 是 JSON 片段
    expect(tokens.join('')).not.toContain('dialogue');
    expect(tokens.every((t) => !t.includes('dialogue') && !t.includes('emotion'))).toBe(true);
    // modelOutput 完整透传结构化字段（驱动星屿表情动作）
    expect(result.modelOutput).toEqual({
      dialogue: '今天也要加油哦！',
      emotion: 'warm',
      actionIntent: 'cheer',
      intensity: 4,
    });
  });

  it('generateNode 对纯文本模型输出回退：dialogue=原文、emotion/actionIntent/intensity 默认', async () => {
    const mockLlm: LlmClient = {
      streamChat: async (_messages, onToken) => {
        onToken('随便聊两句吧');
        return '随便聊两句吧';
      },
    };
    const graph = buildChatFlow({ llm: mockLlm });
    const tokens: string[] = [];
    const state = initialChatFlowState({
      threadId: 't6',
      userId: 'u1',
      deviceId: 'd1',
      userMessage: '在吗',
      scenario: 'private_chat',
    });
    const result = await graph.invoke(state, {
      threadId: 't6',
      emit: (e) => {
        if (e.type === 'token') tokens.push(e.text);
      },
    });
    expect(tokens.join('')).toBe('随便聊两句吧');
    expect(result.modelOutput?.dialogue).toBe('随便聊两句吧');
    expect(result.modelOutput?.emotion).toBe('neutral');
    expect(result.modelOutput?.actionIntent).toBe('idle');
    expect(result.modelOutput?.intensity).toBe(1);
  });

  it('generateNode 在原始 token 跨片到达时也能重组并解析（buffer 收集）', async () => {
    const mockLlm: LlmClient = {
      streamChat: async (_messages, onToken) => {
        // 模拟网络分片：JSON 被切成两段到达
        onToken('{"dialogue":"想你了","emo');
        onToken('tion":"shy","actionIntent":"touch","intensity":2}');
        return '{"dialogue":"想你了","emotion":"shy","actionIntent":"touch","intensity":2}';
      },
    };
    const graph = buildChatFlow({ llm: mockLlm });
    const tokens: string[] = [];
    const state = initialChatFlowState({
      threadId: 't7',
      userId: 'u1',
      deviceId: 'd1',
      userMessage: '嘿',
      scenario: 'private_chat',
    });
    const result = await graph.invoke(state, {
      threadId: 't7',
      emit: (e) => {
        if (e.type === 'token') tokens.push(e.text);
      },
    });
    expect(tokens.join('')).toBe('想你了');
    expect(result.modelOutput?.emotion).toBe('shy');
    expect(result.modelOutput?.actionIntent).toBe('touch');
    expect(result.modelOutput?.intensity).toBe(2);
  });

  it('注入检索 store：记忆进入 retrievedMemories + contextPrompt，且 LLM 收到含记忆的上下文（10.7 反哺对话）', async () => {
    const memory: RetrievedMemory = {
      memoryId: 'mem-1',
      value: '喜欢抹茶',
      category: 'preference',
      sourceType: 'user_stated',
      sensitivity: 'low',
      importance: 5,
      visibility: 'private',
      purpose: 'private_chat',
      createdAt: '2026-08-01T00:00:00.000Z',
    };
    const store: MemoryRetrievalStore = {
      recallMemories: async (input) => {
        // 场景 → purpose 映射（10.7 权限过滤的输入）
        expect(input.purpose).toBe('private_chat');
        expect(input.ownerUserId).toBe('u1');
        return { vectorHits: [memory], ftsHits: [] };
      },
    };
    const mockLlm: LlmClient = {
      streamChat: async (messages, onToken) => {
        // 生成节点消费 contextPrompt（含检索记忆），而不是裸 userMessage
        expect(messages[1]?.content).toContain('喜欢抹茶');
        expect(messages[1]?.content).toContain('用户消息');
        onToken(
          '{"dialogue":"记得你喜欢抹茶","emotion":"warm","actionIntent":"nod","intensity":2}',
        );
        return 'ok';
      },
    };
    const graph = buildChatFlow({ llm: mockLlm, retrievalStore: store });
    const state = initialChatFlowState({
      threadId: 't8',
      userId: 'u1',
      deviceId: 'd1',
      userMessage: '今天喝什么好',
      scenario: 'private_chat',
    });
    const result = await graph.invoke(state, { threadId: 't8' });

    expect(result.retrievedMemories).toHaveLength(1);
    expect(result.retrievedMemories?.[0]?.value).toBe('喜欢抹茶');
    expect(result.retrievedMemoryIds).toEqual(['mem-1']);
    expect(result.contextPrompt).toContain('喜欢抹茶');
    expect(result.contextPrompt).toContain('preference');
    expect(result.modelOutput?.dialogue).toBe('记得你喜欢抹茶');
  });

  it('无检索 store：retrieve 跳过，contextPrompt 标注暂无记忆（框架降级）', async () => {
    const graph = buildChatFlow();
    const state = initialChatFlowState({
      threadId: 't9',
      userId: 'u1',
      deviceId: 'd1',
      userMessage: '在吗',
      scenario: 'private_chat',
    });
    const result = await graph.invoke(state, { threadId: 't9' });
    expect(result.retrievedMemories).toEqual([]);
    expect(result.retrievedMemoryIds).toEqual([]);
    expect(result.contextPrompt).toContain('暂无相关记忆');
  });

  it('输出审核：泄漏拦截 → blocked_reply（不发原始回复、不触发抽取、不发危机话术）', async () => {
    // LLM 输出含 PII → 规则版审核不通过 → 阻断路径
    const leakyLlm: LlmClient = {
      streamChat: async (_messages, onToken) => {
        onToken(
          '{"dialogue":"你的电话是 13812345678 对吧","emotion":"warm","actionIntent":"idle","intensity":1}',
        );
        return 'ok';
      },
    };
    const graph = buildChatFlow({ llm: leakyLlm });
    const state = initialChatFlowState({
      threadId: 't-mod-1',
      userId: 'u1',
      deviceId: 'd1',
      userMessage: '在吗',
      scenario: 'private_chat',
    });
    const result = await graph.invoke(state, { threadId: 't-mod-1' });

    expect(result.moderation?.passed).toBe(false);
    // 阻断：通用文案而非原始回复，且无危机话术
    expect(result.responseText).toBe('抱歉，我刚才走神了，我们换个话题聊聊吧。');
    expect(result.responseText).not.toContain('13812345678');
    expect(result.responseText).not.toContain('12356');
    expect(result.memoryExtractTriggered).toBe(false);
    expect(result.crisisLevel).toBeUndefined();
  });

  it('注入输出审核 provider：语义拦截走阻断，危机级走危机协议', async () => {
    const moderator: OutputModerator = {
      moderate: async (text, allowlisted) => {
        if (text.includes('昨天说的秘密')) {
          return { passed: false, blockedCategories: ['friend_privacy_leak'], crisisLevel: 'none' };
        }
        if (text.includes('不想活')) {
          return { passed: false, blockedCategories: [], crisisLevel: 'high' };
        }
        expect(allowlisted).toEqual([]);
        return { passed: true, blockedCategories: [], crisisLevel: 'none' };
      },
    };
    const mockLlm: LlmClient = {
      streamChat: async (_messages, onToken) => {
        onToken(
          '{"dialogue":"你昨天说的秘密我不会告诉别人","emotion":"warm","actionIntent":"idle","intensity":1}',
        );
        return 'ok';
      },
    };
    const graph = buildChatFlow({ llm: mockLlm, outputModerator: moderator });
    const state = initialChatFlowState({
      threadId: 't-mod-2',
      userId: 'u1',
      deviceId: 'd1',
      userMessage: '在吗',
      scenario: 'private_chat',
    });
    const result = await graph.invoke(state, { threadId: 't-mod-2' });
    expect(result.moderation?.passed).toBe(false);
    expect(result.responseText).toBe('抱歉，我刚才走神了，我们换个话题聊聊吧。');
    expect(result.responseText).not.toContain('昨天说的秘密');
  });

  it('L0 路由：本地模板回复，不调模型、不检索记忆、不触发抽取（10.3）', async () => {
    // 路由判定返回 L0（动画/状态/固定事件档）→ 条件边走 local_reply
    const l0Route: NodeFn<ChatFlowState> = async () => ({
      routing: { level: 'L0', reason: 'test' },
    });
    const graph = new StateGraph<ChatFlowState>()
      .addNode('auth', authNode)
      .addNode('classify_input', classifyInputNode)
      .addNode('route', l0Route)
      .addNode('retrieve_memory', retrieveMemoryNodeFactory())
      .addNode('local_reply', localReplyNode)
      .addEdge(START, 'auth')
      .addEdge('auth', 'classify_input')
      .addConditionalEdge('classify_input', (s) =>
        s.inputClassification?.crisisLevel && s.inputClassification.crisisLevel !== 'none'
          ? 'crisis_response'
          : 'route',
      )
      .addConditionalEdge('route', (s) =>
        s.routing?.level === 'L0' ? 'local_reply' : 'retrieve_memory',
      )
      .addEdge('retrieve_memory', END)
      .addEdge('local_reply', END)
      .compile();

    const state = initialChatFlowState({
      threadId: 'l0-1',
      userId: 'u1',
      deviceId: 'd1',
      userMessage: '你好',
      scenario: 'private_chat',
    });
    const result = await graph.invoke(state, { threadId: 'l0-1' });
    expect(result.responseText).toContain('你好呀');
    // 不调模型、不检索、不抽记忆（区别于 L1 路径的 generate/retrieve/approve）
    expect(result.modelOutput).toBeUndefined();
    expect(result.retrievedMemoryIds).toEqual([]);
    expect(result.memoryExtractTriggered).toBe(false);
  });

  it('V-13 分类器：LLM 判危机 → 危机协议（规则版未命中也能触发）', async () => {
    // "我真的很难受"规则版不命中（无关键词），LLM 分类判 medium → 危机分支
    const classifierLlm: LlmClient = {
      streamChat: async (_messages, onToken) => {
        onToken(
          '{"crisisLevel":"medium","categories":["self_harm"],"routeLevel":"SAFETY","confidence":0.9}',
        );
        return 'ok';
      },
    };
    const graph = buildChatFlow({ llm: classifierLlm });
    const state = initialChatFlowState({
      threadId: 'v13-1',
      userId: 'u1',
      deviceId: 'd1',
      userMessage: '我真的很难受，感觉活着没意思',
      scenario: 'private_chat',
      // 多轮上下文：连续两轮负面信号（V-13 多轮判定输入）
      recentTurns: [
        { role: 'user', content: '最近一直睡不着' },
        { role: 'assistant', content: '失眠很辛苦，要照顾好自己' },
        { role: 'user', content: '我真的很难受，感觉活着没意思' },
      ],
    });
    const result = await graph.invoke(state, { threadId: 'v13-1' });
    expect(result.crisisLevel).toBe('medium');
    expect(result.responseText).toContain('信任的人');
    expect(result.responseText).not.toContain('骨架回复');
    expect(result.memoryExtractTriggered).toBe(false);
  });

  it('V-13 分类器：routeLevel 同源消费 → 路由 L2（跳过规则版判定）', async () => {
    const classifierLlm: LlmClient = {
      streamChat: async (_messages, onToken) => {
        onToken('{"crisisLevel":"none","categories":["none"],"routeLevel":"L2","confidence":0.8}');
        return 'ok';
      },
    };
    const graph = buildChatFlow({ llm: classifierLlm });
    const state = initialChatFlowState({
      threadId: 'v13-2',
      userId: 'u1',
      deviceId: 'd1',
      userMessage: '在吗', // 规则版判 L1；LLM 分类判 L2 → 消费 L2
      scenario: 'private_chat',
    });
    const result = await graph.invoke(state, { threadId: 'v13-2' });
    expect(result.routing?.level).toBe('L2');
    expect(result.routing?.reason).toBe('v13_classifier');
  });

  it('V-13 分类器：分类器失败 → 回退规则版（对话模型不受影响）', async () => {
    const brokenClassifier: LlmClient = {
      streamChat: async () => {
        throw new Error('classifier down');
      },
    };
    // classifierLlm 失败回退规则版；llm（generate）正常
    const graph = buildChatFlow({ llm: undefined, classifierLlm: brokenClassifier });
    const normal = await graph.invoke(
      initialChatFlowState({
        threadId: 'v13-3',
        userId: 'u1',
        deviceId: 'd1',
        userMessage: '你好',
        scenario: 'private_chat',
      }),
      { threadId: 'v13-3' },
    );
    expect(normal.routing?.level).toBe('L1'); // 规则版路由
    expect(normal.routing?.reason).not.toBe('v13_classifier');

    const crisis = await graph.invoke(
      initialChatFlowState({
        threadId: 'v13-4',
        userId: 'u1',
        deviceId: 'd1',
        userMessage: '我不想活了',
        scenario: 'private_chat',
      }),
      { threadId: 'v13-4' },
    );
    expect(crisis.crisisLevel).toBe('high');
    expect(crisis.responseText).toContain('12356');
  });

  it('危机资源库：high 话术号码取自本地化资源（12356/120/110）', async () => {
    const graph = buildChatFlow();
    const result = await graph.invoke(
      initialChatFlowState({
        threadId: 'v13-5',
        userId: 'u1',
        deviceId: 'd1',
        userMessage: '我不想活了',
        scenario: 'private_chat',
      }),
      { threadId: 'v13-5' },
    );
    expect(result.responseText).toContain('12356');
    expect(result.responseText).toContain('120');
    expect(result.responseText).toContain('110');
    expect(result.responseText).toContain('不承诺替你保密');
  });
});
