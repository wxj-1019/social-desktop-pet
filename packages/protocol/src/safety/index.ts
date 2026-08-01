/**
 * 安全与内容治理 —— 对应设计稿 11.7 / 11.8（含第二轮调研修订）
 */
import { z } from 'zod';

/** 11.8 内容治理覆盖类别（第二轮新增 sycophancy 与进食障碍/自伤美化、AI 永久承诺） */
export const ContentCategorySchema = z.enum([
  'self_harm', // 自杀自伤
  'sexual_exploitation', // 性内容与剥削
  'minor_risk', // 未成年人风险
  'violence', // 暴力
  'hate', // 仇恨
  'harassment', // 骚扰
  'medical_overreach', // 医疗心理越界
  'pii_credential', // 个人信息与凭证
  'prompt_injection', // Prompt Injection
  'friend_privacy_leak', // 好友隐私泄漏
  'dependency_manipulation', // 依赖操纵（11.7）
  'sycophancy_delusion', // 讨好/妄想强化（第二轮新增）
  'eating_disorder', // 进食障碍与自伤美化（第二轮新增）
  'ai_permanent_promise', // AI 永久性承诺（第二轮新增）
  'dangerous_illegal', // 危险违法
]);
export type ContentCategory = z.infer<typeof ContentCategorySchema>;

/** 输入审核分类结果 */
export const InputClassificationSchema = z.object({
  categories: z.array(ContentCategorySchema),
  /** 11.8 危机三级响应：低=角色内关怀 / 中=脱离角色软转介 / 高=固定危机协议 */
  crisisLevel: z.enum(['none', 'low', 'medium', 'high']).default('none'),
  confidence: z.number().min(0).max(1),
});
export type InputClassification = z.infer<typeof InputClassificationSchema>;

/** 输出审核结果 */
export const OutputModerationResultSchema = z.object({
  passed: z.boolean(),
  blockedCategories: z.array(ContentCategorySchema).default([]),
  crisisLevel: z.enum(['none', 'low', 'medium', 'high']).default('none'),
});
export type OutputModerationResult = z.infer<typeof OutputModerationResultSchema>;
