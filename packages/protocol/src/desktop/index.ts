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
  'dragged',
]);
export type PetMotion = z.infer<typeof PetMotionSchema>;

/** 桌宠表情（本地渲染可显示的子集） */
export const PetExpressionSchema = z.enum(['neutral', 'warm', 'happy', 'sad', 'surprised', 'shy']);
export type PetExpression = z.infer<typeof PetExpressionSchema>;

/** 桌宠在桌面上的水平朝向（Main 自主移动与 Renderer 帧选择共享） */
export const PetFacingSchema = z.enum(['left', 'right']);
export type PetFacing = z.infer<typeof PetFacingSchema>;

/** 可选角色 id（皮肤枚举）—— 新增角色在此扩展 */
export const PetIdSchema = z.enum(['star-isle', 'codenono', 'cream-kitten']);
export type PetId = z.infer<typeof PetIdSchema>;

/** 桌宠环形菜单 UI 风格：SAO 左侧链式弧 / 经典环状 */
export const PetMenuStyleSchema = z.enum(['sao', 'classic']);
export type PetMenuStyle = z.infer<typeof PetMenuStyleSchema>;

/** 星屿桌宠档案 */
export const PetProfileSchema = z
  .object({
    version: z.literal(1),
    petId: PetIdSchema,
    displayName: z.string().trim().min(1).max(24),
    reducedMotion: z.boolean(),
    dnd: z.boolean(),
    bubbleEnabled: z.boolean(),
    /** 环形菜单 UI 风格（老档案缺省，由 store 迁移补齐） */
    menuStyle: PetMenuStyleSchema.optional(),
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

/** 环形菜单画布指令（菜单展开 → 桌宠窗临时扩到 ≥240×260 基准、右下锚定；收起还原） */
export const PetSetMenuCanvasSchema = z
  .object({
    expanded: z.boolean(),
  })
  .strict();
export type PetSetMenuCanvas = z.infer<typeof PetSetMenuCanvasSchema>;

/* ============================================================
   桌宠形象统一规范协议（docs/superpowers/specs/2026-08-20-desktop-pet-character-protocol-design.md）
   —— 角色包 manifest：唯一事实源。阶段 A（§14）。
   ============================================================ */

/** 规范画布常量（§3.1）：唯一逻辑基准，旧 280×320 已废止 */
export const CHARACTER_CANVAS = { width: 240, height: 260 } as const;
/** 规范缩放档位范围（§3.1） */
export const CHARACTER_SCALE_RANGE = { min: 0.5, max: 2.0 } as const;
/** primary 通用交互区的最小命中包围盒（§6.4，逻辑 CSS px） */
export const CHARACTER_PRIMARY_MIN_HIT = { width: 40, height: 40 } as const;

const CharacterRendererKindSchema = z.enum(['svg', 'spritesheet', 'image-sequence', 'live2d']);
const CharacterReleaseLevelSchema = z.enum(['dev-only', 'bundled', 'release']);
const CharacterCanvasAnchorSchema = z.enum(['bottom-right-ground']);

/** 画布内矩形（§5）；坐标为逻辑 CSS px，必须完整落在 240×260 内（superRefine 校验） */
const CharacterRectSchema = z
  .object({
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict();

/** 动作覆盖声明（§7.2）：native | unsupported | fallback:<核心动作> */
const MotionCoverageSchema = z
  .string()
  .regex(
    new RegExp(`^(native|unsupported|fallback:(${PetMotionSchema.options.join('|')}))$`),
    'motion coverage must be native | unsupported | fallback:<core motion>',
  );
/** 表情覆盖声明（§7.3）：回退目标只能是同类表情 */
const ExpressionCoverageSchema = z
  .string()
  .regex(
    new RegExp(`^(native|unsupported|fallback:(${PetExpressionSchema.options.join('|')}))$`),
    'expression coverage must be native | unsupported | fallback:<core expression>',
  );

/**
 * 交互区域（§6）。shape ∈ rect/circle/ellipse/polygon；
 * path 需要渲染层稳定 hit-testing，协议 v1 不开放（§6.2）。
 * priority 数值越小越先命中；id 是角色能力 ID（primary/secondary/accessory/
 * 自定义），legacy head/body/tail 作为兼容 ID 合法（§6.1）。
 */
export const CharacterInteractionZoneSchema = z.discriminatedUnion('shape', [
  z
    .object({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
      shape: z.literal('rect'),
      priority: z.number().int().nonnegative(),
      label: z.string().min(1),
      enabled: z.boolean().default(true),
      x: z.number().finite().nonnegative(),
      y: z.number().finite().nonnegative(),
      width: z.number().finite().positive(),
      height: z.number().finite().positive(),
    })
    .strict(),
  z
    .object({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
      shape: z.literal('circle'),
      priority: z.number().int().nonnegative(),
      label: z.string().min(1),
      enabled: z.boolean().default(true),
      cx: z.number().finite().nonnegative(),
      cy: z.number().finite().nonnegative(),
      r: z.number().finite().positive(),
    })
    .strict(),
  z
    .object({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
      shape: z.literal('ellipse'),
      priority: z.number().int().nonnegative(),
      label: z.string().min(1),
      enabled: z.boolean().default(true),
      cx: z.number().finite().nonnegative(),
      cy: z.number().finite().nonnegative(),
      rx: z.number().finite().positive(),
      ry: z.number().finite().positive(),
    })
    .strict(),
  z
    .object({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
      shape: z.literal('polygon'),
      priority: z.number().int().nonnegative(),
      label: z.string().min(1),
      enabled: z.boolean().default(true),
      points: z.array(z.object({ x: z.number().finite(), y: z.number().finite() }).strict()).min(3),
    })
    .strict(),
]);
export type CharacterInteractionZone = z.infer<typeof CharacterInteractionZoneSchema>;

/** 区域命中包围盒（§6.4 验收的最小面积以包围盒计） */
export function characterZoneBBox(zone: CharacterInteractionZone): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  switch (zone.shape) {
    case 'rect':
      return { x: zone.x, y: zone.y, width: zone.width, height: zone.height };
    case 'circle':
      return { x: zone.cx - zone.r, y: zone.cy - zone.r, width: zone.r * 2, height: zone.r * 2 };
    case 'ellipse':
      return {
        x: zone.cx - zone.rx,
        y: zone.cy - zone.ry,
        width: zone.rx * 2,
        height: zone.ry * 2,
      };
    case 'polygon': {
      const xs = zone.points.map((p) => p.x);
      const ys = zone.points.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      return {
        x: minX,
        y: minY,
        width: Math.max(...xs) - minX,
        height: Math.max(...ys) - minY,
      };
    }
  }
}

/** 菜单避让区域（§5.3）：仅约束菜单展开期的输入优先级/可读性，不限制平时构图 */
const MenuExclusionRegionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    reason: z.string().min(1),
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict();

/** 角色包 manifest（§4.1）——新增形象的事实入口 */
export const CharacterManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: PetIdSchema,
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'SemVer MAJOR.MINOR.PATCH'),
    displayName: z.string().min(1),
    petName: z.string().min(1),
    description: z.string().min(1),
    renderer: CharacterRendererKindSchema,
    release: CharacterReleaseLevelSchema,
    canvas: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        coordinateSpace: z.literal('logical-css-px'),
        scaleRange: z.tuple([z.number(), z.number()]),
        anchor: CharacterCanvasAnchorSchema,
      })
      .strict(),
    /** 所有可见内容的保守外包络（§5.3） */
    visualBounds: CharacterRectSchema,
    interaction: z
      .object({
        enabled: z.boolean(),
        zones: z.array(CharacterInteractionZoneSchema),
      })
      .strict(),
    menuExclusionBounds: z.array(MenuExclusionRegionSchema),
    capabilities: z
      .object({
        coreMotions: z
          .object({
            idle: MotionCoverageSchema,
            walk: MotionCoverageSchema,
            sit: MotionCoverageSchema,
            sleep: MotionCoverageSchema,
            happy: MotionCoverageSchema,
            sad: MotionCoverageSchema,
            surprised: MotionCoverageSchema,
            wave: MotionCoverageSchema,
            touch: MotionCoverageSchema,
            talk: MotionCoverageSchema,
            dragged: MotionCoverageSchema,
          })
          .strict(),
        expressions: z
          .object({
            neutral: ExpressionCoverageSchema,
            warm: ExpressionCoverageSchema,
            happy: ExpressionCoverageSchema,
            sad: ExpressionCoverageSchema,
            surprised: ExpressionCoverageSchema,
            shy: ExpressionCoverageSchema,
          })
          .strict(),
        interactionZones: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]*$/)),
        facing: z.boolean(),
        speaking: z.boolean(),
        reducedMotion: z.boolean(),
        staticFallback: z.boolean(),
      })
      .strict(),
    extensions: z
      .object({
        namespace: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
        actions: z.array(z.string()),
        effects: z.array(z.string()),
      })
      .strict(),
    assets: z
      .object({
        preview: z.string().optional(),
        files: z
          .array(
            z
              .object({
                path: z.string().min(1),
                sha256: z.string().regex(/^[0-9a-f]{64}$/),
              })
              .strict(),
          )
          .default([]),
      })
      .strict(),
    license: z
      .object({
        spdx: z.string().nullable(),
        sourceUrl: z.string().nullable(),
        commercialUse: z.boolean(),
        attributionRequired: z.boolean(),
        notes: z.string().optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((m, ctx) => {
    // §3.1 唯一画布基准
    if (m.canvas.width !== CHARACTER_CANVAS.width || m.canvas.height !== CHARACTER_CANVAS.height) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['canvas'],
        message: `canvas must be ${CHARACTER_CANVAS.width}×${CHARACTER_CANVAS.height}`,
      });
    }
    if (
      m.canvas.scaleRange[0] !== CHARACTER_SCALE_RANGE.min ||
      m.canvas.scaleRange[1] !== CHARACTER_SCALE_RANGE.max
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['canvas', 'scaleRange'],
        message: 'scaleRange must be [0.5, 2.0]',
      });
    }
    // §5.3 一切边界在画布内
    const inCanvas = (
      rect: { x: number; y: number; width: number; height: number },
      path: (string | number)[],
      label: string,
    ): void => {
      if (rect.x + rect.width > m.canvas.width || rect.y + rect.height > m.canvas.height) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `${label} exceeds canvas`,
        });
      }
    };
    inCanvas(m.visualBounds, ['visualBounds'], 'visualBounds');
    for (const [i, zone] of m.interaction.zones.entries()) {
      inCanvas(characterZoneBBox(zone), ['interaction', 'zones', i], 'interaction zone');
    }
    for (const [i, region] of m.menuExclusionBounds.entries()) {
      inCanvas(region, ['menuExclusionBounds', i], 'menu exclusion region');
    }
    // §3.2/§6.4 可交互角色必须有 primary 且 ≥40×40
    const zoneIds = m.interaction.zones.map((z) => z.id);
    if (new Set(zoneIds).size !== zoneIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['interaction', 'zones'],
        message: 'zone ids must be unique',
      });
    }
    if (m.interaction.enabled) {
      const primary = m.interaction.zones.find((z) => z.id === 'primary');
      if (!primary) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['interaction'],
          message: 'interactive character must declare a primary zone',
        });
      } else {
        const bbox = characterZoneBBox(primary);
        if (
          bbox.width < CHARACTER_PRIMARY_MIN_HIT.width ||
          bbox.height < CHARACTER_PRIMARY_MIN_HIT.height
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['interaction', 'zones'],
            message: 'primary hit bbox must be at least 40×40 css px',
          });
        }
      }
    }
    // §6.1 interactionZones ⊆ 声明区域
    for (const declared of m.capabilities.interactionZones) {
      if (!zoneIds.includes(declared)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['capabilities', 'interactionZones'],
          message: `interactionZones references undeclared zone "${declared}"`,
        });
      }
    }
    // §9.1 扩展命名空间 = 角色 id；扩展 ID 必须带命名空间前缀
    if (m.extensions.namespace !== m.id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['extensions', 'namespace'],
        message: 'extension namespace must equal character id',
      });
    }
    for (const [i, action] of m.extensions.actions.entries()) {
      if (!action.startsWith(`${m.extensions.namespace}:`)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['extensions', 'actions', i],
          message: 'extension action must be namespaced "<character-id>:<name>"',
        });
      }
    }
    for (const [i, effect] of m.extensions.effects.entries()) {
      if (!effect.startsWith(`${m.extensions.namespace}:`)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['extensions', 'effects', i],
          message: 'extension effect must be namespaced "<character-id>:<name>"',
        });
      }
    }
  });
export type CharacterManifest = z.infer<typeof CharacterManifestSchema>;

/** 面板打开指令（view 与面板 tab + 登录页一一对应） */
export const PanelOpenSchema = z
  .object({
    view: z.enum(['login', 'chat', 'friends', 'character', 'memories', 'settings', 'model']),
  })
  .strict();
export type PanelOpen = z.infer<typeof PanelOpenSchema>;

/** 本地 BYOK 模型配置（OpenAI 兼容端点；密钥仅在 Main 侧加解密存储） */
export const LocalLlmConfigSchema = z
  .object({
    enabled: z.boolean(),
    /** OpenAI 兼容基址，如 https://api.openai.com/v1 */
    baseUrl: z.string().trim().min(1).max(500),
    /** 允许为空：留空表示保留已保存的密钥（仅更新其它字段时） */
    apiKey: z.string().max(500),
    model: z.string().trim().min(1).max(200),
  })
  .strict();
export type LocalLlmConfig = z.infer<typeof LocalLlmConfigSchema>;

/** 渲染层可见的配置视图（密钥不回传，仅 hasApiKey） */
export const LocalLlmConfigViewSchema = z
  .object({
    enabled: z.boolean(),
    baseUrl: z.string(),
    model: z.string(),
    hasApiKey: z.boolean(),
  })
  .strict();
export type LocalLlmConfigView = z.infer<typeof LocalLlmConfigViewSchema>;

/** 本地 LLM 聊天请求（OpenAI messages 子集；条数/长度上限防滥用） */
export const LocalLlmChatMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().max(4000),
  })
  .strict();
export type LocalLlmChatMessage = z.infer<typeof LocalLlmChatMessageSchema>;

export const LocalLlmChatRequestSchema = z
  .object({
    messages: z.array(LocalLlmChatMessageSchema).min(1).max(30),
  })
  .strict();
export type LocalLlmChatRequest = z.infer<typeof LocalLlmChatRequestSchema>;

/** 布尔开关设置 */
export const BooleanSettingSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();
export type BooleanSetting = z.infer<typeof BooleanSettingSchema>;

/** 运行时快照（渲染层展示状态；passThrough 供菜单/设置页反射当前穿透态） */
export const PetRuntimeSnapshotSchema = z
  .object({
    state: PetStateSchema,
    online: z.boolean(),
    dnd: z.boolean(),
    hidden: z.boolean(),
    passThrough: z.boolean(),
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
