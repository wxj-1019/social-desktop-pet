/**
 * 模型路由配置 —— 对应设计稿 10.3。
 *
 * 第二轮修订（12.5）：审核必须走免费 Moderation，不得与对话同档。
 * 生产只使用付费 API；供应商 Fallback 须满足同等或更严格的数据驻留/保留/DPA。
 */
import type { RouteLevel } from '@pet/protocol';

export interface ModelRouteConfig {
  /** 模型标识符（由 AI Gateway 白名单决定，不固化具体供应商版本） */
  model: string;
  /** 该路由的单次输入输出上限（token）—— 10.7 限制输出 */
  maxInputTokens: number;
  maxOutputTokens: number;
  /** 12.5 成本控制：该路由是否启用 Prompt Cache */
  promptCache: boolean;
  /** 10.5 短期上下文窗口（最近 N 条消息） */
  contextWindow: number;
  /** 10.7 每次检索的记忆条数（3-6 条） */
  memoryRetrievalTopK: number;
}

export type RouteTable = Record<RouteLevel, ModelRouteConfig>;

/**
 * 默认路由表（框架占位）。
 * 真实 model 字段在 V-2 模型供应商数据条款审查后由 AI Gateway 白名单填入。
 */
export const DEFAULT_ROUTE_TABLE: RouteTable = {
  // L0：不调模型
  L0: {
    model: 'none',
    maxInputTokens: 0,
    maxOutputTokens: 0,
    promptCache: false,
    contextWindow: 0,
    memoryRetrievalTopK: 0,
  },
  L1: {
    model: 'fast-low-cost', // 如 gpt-4.1-mini / Gemini 2.5 Flash-Lite / GLM-4-Flash
    maxInputTokens: 2048,
    maxOutputTokens: 160,
    promptCache: true,
    contextWindow: 8,
    memoryRetrievalTopK: 3,
  },
  L2: {
    model: 'medium-capability', // 如 gpt-4.1-mini / Qwen-Plus / Haiku
    maxInputTokens: 4096,
    maxOutputTokens: 240,
    promptCache: true,
    contextWindow: 12,
    memoryRetrievalTopK: 6,
  },
  L3: {
    model: 'high-capability', // 复杂长对话或结构化失败升级
    maxInputTokens: 8192,
    maxOutputTokens: 480,
    promptCache: true,
    contextWindow: 12,
    memoryRetrievalTopK: 6,
  },
  // SAFETY：专门分类器 + 固定安全流程，不调用对话模型生成内容
  SAFETY: {
    model: 'safety-classifier',
    maxInputTokens: 2048,
    maxOutputTokens: 0,
    promptCache: false,
    contextWindow: 0,
    memoryRetrievalTopK: 0,
  },
};

/** 12.5 审核：固定走免费 Moderation，不与对话同档 */
export const MODERATION_CONFIG = {
  inputModerationModel: 'openai-moderation-free',
  outputModerationModel: 'openai-moderation-free',
  // 第二轮新增：注入/越狱检测（OWASP LLM01）
  injectionDetectorModel: 'injection-classifier',
};
