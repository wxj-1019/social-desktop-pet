/**
 * memory-extract 子图 —— 设计稿 10.6（mem0 式去重管道）。
 *
 * 异步触发（chat-flow 的 approve_action 后）：
 *   START→extract_candidates→injection_check→dedupe_arbitrate→tiered_confirm→persist→END
 *
 * 10.6 关键约束：
 * - 仅从 owner 本人 turn 抽取（source_turn_ids 校验）
 * - 命令性文本/Prompt Injection 不进入
 * - LLM 裁决 ADD/UPDATE/DELETE/NOOP（去重/冲突消解）
 * - 分级确认（D-3）：敏感确认卡 / 普通自动保存+撤销
 * - 落库记审计（11.2）
 */
import type { MemoryCandidate, MemoryDedupeAction } from '@pet/protocol';

import type { CompiledGraph } from '../runtime/state-graph.js';
import { StateGraph } from '../runtime/state-graph.js';
import { END, START, type NodeFn } from '../runtime/types.js';

export interface MemoryExtractState {
  threadId: string;
  ownerUserId: string;
  /** 仅供抽取的 owner 本人 turn 文本 */
  ownerTurns: string[];
  candidates?: MemoryCandidate[];
  /** 去重裁决结果 */
  dedupeActions?: Array<{
    candidate: MemoryCandidate;
    action: MemoryDedupeAction;
    targetMemoryId?: string;
  }>;
  /** 待确认（敏感类，HITL 中断点 D-3） */
  pendingConfirmation?: MemoryCandidate[];
  persistedCount: number;
}

const extractCandidatesNode: NodeFn<MemoryExtractState> = async (state) => {
  // TODO(第7-10周): LLM 从 owner turn 抽取候选（V-14 记忆机制原型）
  void state;
  return { candidates: [] };
};

const injectionCheckNode: NodeFn<MemoryExtractState> = async (state) => {
  // TODO(第7-10周): 注入/命令性文本过滤（10.6：命令性文本和 Prompt Injection 不进入长期记忆）
  void state;
  return {};
};

const dedupeArbitrateNode: NodeFn<MemoryExtractState> = async (state) => {
  // TODO(第7-10周): 检索 top-10 相似 → LLM 裁决 ADD/UPDATE/DELETE/NOOP（10.6 mem0 管道）
  void state;
  return { dedupeActions: [] };
};

const tieredConfirmNode: NodeFn<MemoryExtractState> = async (state) => {
  // TODO(第7-10周): D-3 分级确认
  //   sensitive(health/finance/relationship/identity) → 确认卡（HITL 中断）
  //   normal → 自动保存 + "已记住·撤销"提示
  void state;
  return { pendingConfirmation: [] };
};

const persistNode: NodeFn<MemoryExtractState> = async (state) => {
  // TODO(第7-10周): 落库（10.5 字段）+ 审计日志（11.2）+ source_turn_ids 校验 owner 本人
  void state;
  return { persistedCount: 0 };
};

export function buildMemoryExtractFlow(): CompiledGraph<MemoryExtractState> {
  return new StateGraph<MemoryExtractState>()
    .addNode('extract_candidates', extractCandidatesNode)
    .addNode('injection_check', injectionCheckNode)
    .addNode('dedupe_arbitrate', dedupeArbitrateNode)
    .addNode('tiered_confirm', tieredConfirmNode)
    .addNode('persist', persistNode)
    .addEdge(START, 'extract_candidates')
    .addEdge('extract_candidates', 'injection_check')
    .addEdge('injection_check', 'dedupe_arbitrate')
    .addEdge('dedupe_arbitrate', 'tiered_confirm')
    .addEdge('tiered_confirm', 'persist')
    .addEdge('persist', END)
    .compile();
}
