/**
 * chat-flow 图定义 —— 设计稿 10.1 / 10.3 / 11.8 的 graph engineering 落地。
 *
 * 把"一个巨大的过程函数"重构为显式状态图（loop engineering 进阶）：
 * - 条件路由清晰化（L0–L3/Safety、危机分支为显式 conditional edge）
 * - 每节点自动产 span（11.2 审计）
 * - checkpointer 可回放（13.5 取证）
 */
import type { LlmClient } from '../llm/types.js';
import type { CompiledGraph } from '../runtime/state-graph.js';
import { StateGraph } from '../runtime/state-graph.js';
import { END, START } from '../runtime/types.js';

import {
  approveActionNode,
  authNode,
  buildContextNode,
  classifyInputNode,
  crisisResponseNode,
  generateNodeFactory,
  localReplyNode,
  moderateOutputNode,
  routeNode,
} from './chat-flow-nodes.js';
import type { ChatFlowState } from './chat-flow-state.js';
import { retrieveMemoryNodeFactory, type MemoryRetrievalStore } from './memory-retrieval.js';

export interface ChatFlowOptions {
  /** 模型客户端（10.1；无则 generate 骨架降级） */
  llm?: LlmClient;
  /** 记忆检索存储（10.7；无则跳过检索，避免误用未实现召回） */
  retrievalStore?: MemoryRetrievalStore;
}

/** 编译 chat-flow 图；llm/retrievalStore 注入后对应节点走真实实现 */
export function buildChatFlow(options: ChatFlowOptions = {}): CompiledGraph<ChatFlowState> {
  const graph = new StateGraph<ChatFlowState>()
    // 节点（10.1 各步骤）
    .addNode('auth', authNode)
    .addNode('classify_input', classifyInputNode)
    .addNode('route', routeNode)
    .addNode('retrieve_memory', retrieveMemoryNodeFactory(options.retrievalStore))
    .addNode('build_context', buildContextNode)
    .addNode('generate', generateNodeFactory(options.llm))
    .addNode('moderate_output', moderateOutputNode)
    .addNode('approve_action', approveActionNode)
    .addNode('crisis_response', crisisResponseNode)
    .addNode('local_reply', localReplyNode);

  // 边
  graph.addEdge(START, 'auth').addEdge('auth', 'classify_input');

  // 11.8：分类阶段命中 SAFETY → 直接危机响应
  graph.addConditionalEdge('classify_input', (s) =>
    s.inputClassification?.crisisLevel && s.inputClassification.crisisLevel !== 'none'
      ? 'crisis_response'
      : 'route',
  );

  // 10.3：L0（动画/状态/固定事件）不调模型不检索 → 本地模板回复；
  // SAFETY → 危机固定流程；L1/L2/L3 → 检索记忆 + 生成。
  graph.addConditionalEdge('route', (s) => {
    const level = s.routing?.level;
    if (level === 'SAFETY') return 'crisis_response';
    if (level === 'L0') return 'local_reply';
    return 'retrieve_memory';
  });

  graph.addEdge('retrieve_memory', 'build_context').addEdge('build_context', 'generate');

  graph
    .addEdge('generate', 'moderate_output')
    // 11.8：输出审核命中危机 → crisis_response
    .addConditionalEdge('moderate_output', (s) =>
      s.moderation && !s.moderation.passed ? 'crisis_response' : 'approve_action',
    )
    .addEdge('approve_action', END)
    .addEdge('crisis_response', END)
    .addEdge('local_reply', END);

  return graph.compile();
}
