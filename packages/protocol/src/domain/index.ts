/**
 * 领域模型 —— 对应设计稿 3.1 / 6.x / 7.4 / 9.9
 */
import { z } from 'zod';

/** 3.1 好友关系：两用户 ID 规范化排序（low/high）建立唯一约束 */
export const FriendshipSchema = z.object({
  friendshipId: z.string().uuid(),
  userLowId: z.string().uuid(),
  userHighId: z.string().uuid(),
  status: z.enum(['pending', 'active', 'paused', 'terminated', 'blocked']),
  acceptedAt: z.string().datetime().nullable(),
});
export type Friendship = z.infer<typeof FriendshipSchema>;

/** 7.4 羁绊三阶段 */
export const BondStageSchema = z.enum(['first_meet', 'familiar', 'trusted']);
export type BondStage = z.infer<typeof BondStageSchema>;

export const BondSchema = z.object({
  bondId: z.string().uuid(),
  friendshipId: z.string().uuid(),
  petAId: z.string().uuid(),
  petBId: z.string().uuid(),
  stage: BondStageSchema,
  /** 7.4 第二轮新增：有效共同事件累计计数 */
  progress: z.number().int().nonnegative(),
  status: z.enum(['active', 'dissolved']),
});
export type Bond = z.infer<typeof BondSchema>;

/** 6.5 拜访类型 */
export const VisitTypeSchema = z.enum(['wave', 'share_snack', 'leave_message']);
export type VisitType = z.infer<typeof VisitTypeSchema>;

/** 6.7 共同任务（MVP 仅一种：7 天窗口内双方各触摸一次） */
export const TaskSchema = z.object({
  taskId: z.string().uuid(),
  bondId: z.string().uuid(),
  type: z.enum(['mutual_touch_7d']),
  status: z.enum(['pending', 'a_done', 'b_done', 'completed', 'expired']),
  windowStartedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type Task = z.infer<typeof TaskSchema>;

/** 7.1 桌宠状态机 */
export const PetStateSchema = z.enum([
  'STARTING',
  'IDLE',
  'WALKING',
  'SITTING',
  'CHATTING',
  'HOSTING',
  'VISITING',
  'SLEEPING',
  'QUIET',
  'HIDDEN',
  'OFFLINE',
]);
export type PetState = z.infer<typeof PetStateSchema>;
