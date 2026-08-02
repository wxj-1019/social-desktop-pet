/**
 * 模型输出容错解析 —— 10.2 结构化输出契约的解析层（纯函数，无副作用）。
 *
 * DeepSeek 等模型在纯 prompt 约束（无 response_format 依赖）下可能返回：
 *   - 纯 JSON 对象
 *   - ```json 代码块包裹的 JSON
 *   - 前缀杂讯 + JSON（如 "好的：{...}"）
 *   - 完全非法的文本（回退为普通回复）
 *
 * 解析策略：1) JSON.parse 整段 → 2) 正则提取首个对象字面量再 parse → 3) 回退原文。
 * 成功后逐字段兜底（不整段 schema 一刀切），保证 generateNode 总能得到合法 ModelOutput。
 */
import {
  ActionIntentSchema,
  EmotionSchema,
  ModelOutputSchema,
  type ActionIntent,
  type Emotion,
} from '@pet/protocol';

export interface ParsedModelOutput {
  dialogue: string;
  emotion: Emotion;
  actionIntent: ActionIntent;
  intensity: 1 | 2 | 3 | 4 | 5;
}

/** 10.2 契约：dialogue ≤ 600 字符 */
const MAX_DIALOGUE_LENGTH = 600;

/** 提取文本中的首个对象字面量（贪婪匹配 `{` 到最后一个 `}`；覆盖代码块/前缀杂讯） */
function extractObjectLiteral(raw: string): string | null {
  const m = /\{[\s\S]*\}/.exec(raw);
  return m ? m[0] : null;
}

/** dialogue 兜底：非 string → 回退原文；超长 → 截断 600 */
function sanitizeDialogue(value: unknown, raw: string): string {
  if (typeof value !== 'string') {
    return raw.trim().slice(0, MAX_DIALOGUE_LENGTH);
  }
  return value.slice(0, MAX_DIALOGUE_LENGTH);
}

/** emotion 兜底：不在枚举 → neutral */
function sanitizeEmotion(value: unknown): Emotion {
  const r = EmotionSchema.safeParse(value);
  return r.success ? r.data : 'neutral';
}

/** actionIntent 兜底：不在枚举 → idle */
function sanitizeActionIntent(value: unknown): ActionIntent {
  const r = ActionIntentSchema.safeParse(value);
  return r.success ? r.data : 'idle';
}

/** intensity 兜底：非 1..5 整数 → 1 */
function sanitizeIntensity(value: unknown): 1 | 2 | 3 | 4 | 5 {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5) {
    return value as 1 | 2 | 3 | 4 | 5;
  }
  return 1;
}

/** 完全非法时回退默认输出（dialogue=原文，emotion/intent/intensity 默认） */
function fallbackOutput(raw: string): ParsedModelOutput {
  return {
    dialogue: raw.trim().slice(0, MAX_DIALOGUE_LENGTH),
    emotion: 'neutral',
    actionIntent: 'idle',
    intensity: 1,
  };
}

/**
 * 容错解析模型原始输出为结构化 ParsedModelOutput。
 * 永远不抛异常：任何解析失败都回退为可用的安全默认值。
 */
export function parseModelOutput(raw: string): ParsedModelOutput {
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

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fallbackOutput(raw);
  }

  const obj = parsed as Record<string, unknown>;
  const out: ParsedModelOutput = {
    dialogue: sanitizeDialogue(obj.dialogue, raw),
    emotion: sanitizeEmotion(obj.emotion),
    actionIntent: sanitizeActionIntent(obj.actionIntent),
    intensity: sanitizeIntensity(obj.intensity),
  };
  // 兜底断言：逐字段兜底后不应再失败；万一失败回退默认输出
  const asserted = ModelOutputSchema.safeParse(out);
  if (!asserted.success) {
    return fallbackOutput(raw);
  }
  return out;
}

/**
 * 把完整回复按字符切分为流式 chunk（模拟流式节奏）。
 * 按字符而非字节切分，对中文友好；默认 size=4（全文 ≤600 字符 → ≤150 chunk）。
 */
export function chunkDialogue(text: string, size = 4): string[] {
  if (text.length === 0) return [];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}
