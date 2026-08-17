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
import type { NodeFn } from '../runtime/types.js';
import { END, START } from '../runtime/types.js';

import {
  approveActionNode,
  authNode,
  blockedReplyNode,
  buildContextNode,
  classifyInputNodeFactory,
  crisisResponseNode,
  generateNodeFactory,
  localReplyNode,
  moderateOutputNodeFactory,
  routeNodeFactory,
  streamReplyNode,
  type OutputModerator,
} from './chat-flow-nodes.js';
import type { ChatFlowState } from './chat-flow-state.js';
import { retrieveMemoryNodeFactory, type MemoryRetrievalStore } from './memory-retrieval.js';

export interface ChatFlowOptions {
  /** 模型客户端（10.1；无则 generate 骨架降级） */
  llm?: LlmClient;
  /** V-13 输入分类器模型（12.5 精神：分类走独立低成本档；缺省复用 llm） */
  classifierLlm?: LlmClient;
  /** 记忆检索存储（10.7；无则跳过检索，避免误用未实现召回） */
  retrievalStore?: MemoryRetrievalStore;
  /** 输出审核 provider（12.5 免费 Moderation；无则规则版 PII/敏感细节拦截） */
  outputModerator?: OutputModerator;
  /** 测试替身注入（6.x 测试基建）：覆盖节点实现但**走生产条件边**——
   *  手写复制条件边的测试（接线回归测不出）全部收敛于此 */
  testOverrides?: {
    classify?: NodeFn<ChatFlowState>;
    route?: NodeFn<ChatFlowState>;
    moderate?: NodeFn<ChatFlowState>;
  };
}

// ---- 条件边（生产图与测试共用的单一实现；手写复制即回归盲区）----

/** 11.8：分类阶段命中 SAFETY → 直接危机响应 */
export function classifyCrisisEdge(s: ChatFlowState): string {
  return s.inputClassification?.crisisLevel && s.inputClassification.crisisLevel !== 'none'
    ? 'crisis_response'
    : 'route';
}

/** 10.3：L0 不调模型；SAFETY 危机固定流程；L1/L2/L3 → 检索记忆 + 生成 */
export function routeEdge(s: ChatFlowState): string {
  const level = s.routing?.level;
  if (level === 'SAFETY') return 'crisis_response';
  if (level === 'L0') return 'local_reply';
  return 'retrieve_memory';
}

/** 11.2 输出审核分支：危机 → 危机协议；泄漏/违规 → 阻断；通过 → 审批+流式 */
export function moderateEdge(s: ChatFlowState): string {
  const moderation = s.moderation;
  if (!moderation) return 'approve_action';
  if (moderation.crisisLevel !== 'none') return 'crisis_response';
  if (!moderation.passed) return 'blocked_reply';
  return 'approve_action';
}

/** 编译 chat-flow 图；llm/retrievalStore 注入后对应节点走真实实现 */
export function buildChatFlow(options: ChatFlowOptions = {}): CompiledGraph<ChatFlowState> {
  const classifierLlm = options.classifierLlm ?? options.llm;
  const graph = new StateGraph<ChatFlowState>()
    // 节点（10.1 各步骤；testOverrides 优先于生产节点）
    .addNode('auth', authNode)
    .addNode(
      'classify_input',
      options.testOverrides?.classify ?? classifyInputNodeFactory(classifierLlm),
    )
    .addNode('route', options.testOverrides?.route ?? routeNodeFactory(classifierLlm))
    .addNode('retrieve_memory', retrieveMemoryNodeFactory(options.retrievalStore))
    .addNode('build_context', buildContextNode)
    .addNode('generate', generateNodeFactory(options.llm))
    .addNode(
      'moderate_output',
      options.testOverrides?.moderate ?? moderateOutputNodeFactory(options.outputModerator),
    )
    .addNode('approve_action', approveActionNode)
    .addNode('stream_reply', streamReplyNode)
    .addNode('crisis_response', crisisResponseNode)
    .addNode('local_reply', localReplyNode)
    .addNode('blocked_reply', blockedReplyNode);

  // 边
  graph.addEdge(START, 'auth').addEdge('auth', 'classify_input');

  // 11.8：分类阶段命中 SAFETY → 直接危机响应
  graph.addConditionalEdge('classify_input', classifyCrisisEdge);

  // 10.3：L0（动画/状态/固定事件）不调模型不检索 → 本地模板回复；
  // SAFETY → 危机固定流程；L1/L2/L3 → 检索记忆 + 生成。
  graph.addConditionalEdge('route', routeEdge);

  graph.addEdge('retrieve_memory', 'build_context').addEdge('build_context', 'generate');

  // 11.2 输出审核（12.5 免费 Moderation）：
  //   输出侧危机 → crisis_response（11.8 固定协议）
  //   泄漏/违规 → blocked_reply（阻断原始回复，改发通用文案；不发危机话术）
  //   通过 → approve_action → stream_reply（先审后发：token 在审核通过后才流式）
  graph
    .addEdge('generate', 'moderate_output')
    .addConditionalEdge('moderate_output', moderateEdge)
    .addEdge('approve_action', 'stream_reply')
    .addEdge('stream_reply', END)
    .addEdge('crisis_response', END)
    .addEdge('local_reply', END)
    .addEdge('blocked_reply', END);

  return graph.compile();
}
