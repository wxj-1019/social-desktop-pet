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
  moderateOutputNode,
  retrieveMemoryNode,
} from './chat-flow-nodes.js';
import type { ChatFlowState } from './chat-flow-state.js';

/** 编译 chat-flow 图；llm 注入后 generateNode 走真实模型（无则骨架降级） */
export function buildChatFlow(options: { llm?: LlmClient } = {}): CompiledGraph<ChatFlowState> {
  const graph = new StateGraph<ChatFlowState>()
    // 节点（10.1 各步骤）
    .addNode('auth', authNode)
    .addNode('classify_input', classifyInputNode)
    .addNode('retrieve_memory', retrieveMemoryNode)
    .addNode('build_context', buildContextNode)
    .addNode('generate', generateNodeFactory(options.llm))
    .addNode('moderate_output', moderateOutputNode)
    .addNode('approve_action', approveActionNode)
    .addNode('crisis_response', crisisResponseNode);

  // 边
  graph.addEdge(START, 'auth').addEdge('auth', 'classify_input');

  // 11.8：分类阶段命中 SAFETY → 直接危机响应
  graph.addConditionalEdge('classify_input', (s) =>
    s.inputClassification?.crisisLevel && s.inputClassification.crisisLevel !== 'none'
      ? 'crisis_response'
      : 'retrieve_memory',
  );

  graph.addEdge('retrieve_memory', 'build_context');

  // 10.3：L0 不调模型 → END；L1/L2/L3 → generate
  graph.addConditionalEdge('build_context', (s) =>
    s.routing?.level === 'L0' || s.routing?.level === 'SAFETY' ? 'crisis_response' : 'generate',
  );

  graph
    .addEdge('generate', 'moderate_output')
    // 11.8：输出审核命中危机 → crisis_response
    .addConditionalEdge('moderate_output', (s) =>
      s.moderation && !s.moderation.passed ? 'crisis_response' : 'approve_action',
    )
    .addEdge('approve_action', END)
    .addEdge('crisis_response', END);

  return graph.compile();
}
