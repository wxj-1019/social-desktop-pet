/**
 * chat-flow 节点实现（骨架 stub）—— 对应设计稿 10.1 各步骤。
 *
 * 框架阶段：每个节点是可编译的 stub，标注 TODO 与对应设计稿章节，
 * 后续实现工作（第 7-10 周）在此填入真实逻辑（模型调用/分类器/检索等）。
 */
import type { NodeFn } from '../runtime/types.js';

import type { ChatFlowState } from './chat-flow-state.js';

/** 10.1 认证、配额、限流 */
export const authNode: NodeFn<ChatFlowState> = async (
  _state,
  _ctx,
): Promise<Partial<ChatFlowState>> => {
  // TODO(第11-14周): 校验 JWT、活动设备、配额、限流（9.4）
  // 配额检查用 @pet/config LIMITS.dailyTokenBudgetPerUser
  return { authenticated: true };
};

/** 10.1 输入安全分类（11.8 + 11.7 + 第二轮 sycophancy/永久承诺） */
export const classifyInputNode: NodeFn<ChatFlowState> = async (
  _state,
  _ctx,
): Promise<Partial<ChatFlowState>> => {
  // TODO(第7-10周): 调用免费 Moderation + 注入检测器（@pet/config MODERATION_CONFIG）
  // 第二轮：危机三级（none/low/medium/high）+ 依赖操纵/永久承诺/sycophancy 类别
  return {
    inputClassification: {
      categories: [],
      crisisLevel: 'none',
      confidence: 1,
    },
  };
};

/** 10.1 / 10.7 按场景和权限检索记忆（先权限过滤再 hybrid 检索） */
export const retrieveMemoryNode: NodeFn<ChatFlowState> = async (
  _state,
  _ctx,
): Promise<Partial<ChatFlowState>> => {
  // TODO(第7-10周): 10.7 hybrid 检索
  //   权限过滤(owner+visibility+purpose+sensitivity+时间有效性+memory_status=active)
  //   → 向量(pgvector 余弦) + 全文(tsvector/ts_rank_cd) → RRF 合并 → 综合分(相关性+时间衰减+importance)
  //   工程参数: HNSW + hnsw.iterative_scan = relaxed_order
  // 框架阶段返回空，避免误用未实现检索
  return {
    retrievedMemories: [],
    retrievedMemoryIds: [],
  };
};

/** 10.1 构造最小上下文 + 10.3 路由判定 */
export const buildContextNode: NodeFn<ChatFlowState> = async (
  _state,
  _ctx,
): Promise<Partial<ChatFlowState>> => {
  // TODO(第7-10周): 构造 system prompt（10.4 人格层级）+ 短期上下文 + 检索记忆 → 路由判定
  return {
    routing: { level: 'L1', reason: 'scaffold' },
    contextPrompt: '(scaffold context)',
  };
};

/** 10.1 服务端模型路由（L1/L2/L3，按 10.3 路由调用） */
export const generateNode: NodeFn<ChatFlowState> = async (
  state,
  ctx,
): Promise<Partial<ChatFlowState>> => {
  // TODO(第7-10周): AI Gateway 路由调用，流式 token 经 ctx.emit({type:'token',...}) 推流
  // 10.2 结构化输出契约，拒绝额外字段
  // 框架阶段：模拟模型流式输出（真实模型接入时仅替换本函数体，emit 接口不变）
  const dialogue = `（骨架回复）你刚才说：${state.userMessage.slice(0, 40)}`;
  for (const ch of dialogue) {
    ctx.emit({ type: 'token', text: ch });
    // 模拟流式节奏（真实模型按 token 到达 emit；测试依赖此节奏可注入）
    await new Promise((r) => setTimeout(r, 12));
  }
  return {
    modelOutput: {
      dialogue,
      emotion: 'neutral',
      actionIntent: 'idle',
      intensity: 1,
    },
  };
};

/** 10.1 输出审核与隐私检查（11.2 第四道：输出侧记忆泄漏校验） */
export const moderateOutputNode: NodeFn<ChatFlowState> = async (
  _state,
  _ctx,
): Promise<Partial<ChatFlowState>> => {
  // TODO(第7-10周): Moderation + 校验响应未引用 retrievedMemoryIds allowlist 外的记忆
  return {
    moderation: { passed: true, blockedCategories: [], crisisLevel: 'none' },
  };
};

/** 10.1 动作状态机审批（7.1：本地状态机有最终执行权） */
export const approveActionNode: NodeFn<ChatFlowState> = async (
  state,
  _ctx,
): Promise<Partial<ChatFlowState>> => {
  // TODO(第7-10周): 根据 PetStateMachine 当前状态/勿扰/冷却/动作白名单决定是否执行 actionIntent
  const out = state.modelOutput;
  return {
    approvedAction: out?.actionIntent ?? 'idle',
    responseText: out?.dialogue ?? '',
    memoryExtractTriggered: true, // 触发异步 memory-extract 子图
  };
};

/** 11.8 危机三级响应（脱离角色 + 固定策略 + 引导现实资源） */
export const crisisResponseNode: NodeFn<ChatFlowState> = async (
  state,
  _ctx,
): Promise<Partial<ChatFlowState>> => {
  // TODO(第7-10周): 按危机级别（low/medium/high）执行固定策略
  //   high = 固定危机协议 + 本地化资源库（V-13）
  //   不提供方法、不承诺绝对保密、不自动报警（11.8）
  const raw = state.inputClassification?.crisisLevel ?? state.moderation?.crisisLevel ?? 'low';
  const level: 'low' | 'medium' | 'high' = raw === 'none' ? 'low' : raw;
  return {
    crisisLevel: level,
    responseText: '(scaffold: crisis protocol placeholder)',
    memoryExtractTriggered: false, // 危机场景不抽取记忆
  };
};
