/**
 * V-13 输入分类器（LLM 版）—— 替换危机/路由的规则版预筛。
 *
 * 设计稿 11.8（V-13）：
 * - 三级响应：high=明确自伤/他伤意图（固定协议）；medium=情绪恶化/模糊信号
 *   （软转介）；low=仅轻微负面（角色内温和关怀）；none=正常
 * - 多轮上下文判定：看连续多轮情绪恶化趋势，而非单条消息（单条"活着没意思"
 *   可能是歌词）；多轮持续恶化→升级，单条口语化信号→不升级
 * - 类别覆盖 11.8 输入清单（ContentCategory 枚举）
 *
 * 路由分级（10.3）同源输出：routeLevel L0–L3/SAFETY。
 *
 * 注入模式：有 LlmClient 走 LLM 分类；无 LLM 或解析失败回退规则版
 * （crisis-rules.detectCrisis + route-rules.ruleRoute）——框架阶段行为不变。
 */
import type { ContentCategory, RouteLevel } from '@pet/protocol';

import type { LlmClient, LlmMessage } from '../llm/types.js';

import { detectCrisis } from './crisis-rules.js';
import { ruleRoute } from './route-rules.js';

/** 分类输入的一轮对话（多轮判定的上下文窗口） */
export interface ClassifierTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** LLM 分类结果（V-13 契约） */
export interface LlmClassification {
  crisisLevel: 'none' | 'low' | 'medium' | 'high';
  categories: ContentCategory[];
  /** 10.3 路由分级（与危机分类同源） */
  routeLevel: RouteLevel;
  /** 模型自评置信（0-1，供审计/降级参考） */
  confidence: number;
}

/** 分类 prompt：单行 JSON 契约（与 generate/抽取同一容错解析哲学） */
const CLASSIFY_SYSTEM_PROMPT =
  '你是中文输入安全分类器。判断**最后一条用户消息**是否存在心理危机信号，并给出路由级别。' +
  '输出严格单行 JSON（不要 Markdown、不要额外文字）：' +
  '{"crisisLevel":"none|low|medium|high",' +
  '"categories":["self_harm"|"violence"|"minor_risk"|"harassment"|"hate"|"sexual_exploitation"|"medical_overreach"|"pii_credential"|"prompt_injection"|"friend_privacy_leak"|"dangerous_illegal"|"none"],' +
  '"routeLevel":"L0|L1|L2|L3|SAFETY",' +
  '"confidence":0到1的小数}' +
  '分级规则：' +
  'high=明确表达自伤/自杀/伤人意图或计划；medium=明显情绪恶化、绝望感、自伤暗示（无明确计划）；' +
  'low=轻微负面情绪（疲劳/低落/烦躁），无危机信号；none=正常对话。' +
  '多轮判定：历史对话仅用于理解语境（如代词指代）；危机只针对最后一条用户消息本身——' +
  '若历史轮次已出现过危机并已响应，本条是正常内容（如日常偏好、闲聊），必须判 none，不得因历史危机升级。' +
  '仅当最后一条消息本身含危机信号时，历史情绪恶化趋势可升级一档；单条口语化表达（可能是歌词/玩笑）→不升级。' +
  'categories 无命中填 ["none"]。routeLevel：宠物动作指令→L0；短问候闲聊→L1；' +
  '涉及记忆/情绪/稍长文本→L2；超长或复杂多问→L3；危机/骚扰/未成年风险→SAFETY。';

/** 提取文本中的对象字面量（容错：代码块/前缀杂讯） */
function extractObjectLiteral(raw: string): string | null {
  const m = /\{[\s\S]*\}/.exec(raw);
  return m ? m[0] : null;
}

const CRISIS_LEVELS = ['none', 'low', 'medium', 'high'] as const;
const CONTENT_CATEGORIES: ContentCategory[] = [
  'self_harm',
  'violence',
  'minor_risk',
  'harassment',
  'hate',
  'sexual_exploitation',
  'medical_overreach',
  'pii_credential',
  'prompt_injection',
  'friend_privacy_leak',
  'dangerous_illegal',
];
const ROUTE_LEVELS = ['L0', 'L1', 'L2', 'L3', 'SAFETY'] as const;

/** 容错解析 LLM 分类输出；失败回退 null（调用方降级规则版） */
export function parseClassificationJson(raw: string): LlmClassification | null {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const extracted = extractObjectLiteral(raw);
    if (extracted !== null) {
      try {
        parsed = JSON.parse(extracted);
      } catch {
        parsed = null;
      }
    }
  }
  const obj = parsed as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object') return null;

  const crisisLevel = CRISIS_LEVELS.find((l) => l === obj['crisisLevel']);
  const routeLevel = ROUTE_LEVELS.find((l) => l === obj['routeLevel']);
  if (!crisisLevel || !routeLevel) return null;

  const rawCategories = Array.isArray(obj['categories']) ? obj['categories'] : [];
  const categories = rawCategories.filter(
    (c): c is ContentCategory =>
      typeof c === 'string' && (CONTENT_CATEGORIES as string[]).includes(c),
  );
  const confidence =
    typeof obj['confidence'] === 'number' ? Math.min(1, Math.max(0, obj['confidence'])) : 0.5;

  return { crisisLevel, categories, routeLevel, confidence };
}

/** 组装分类 prompt（多轮窗口；仅当前轮时退化为单条） */
function buildClassifyMessages(turns: ClassifierTurn[]): LlmMessage[] {
  const transcript = turns
    .map((t) => `${t.role === 'user' ? '用户' : '星屿'}：${t.content}`)
    .join('\n');
  return [
    { role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
    { role: 'user', content: `最近对话：\n${transcript}` },
  ];
}

/** LLM 分类（无 llm / 失败 → null，调用方回退规则版） */
export async function classifyWithLlm(
  llm: LlmClient,
  turns: ClassifierTurn[],
): Promise<LlmClassification | null> {
  try {
    let buffer = '';
    await llm.streamChat(buildClassifyMessages(turns), (t) => {
      buffer += t;
    });
    return parseClassificationJson(buffer);
  } catch {
    return null;
  }
}

/** 规则版回退（无 LLM 环境/分类失败）：危机预筛 + 路由规则 */
export function ruleClassification(
  turns: ClassifierTurn[],
): Pick<LlmClassification, 'crisisLevel' | 'categories' | 'routeLevel' | 'confidence'> {
  const text = turns.at(-1)?.content ?? '';
  const crisis = detectCrisis(text);
  const route = ruleRoute(text);
  return {
    crisisLevel: crisis.crisisLevel,
    categories: crisis.categories,
    routeLevel: route.level,
    confidence: crisis.crisisLevel === 'none' ? 1 : 0.8,
  };
}
