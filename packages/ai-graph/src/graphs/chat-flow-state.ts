/**
 * chat-flow 状态定义 —— 直接映射设计稿 10.1 / 10.3 / 11.8。
 *
 * 图结构（compile 后）：
 *   START→auth→classify_input
 *     classify_input --(SAFETY)→ crisis_response → END          # 11.8 危机分支
 *     classify_input --(normal)→ route
 *   route --(L0)→ local_reply → END                             # 10.3 不调模型不检索
 *   route --(SAFETY)→ crisis_response → END
 *   route --(L1/L2/L3)→ retrieve_memory→build_context→generate  # 10.3 路由
 *   generate→moderate_output
 *     moderate_output --(crisis)→ crisis_response → END
 *     moderate_output --(ok)→ approve_action → END
 */
import type {
  InputClassification,
  MemoryPurpose,
  ModelOutput,
  OutputModerationResult,
  RoutingDecision,
} from '@pet/protocol';

import type { RetrievedMemory } from './memory-retrieval.js';

/** chat-flow 在图中流动的状态 */
export interface ChatFlowState {
  // —— 输入 ——
  threadId: string;
  userId: string;
  deviceId: string;
  userMessage: string;
  /** 6.2/10.7 当前场景，决定记忆检索范围与权限 */
  scenario: 'private_chat' | 'friend_visit';
  bondId?: string;

  // —— 阶段产出（节点写入） ——
  authenticated: boolean;
  inputClassification?: InputClassification;
  /** 检索到的记忆（10.7：先权限过滤再 hybrid 检索） */
  retrievedMemories?: RetrievedMemory[];
  /** 10.3 路由判定 */
  routing?: RoutingDecision;
  /** 构造的最小上下文 */
  contextPrompt?: string;
  /** 10.2 模型输出 */
  modelOutput?: ModelOutput;
  /** 11.8 输出审核 */
  moderation?: OutputModerationResult;
  /** 11.2 审计：本次命中的 memory_id（输出侧校验用） */
  retrievedMemoryIds: string[];

  // —— 记忆抽取（异步子图，框架阶段标记触发） ——
  memoryExtractTriggered: boolean;

  // —— 最终 ——
  responseText?: string;
  /** 动作状态机审批结果 */
  approvedAction?: ModelOutput['actionIntent'];
  /** 命中危机分支时设置 */
  crisisLevel?: 'low' | 'medium' | 'high';
}

export const initialChatFlowState = (input: {
  threadId: string;
  userId: string;
  deviceId: string;
  userMessage: string;
  scenario: 'private_chat' | 'friend_visit';
  bondId?: string;
}): ChatFlowState => ({
  ...input,
  authenticated: false,
  retrievedMemoryIds: [],
  memoryExtractTriggered: false,
});

/** 检索目的映射（10.7 visibility + purpose 过滤） */
export function purposeForScenario(scenario: ChatFlowState['scenario']): MemoryPurpose {
  return scenario === 'friend_visit' ? 'friend_visit' : 'private_chat';
}
