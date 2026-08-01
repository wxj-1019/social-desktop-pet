/**
 * AI 输出契约与模型路由 —— 对应设计稿 10.2 / 10.3
 *
 * 10.2 模型输出契约：dialogue / emotion / actionIntent / intensity，固定枚举，
 * 拒绝额外字段；模型不得输出代码、文件路径、URL、系统命令、键鼠坐标、购买或隐私设置修改。
 */
import { z } from 'zod';

/** 10.2 emotion 固定枚举 */
export const EmotionSchema = z.enum([
  'neutral',
  'warm',
  'happy',
  'sad',
  'surprised',
  'shy',
  'apologetic',
  'concerned',
]);
export type Emotion = z.infer<typeof EmotionSchema>;

/** 10.2 actionIntent 固定枚举（由本地状态机审批后映射为 motion） */
export const ActionIntentSchema = z.enum([
  'idle',
  'wave',
  'nod',
  'shake_head',
  'touch',
  'sit',
  'sleep',
  'walk',
  'cheer',
  'comfort',
]);
export type ActionIntent = z.infer<typeof ActionIntentSchema>;

/** 10.2 结构化输出契约 */
export const ModelOutputSchema = z
  .object({
    dialogue: z.string().max(600),
    emotion: EmotionSchema,
    actionIntent: ActionIntentSchema,
    intensity: z.number().int().min(1).max(5),
  })
  .strict();
export type ModelOutput = z.infer<typeof ModelOutputSchema>;

/** 10.3 模型路由级别 */
export const RouteLevelSchema = z.enum(['L0', 'L1', 'L2', 'L3', 'SAFETY']);
export type RouteLevel = z.infer<typeof RouteLevelSchema>;

/**
 * 10.3 路由判定结果。
 * L0 = 不调模型（动画/状态/计时/好友固定事件）；
 * L1 = 低成本快速模型；L2 = 中等能力（记忆融合）；L3 = 高能力（长对话/升级）；
 * SAFETY = 专门分类器 + 固定安全流程（自伤/严重骚扰/未成年人风险）。
 */
export const RoutingDecisionSchema = z.object({
  level: RouteLevelSchema,
  reason: z.string(),
});
export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;
