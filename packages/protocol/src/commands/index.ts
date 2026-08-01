/**
 * 客户端命令 + 幂等键 —— 对应设计稿 9.4 / 9.6
 *
 * 所有可重试命令携带 user_id + device_id + client_event_id，并建立唯一约束。
 */
import { z } from 'zod';

/** 9.6 幂等键三元组 */
export const IdempotencyKeySchema = z.object({
  userId: z.string().uuid(),
  deviceId: z.string().uuid(),
  clientEventId: z.string().min(8).max(64),
});
export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;

/** 所有命令的公共信封 */
export const CommandEnvelopeSchema = IdempotencyKeySchema.extend({
  type: z.string(),
  payload: z.unknown(),
});
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;

/** 9.4 示例：发送免费点心（白名单内，仅每日配额） */
export const SendFreeSnackCommandSchema = z.object({
  toUserId: z.string().uuid(),
  snackId: z.string(), // 服务端白名单内
  note: z.string().max(200).optional(),
});
export type SendFreeSnackCommand = z.infer<typeof SendFreeSnackCommandSchema>;

/** 6.3 好友邀请 token：URL-safe Base64，≥32 随机字节，一次性，7 天失效 */
export const InviteTokenSchema = z.string().min(43).max(86);
