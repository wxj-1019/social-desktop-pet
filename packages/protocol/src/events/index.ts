/**
 * 权威语义事件 —— 对应设计稿 9.3 / 9.5
 *
 * 数据库提交即真相，Realtime 仅通知。
 * roomSeq 属于共享房间事件；inboxSeq 属于每个用户的独立投递。
 */
import { z } from 'zod';

/** 可靠性分级（9.5）：A 强可靠 / B 短期可靠 / C 可丢失 */
export const ReliabilityLevelSchema = z.enum(['A', 'B', 'C']);
export type ReliabilityLevel = z.infer<typeof ReliabilityLevelSchema>;

/** 9.3 事件 payload 示例：桌宠动作已应用 */
export const PetActionPayloadSchema = z
  .object({
    action: z.string(),
    animationSeed: z.number().int(),
    durationMs: z.number().int().positive(),
  })
  .strict();

/** 9.3 权威事件 */
export const SemanticEventSchema = z.object({
  v: z.literal(1),
  eventId: z.string().uuid(),
  type: z.string(), // 如 "pet.action.applied"
  roomSeq: z.number().int().nonnegative().nullable(),
  serverTimestamp: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  reliability: ReliabilityLevelSchema,
  payload: z.unknown(), // 由具体 type 的 schema 进一步校验
});
export type SemanticEvent = z.infer<typeof SemanticEventSchema>;

/** 9.3 每用户投递记录 */
export const InboxItemSchema = z.object({
  inboxSeq: z.number().int().nonnegative(),
  event: SemanticEventSchema,
});
export type InboxItem = z.infer<typeof InboxItemSchema>;
