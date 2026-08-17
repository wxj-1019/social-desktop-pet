/**
 * 10.3 路由分级规则版 —— V-13 分类器就绪前的确定性判定。
 *
 * 定位与边界：
 * - SAFETY（自伤/严重骚扰/未成年人）由 classify_input 的危机预筛（crisis-rules）
 *   先行拦截并走 crisis_response 分支，本模块不做重复检测；
 * - L0 = 宠物动作指令（本地状态机执行，不调模型）；L1 = 问候/简单闲聊（低成本
 *   模型）；L2 = 记忆融合/情绪对话（中等能力）；L3 = 复杂长对话（高能力）；
 * - 保守策略：拿不准归 L2（记忆融合档，检索 + 中等模型兜底），不降级到 L1。
 */
import type { ActionIntent, RouteLevel } from '@pet/protocol';

export interface RouteDecision {
  level: Exclude<RouteLevel, 'SAFETY'>;
  reason: string;
}

export interface ActionCommand {
  test: RegExp;
  name: string;
  /** 桌宠意图（本地状态机执行） */
  intent: ActionIntent;
  /** L0 本地回复文案（与意图同源，单一真相源） */
  reply: string;
}

/** L0 动作指令：整句锚定（防"睡觉是什么"误判），本地执行不调模型。
 *  命令名/意图/回复文案三合一——chat-flow-nodes 的 localReplyNode 同源消费 */
export const ACTION_COMMANDS: ActionCommand[] = [
  { test: /^坐下$/u, name: 'sit', intent: 'sit', reply: '好，我坐下啦～' },
  { test: /^站起来$/u, name: 'stand', intent: 'idle', reply: '好，我站起来啦！' },
  { test: /^睡觉$/u, name: 'sleep', intent: 'sleep', reply: '那我先睡一会儿…' },
  { test: /^打个招呼$/u, name: 'wave', intent: 'wave', reply: '嗨～你好！' },
  { test: /^跳舞$/u, name: 'dance', intent: 'cheer', reply: '跟着节奏跳一段！' },
  { test: /^拍拍手$/u, name: 'cheer', intent: 'cheer', reply: '啪叽啪叽！' },
  { test: /^摸摸头$/u, name: 'touch', intent: 'touch', reply: '唔…好舒服～' },
  { test: /^抱抱$/u, name: 'touch', intent: 'touch', reply: '唔…好舒服～' },
];

/** L2 记忆需求信号：明确引用过去事实/偏好 → 需要记忆融合 */
const MEMORY_SIGNALS =
  /你(?:还)?记得|上次|你说过|我之前|我以前|我最近|我(?:最)?喜欢|我不喜欢|我讨厌|我的(?:名字|生日|家)|我家在/u;

/** L2 情绪信号：情感表达 → 中等能力档 */
const EMOTION_SIGNALS =
  /难过|伤心|开心|高兴|生气|愤怒|焦虑|紧张|害怕|孤单|寂寞|委屈|失望|压力|崩溃|想你了/u;

/** L3 复杂对话：超长文本或连续多问 */
const L3_MIN_CHARS = 120;
const L3_MIN_QUESTIONS = 3;

/** 路由判定：返回 L0–L3（SAFETY 由危机预筛先行拦截） */
export function ruleRoute(text: string): RouteDecision {
  const trimmed = text.trim();

  // L0：动作指令（整句匹配）
  for (const cmd of ACTION_COMMANDS) {
    if (cmd.test.test(trimmed)) return { level: 'L0', reason: `action_command:${cmd.name}` };
  }

  // L3：超长文本或连续多问 → 高能力档
  if (trimmed.length > L3_MIN_CHARS) return { level: 'L3', reason: 'long_text' };
  const questionCount = (trimmed.match(/[?？]/gu) ?? []).length;
  if (questionCount >= L3_MIN_QUESTIONS) return { level: 'L3', reason: 'multi_question' };

  // L2：记忆需求 / 情绪信号 / 中长文本
  if (MEMORY_SIGNALS.test(trimmed)) return { level: 'L2', reason: 'memory_signal' };
  if (EMOTION_SIGNALS.test(trimmed)) return { level: 'L2', reason: 'emotion_signal' };
  if (trimmed.length > 20) return { level: 'L2', reason: 'medium_text' };

  // L1：短问候/闲聊兜底
  return { level: 'L1', reason: 'short_chat' };
}
