/**
 * 星屿桌宠共享协议层 —— 跨 Main / Preload / Renderer 复用的运行时契约。
 *
 * 设计约束：除 discriminatedUnion 的每个分支外，其余 object schema 一律 .strict()，
 * unknown 字段必须拒绝；不重复导出 ai / domain 子模块已导出的
 * ActionIntentSchema / EmotionSchema / ModelOutputSchema / PetStateSchema（根入口统一导出）。
 */
import { z } from 'zod';

import { ActionIntentSchema, ModelOutputSchema } from '../ai/index.js';
import { PetStateSchema } from '../domain/index.js';

/** 动作请求/决策的来源 */
export const ActionSourceSchema = z.enum(['local_interaction', 'local_chat', 'cloud_ai', 'system']);
export type ActionSource = z.infer<typeof ActionSourceSchema>;

/** 桌宠可见动作 */
export const PetMotionSchema = z.enum([
  'idle',
  'walk',
  'sit',
  'sleep',
  'happy',
  'sad',
  'surprised',
  'wave',
  'touch',
  'talk',
]);
export type PetMotion = z.infer<typeof PetMotionSchema>;

/** 桌宠表情（本地渲染可显示的子集） */
export const PetExpressionSchema = z.enum(['neutral', 'warm', 'happy', 'sad', 'surprised', 'shy']);
export type PetExpression = z.infer<typeof PetExpressionSchema>;

/** 桌宠在桌面上的水平朝向（Main 自主移动与 Renderer 帧选择共享） */
export const PetFacingSchema = z.enum(['left', 'right']);
export type PetFacing = z.infer<typeof PetFacingSchema>;

/** 可选角色 id（皮肤枚举）—— 新增角色在此扩展 */
export const PetIdSchema = z.enum(['star-isle', 'codenono']);
export type PetId = z.infer<typeof PetIdSchema>;

/** 星屿桌宠档案 */
export const PetProfileSchema = z
  .object({
    version: z.literal(1),
    petId: PetIdSchema,
    displayName: z.string().trim().min(1).max(24),
    reducedMotion: z.boolean(),
    dnd: z.boolean(),
    bubbleEnabled: z.boolean(),
  })
  .strict();
export type PetProfile = z.infer<typeof PetProfileSchema>;

/** 拖拽坐标（视口像素，限界 ±100_000） */
export const PetDragPointSchema = z
  .object({
    x: z.number().finite().min(-100_000).max(100_000),
    y: z.number().finite().min(-100_000).max(100_000),
  })
  .strict();
export type PetDragPoint = z.infer<typeof PetDragPointSchema>;

/** 桌面触摸/点击交互 */
export const PetInteractionSchema = z
  .object({
    kind: z.enum(['head_touch', 'body_touch', 'tail_touch', 'double_click', 'context_menu']),
  })
  .strict();
export type PetInteraction = z.infer<typeof PetInteractionSchema>;

/** 动作请求（由本地状态机审批） */
export const PetActionRequestSchema = z
  .object({
    intent: ActionIntentSchema,
    source: ActionSourceSchema,
    reason: z.string().max(80).optional(),
  })
  .strict();
export type PetActionRequest = z.infer<typeof PetActionRequestSchema>;

/** 动作审批结果 */
export const PetActionDecisionSchema = z
  .object({
    approved: z.boolean(),
    intent: ActionIntentSchema,
    reason: z.enum(['dnd', 'cooldown', 'not_allowed', 'offline']).optional(),
  })
  .strict();
export type PetActionDecision = z.infer<typeof PetActionDecisionSchema>;

/** 聊天事件来源 */
export const PetChatSourceSchema = z.enum(['local_chat', 'cloud_ai']);
export type PetChatSource = z.infer<typeof PetChatSourceSchema>;

/** 聊天事件（phase 判别，各分支严格拒绝多余字段） */
export const PetChatEventSchema = z.discriminatedUnion('phase', [
  z
    .object({
      phase: z.literal('start'),
      source: PetChatSourceSchema,
      text: z.string().max(2000),
    })
    .strict(),
  z
    .object({
      phase: z.literal('update'),
      source: PetChatSourceSchema,
      text: z.string().max(600),
    })
    .strict(),
  z
    .object({
      phase: z.literal('done'),
      source: PetChatSourceSchema,
      output: ModelOutputSchema,
    })
    .strict(),
  z
    .object({
      phase: z.literal('error'),
      source: PetChatSourceSchema,
      message: z.string().max(200),
    })
    .strict(),
]);
export type PetChatEvent = z.infer<typeof PetChatEventSchema>;

/** 社交事件（好友送礼等；type 判别，各分支严格拒绝多余字段） */
export const PetSocialEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('gift.snack_sent'),
      giftId: z.string(),
      snackId: z.string(),
      fromUserId: z.string(),
      fromNickname: z.string().optional(),
    })
    .strict(),
]);
export type PetSocialEvent = z.infer<typeof PetSocialEventSchema>;

/** 桌宠缩放比例（1 = 240×260 基准；范围与 Main 侧 MIN/MAX_PET_SCALE 一致） */
export const PetScaleSchema = z.number().min(0.5).max(2);
export type PetScale = z.infer<typeof PetScaleSchema>;

/** 桌宠大小调节指令（右键菜单档位 / 设置页滑块） */
export const PetSetSizeSchema = z
  .object({
    scale: PetScaleSchema,
  })
  .strict();
export type PetSetSize = z.infer<typeof PetSetSizeSchema>;

/** 面板打开指令 */
export const PanelOpenSchema = z
  .object({
    view: z.enum(['login', 'chat', 'friends']),
  })
  .strict();
export type PanelOpen = z.infer<typeof PanelOpenSchema>;

/** 布尔开关设置 */
export const BooleanSettingSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();
export type BooleanSetting = z.infer<typeof BooleanSettingSchema>;

/** 运行时快照（渲染层展示状态） */
export const PetRuntimeSnapshotSchema = z
  .object({
    state: PetStateSchema,
    online: z.boolean(),
    dnd: z.boolean(),
    hidden: z.boolean(),
  })
  .strict();
export type PetRuntimeSnapshot = z.infer<typeof PetRuntimeSnapshotSchema>;

/** 可视化指令（type 判别，各分支严格拒绝多余字段） */
export const PetVisualCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('motion'),
      motion: PetMotionSchema,
      intensity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    })
    .strict(),
  z
    .object({
      type: z.literal('expression'),
      expression: PetExpressionSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('speaking'),
      active: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('facing'),
      facing: PetFacingSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('bubble'),
      text: z.string().max(600).nullable(),
    })
    .strict(),
]);
export type PetVisualCommand = z.infer<typeof PetVisualCommandSchema>;

/** 会话登录载荷 */
export const SessionLoginPayloadSchema = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(8).max(128),
    deviceId: z.string().uuid(),
  })
  .strict();
export type SessionLoginPayload = z.infer<typeof SessionLoginPayloadSchema>;

/** 会话注册载荷（复用登录字段，extend 保留 strict） */
export const SessionRegisterPayloadSchema = SessionLoginPayloadSchema.extend({
  nickname: z.string().trim().min(1).max(40),
});
export type SessionRegisterPayload = z.infer<typeof SessionRegisterPayloadSchema>;

/** 复用 AI 层表情类型（不重复导出 EmotionSchema，根入口已导出 ai） */
export type { Emotion } from '../ai/index.js';
