/**
 * 记忆结构化字段 —— 对应设计稿 10.5 / 10.6 / 10.7（含第二轮调研修订）
 *
 * 关键：embedding 按明文等价物对待（11.2 第四道隔离）；
 *      纠正 = 旧条置 invalidated + superseded_by 链接，不物理删除。
 */
import { z } from 'zod';

export const MemoryCategorySchema = z.enum([
  'preference', // 偏好
  'commitment', // 约定
  'event', // 近期/临时事件（episodic）
  'fact', // 关于用户的事实（semantic）
  'bond', // 羁绊记忆（双方共有）
]);
export type MemoryCategory = z.infer<typeof MemoryCategorySchema>;

export const MemoryVisibilitySchema = z.enum(['private', 'bond', 'public_profile']);
export type MemoryVisibility = z.infer<typeof MemoryVisibilitySchema>;

export const MemoryPurposeSchema = z.enum(['private_chat', 'friend_visit', 'proactive', 'system']);
export type MemoryPurpose = z.infer<typeof MemoryPurposeSchema>;

/** 第二轮新增：记忆来源类型。推断类只能以问句使用 */
export const MemorySourceTypeSchema = z.enum([
  'user_stated', // 用户明确陈述
  'user_confirmed', // 用户在确认卡确认
  'system_event', // 服务端确认的事件
  'inferred', // 模型推断 —— 不得当作用户事实
]);
export type MemorySourceType = z.infer<typeof MemorySourceTypeSchema>;

/** 第二轮新增：记忆状态。纠正=置失效不删除 */
export const MemoryStatusSchema = z.enum(['active', 'invalidated']);
export type MemoryStatus = z.infer<typeof MemoryStatusSchema>;

/** 第二轮新增：写入时打分 1-10，用于检索加权与主动关怀门控 */
export const ImportanceSchema = z.number().int().min(1).max(10);

/**
 * 结构化长期记忆字段（10.5）。
 * 新增加粗项为第二轮调研补全。
 */
export const MemoryRecordSchema = z
  .object({
    memoryId: z.string().uuid(),
    ownerUserId: z.string().uuid(),
    /** 羁绊记忆以 bond_id 为所有者，此时 visibility=bond */
    bondId: z.string().uuid().nullable(),
    category: MemoryCategorySchema,
    value: z.string().max(2000),
    /** 服务端校验必须属于 owner 本人发言（防 MINJA 投毒） */
    sourceTurnIds: z.array(z.string().uuid()),
    confidence: z.number().min(0).max(1),
    userConfirmed: z.boolean(),
    sensitivity: z.enum(['low', 'medium', 'high']).default('low'),
    visibility: MemoryVisibilitySchema,
    purpose: MemoryPurposeSchema,
    validFrom: z.string().datetime().nullable(),
    validTo: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    /** 新增：重要性 */
    importance: ImportanceSchema.default(5),
    /** 新增：状态 */
    memoryStatus: MemoryStatusSchema.default('active'),
    /** 新增：知识更新链 */
    supersededBy: z.string().uuid().nullable().default(null),
    /** 新增：来源类型 */
    sourceType: MemorySourceTypeSchema,
    /** 新增：命名空间 pet_id + scenario + bond_id */
    namespace: z.string(),
    /** 按明文等价物管理（静态加密） */
    embedding: z.array(z.number()).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .refine((m) => !(m.sourceType === 'inferred' && m.userConfirmed), {
    message: '10.6: 模型推断不得当作用户事实（inferred 不能 userConfirmed）',
    path: ['sourceType'],
  });
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

/** 10.6 mem0 式去重裁决动作 */
export const MemoryDedupeActionSchema = z.enum(['ADD', 'UPDATE', 'DELETE', 'NOOP']);
export type MemoryDedupeAction = z.infer<typeof MemoryDedupeActionSchema>;

/** 10.6 记忆抽取候选 */
export const MemoryCandidateSchema = z.object({
  value: z.string().max(2000),
  category: MemoryCategorySchema,
  importance: ImportanceSchema,
  sourceType: MemorySourceTypeSchema,
  sensitivity: z.enum(['low', 'medium', 'high']),
});
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;

/** 待用户确认的记忆（D-3 分级确认 HITL 中断点；服务端 memory_confirmations 表） */
export const MemoryConfirmationSchema = z.object({
  confirmationId: z.string().uuid(),
  category: MemoryCategorySchema,
  value: z.string().max(2000),
  importance: ImportanceSchema,
  sourceType: MemorySourceTypeSchema,
  sensitivity: z.enum(['low', 'medium', 'high']),
  sourceTurnIds: z.array(z.string().uuid()),
  createdAt: z.string().datetime(),
});
export type MemoryConfirmation = z.infer<typeof MemoryConfirmationSchema>;

/** 最近自动保存的记忆摘要（"已记住"提示用） */
export const SavedMemoryBriefSchema = z.object({
  memoryId: z.string().uuid(),
  value: z.string().max(2000),
  savedAt: z.string().datetime(),
});
export type SavedMemoryBrief = z.infer<typeof SavedMemoryBriefSchema>;

/** GET /memories/summary 响应：待确认列表 + 60s 内自动保存的最近条目 */
export const MemorySummarySchema = z.object({
  pending: z.array(MemoryConfirmationSchema),
  recentlySaved: z.array(SavedMemoryBriefSchema),
});
export type MemorySummary = z.infer<typeof MemorySummarySchema>;
