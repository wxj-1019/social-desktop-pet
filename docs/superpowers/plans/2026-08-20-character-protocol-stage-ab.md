# 桌宠形象统一规范协议 · 阶段 A+B 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地形象协议的"事实源"——`@pet/protocol` 中的 `CharacterManifest` zod schema + 三个现有角色（星屿/CodeNoNo/奶盖）的完整 manifest 数据与一致性校验，即设计稿 §14 的阶段 A（建立事实源）与阶段 B（适配现有角色）。

**Architecture:** manifest 类型/校验放 `@pet/protocol`（类型唯一真相源，消费 `PetId/PetMotion/PetExpression` 枚举）；每个角色的 manifest 数据（画布边界、交互区、动作覆盖矩阵、扩展命名空间、资源哈希、许可状态）放 `apps/desktop/src/pet/character-manifests.ts`，模块加载时经 schema parse；一致性（registry ↔ manifest ↔ PetId）由测试锁定。本计划**不改动**运行时行为（PetExperience/菜单/面板的消费方迁移属于阶段 C，资源预检 CLI/CI 属于阶段 D，见文末"后续计划"）。

**Tech Stack:** TypeScript strict、zod 3、Vitest（node 环境跑纯数据测试；jsdom 环境跑 registry 测试）、node:crypto 做资源哈希校验、pnpm workspaces。

**Approved spec:** `docs/superpowers/specs/2026-08-20-desktop-pet-character-protocol-design.md`（阶段划分见其 §14；角色迁移定位见 §12；manifest 字段见 §4）

---

## 执行前置检查（不产出代码，必须先做）

当前工作区遗留了环形菜单画布修复的**未提交改动**（14 个文件，属于 main 的进行中工作），且本计划的依据文档（spec）提交在 `docs/character-protocol` 分支（commit `a10532e`）。执行本计划前：

- [ ] 用 `superpowers:using-git-worktrees` 建立隔离工作区，基分支用 `docs/character-protocol`（包含 spec 文档）；或先把环形菜单改动在 main 上提交完毕，再从 `docs/character-protocol` 切出 `feat/character-protocol-stage-ab` 分支。
- [ ] 确认 `git status` 干净后再开始 Task 1。

**验证命令总表**（每个 Task 都会用到，Windows Git Bash 环境）：

```bash
npx vitest run <测试文件路径>     # 跑单个测试文件
pnpm typecheck                   # 全 workspace（含 protocol）
pnpm --filter @pet/desktop typecheck
pnpm lint && pnpm format
```

---

## File Structure

### 阶段 A：事实源（protocol schema）

- Modify: `packages/protocol/src/desktop/index.ts` —— 在 `PetSetMenuCanvasSchema` 之后追加 CharacterManifest 全套 schema 与类型（根入口已 `export * from './desktop/index.js'`，无需改 `src/index.ts`）。
- Create: `packages/protocol/src/desktop/character-manifest.test.ts` —— schema 结构/边界/superRefine 校验测试。

### 阶段 B：三个角色的 manifest 数据与一致性

- Create: `apps/desktop/src/pet/character-manifests.ts` —— 三个角色的 manifest 常量（模块加载即 parse，非法数据直接抛错）+ `getCharacterManifest()`。
- Create: `apps/desktop/src/pet/character-manifests.test.ts` —— node 环境：schema 通过、fallback 链终止、资源文件存在且 sha256 匹配、几何不变量。
- Modify: `apps/desktop/src/pet/character-registry.test.ts` —— 追加 registry ↔ manifest ↔ PetId 一致性 describe。
- Modify: `docs/superpowers/specs/2026-08-20-desktop-pet-character-protocol-design.md` —— 状态从"待审阅"改为"已批准"。
- Modify: `AGENTS.md` —— 功能落点速查表加一行"新增/适配桌宠形象"指向本协议。

### 数据来源备忘（写 manifest 时不要重新发明数值）

| 项                | 星屿 star-isle                                                                                                                  | CodeNoNo codenono                                             | 奶盖 cream-kitten                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| renderer          | `svg`                                                                                                                           | `spritesheet`                                                 | `image-sequence`                                                                     |
| release（§12）    | `bundled`（core-reference）                                                                                                     | `dev-only`（许可未确认）                                      | `dev-only`（来源未归档）                                                             |
| visualBounds 依据 | viewBox 320×380 经 `xMidYMid meet` 映射到 240×260（scale=260/380≈0.684，x 偏移≈10.5），取含光晕/头顶/弹跳幅度(±8px)的保守外包络 | 视口 172.8×187.2 水平居中（x 偏移 33.6）、底部贴边            | `.image-pet__img` max-width 90%/max-height 80% 居中 + padding-bottom 4% 的保守外包络 |
| 命中区来源        | SVG 透明 hit rect（star-isle-visual.tsx:129/145/324）映射后取整                                                                 | 整个 spritesheet 视口 = `data-hit="body"`                     | 整个 image-pet 容器 = `data-hit="body"`                                              |
| 动作覆盖来源      | CSS 动画全覆盖                                                                                                                  | spritesheet-manifest.ts `CODENONO_MOTION_MAP` 全 11 项有帧表  | image-visual.tsx `resolveCreamKittenAnimation` 全 11 项有帧                          |
| 许可来源          | 项目内原创                                                                                                                      | `assets/codenono/NOTICE.md`：上游无 LICENSE，README"推荐 MIT" | 无任何来源记录（要在 notes 里如实声明）                                              |

已知数据事实（如实写入，不做美化）：`cream-kitten` 的 `blink.png` 与 `idle.png` sha256 完全相同（当前眨眼帧是 idle 的拷贝，视觉差异靠 CSS）；`assets/cream-kitten/idle_gs.jpg` 未被 `image-frame-manifest.ts` 引用，**不**列入 manifest 资产清单（阶段 D 预检跟踪清理）。

---

### Task 1: CharacterManifest schema（protocol）

**Files:**

- Modify: `packages/protocol/src/desktop/index.ts`（在 `PetSetMenuCanvasSchema` 定义块之后追加）
- Test: `packages/protocol/src/desktop/character-manifest.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/protocol/src/desktop/character-manifest.test.ts`：

```ts
import { describe, expect, it } from 'vitest';

import { CharacterInteractionZoneSchema, CharacterManifestSchema, PetIdSchema } from './index.js';

/** 规范画布（§3.1）：240×260，缩放 0.5–2.0 */
const CANVAS = {
  width: 240,
  height: 260,
  coordinateSpace: 'logical-css-px',
  scaleRange: [0.5, 2.0],
  anchor: 'bottom-right-ground',
} as const;

const PRIMARY_ZONE = {
  id: 'primary',
  shape: 'rect',
  x: 48,
  y: 92,
  width: 126,
  height: 120,
  priority: 0,
  label: '与示例角色互动',
};

/** 合法最小 manifest（§4.1 示例的字段全集），各失败用例在其上做单点变异 */
function buildValidManifest() {
  return {
    schemaVersion: 1,
    id: 'star-isle',
    version: '1.0.0',
    displayName: '示例角色',
    petName: '示例',
    description: '一句话介绍。',
    renderer: 'svg',
    release: 'dev-only',
    canvas: CANVAS,
    visualBounds: { x: 24, y: 34, width: 166, height: 190 },
    interaction: { enabled: true, zones: [PRIMARY_ZONE] },
    menuExclusionBounds: [
      { id: 'radial-menu-left', reason: 'menu-overlay', x: 0, y: 0, width: 128, height: 260 },
    ],
    capabilities: {
      coreMotions: {
        idle: 'native',
        walk: 'native',
        sit: 'fallback:idle',
        sleep: 'native',
        happy: 'native',
        sad: 'native',
        surprised: 'fallback:happy',
        wave: 'fallback:happy',
        touch: 'native',
        talk: 'native',
        dragged: 'fallback:touch',
      },
      expressions: {
        neutral: 'native',
        warm: 'native',
        happy: 'native',
        sad: 'native',
        surprised: 'fallback:neutral',
        shy: 'fallback:warm',
      },
      interactionZones: ['primary'],
      facing: true,
      speaking: true,
      reducedMotion: true,
      staticFallback: true,
    },
    extensions: { namespace: 'star-isle', actions: [], effects: [] },
    assets: {
      files: [{ path: 'assets/codenono/spritesheet.webp', sha256: '0'.repeat(64) }],
    },
    license: {
      spdx: null,
      sourceUrl: null,
      commercialUse: false,
      attributionRequired: false,
    },
  };
}

describe('CharacterManifestSchema（形象协议 §4）', () => {
  it('合法 manifest 通过并保留字段', () => {
    const parsed = CharacterManifestSchema.parse(buildValidManifest());
    expect(parsed.id).toBe('star-isle');
    expect(parsed.capabilities.coreMotions.sit).toBe('fallback:idle');
  });

  it('canvas 必须是 240×260 / 0.5–2.0 / bottom-right-ground（§3.1）', () => {
    for (const bad of [
      { ...CANVAS, width: 280, height: 320 },
      { ...CANVAS, scaleRange: [0.4, 2.0] },
      { ...CANVAS, anchor: 'top-left' },
    ]) {
      const m = buildValidManifest();
      (m.canvas as unknown) = bad;
      expect(CharacterManifestSchema.safeParse(m).success).toBe(false);
    }
  });

  it('visualBounds / 命中区 / 菜单避让区必须落在画布内（§5.3）', () => {
    const outOfCanvas = buildValidManifest();
    outOfCanvas.visualBounds = { x: 24, y: 34, width: 220, height: 190 }; // 24+220 > 240
    expect(CharacterManifestSchema.safeParse(outOfCanvas).success).toBe(false);

    const zoneOut = buildValidManifest();
    zoneOut.interaction = {
      enabled: true,
      zones: [{ ...PRIMARY_ZONE, x: 200, width: 80 }], // 200+80 > 240
    };
    expect(CharacterManifestSchema.safeParse(zoneOut).success).toBe(false);

    const menuOut = buildValidManifest();
    menuOut.menuExclusionBounds = [
      { id: 'm', reason: 'menu-overlay', x: 0, y: 0, width: 241, height: 260 },
    ];
    expect(CharacterManifestSchema.safeParse(menuOut).success).toBe(false);
  });

  it('可交互角色必须有 primary 区且包围盒 ≥40×40（§3.2/§6.4）', () => {
    const noPrimary = buildValidManifest();
    noPrimary.interaction = {
      enabled: true,
      zones: [{ ...PRIMARY_ZONE, id: 'secondary' }],
    };
    expect(CharacterManifestSchema.safeParse(noPrimary).success).toBe(false);

    const tiny = buildValidManifest();
    tiny.interaction = { enabled: true, zones: [{ ...PRIMARY_ZONE, width: 30, height: 30 }] };
    expect(CharacterManifestSchema.safeParse(tiny).success).toBe(false);

    const disabled = buildValidManifest();
    disabled.interaction = { enabled: false, zones: [] };
    disabled.capabilities.interactionZones = [];
    expect(CharacterManifestSchema.safeParse(disabled).success).toBe(true);
  });

  it('动作/表情覆盖只允许 native | fallback:<同类枚举> | unsupported（§7.2/§7.3）', () => {
    const badMotion = buildValidManifest();
    badMotion.capabilities.coreMotions.sit = 'fallback:happy-frame'; // 非核心动作目标
    expect(CharacterManifestSchema.safeParse(badMotion).success).toBe(false);

    const badExpr = buildValidManifest();
    badExpr.capabilities.expressions.shy = 'fallback:idle'; // 表情不能回退到动作
    expect(CharacterManifestSchema.safeParse(badExpr).success).toBe(false);
  });

  it('扩展命名空间必须等于角色 id，扩展 ID 必须带命名空间前缀（§9.1）', () => {
    const wrongNs = buildValidManifest();
    wrongNs.extensions = { namespace: 'other-pet', actions: [], effects: [] };
    expect(CharacterManifestSchema.safeParse(wrongNs).success).toBe(false);

    const unprefixed = buildValidManifest();
    unprefixed.extensions = { namespace: 'star-isle', actions: ['spin'], effects: [] };
    expect(CharacterManifestSchema.safeParse(unprefixed).success).toBe(false);
  });

  it('interactionZones 必须与声明区域一致且 id 唯一（§6.1）', () => {
    const dup = buildValidManifest();
    dup.interaction = {
      enabled: true,
      zones: [PRIMARY_ZONE, { ...PRIMARY_ZONE, priority: 1 }],
    };
    expect(CharacterManifestSchema.safeParse(dup).success).toBe(false);

    const ghost = buildValidManifest();
    ghost.capabilities.interactionZones = ['primary', 'ghost'];
    expect(CharacterManifestSchema.safeParse(ghost).success).toBe(false);
  });

  it('release 级别、renderer 类型、SemVer、哈希格式受限（§4.2/§10.2）', () => {
    const badRelease = buildValidManifest();
    (badRelease as { release: string }).release = 'ga';
    expect(CharacterManifestSchema.safeParse(badRelease).success).toBe(false);

    const badRenderer = buildValidManifest();
    (badRenderer as { renderer: string }).renderer = 'gif';
    expect(CharacterManifestSchema.safeParse(badRenderer).success).toBe(false);

    const badVersion = buildValidManifest();
    badVersion.version = '1.0';
    expect(CharacterManifestSchema.safeParse(badVersion).success).toBe(false);

    const badHash = buildValidManifest();
    badHash.assets.files = [{ path: 'a.png', sha256: 'xyz' }];
    expect(CharacterManifestSchema.safeParse(badHash).success).toBe(false);
  });
});

describe('CharacterInteractionZoneSchema（形象协议 §6.2）', () => {
  it('支持 rect/circle/ellipse/polygon；path 暂不开放（需渲染层 hit-testing）', () => {
    expect(
      CharacterInteractionZoneSchema.safeParse({
        id: 'a',
        shape: 'circle',
        cx: 100,
        cy: 100,
        r: 30,
        priority: 0,
        label: '圆',
      }).success,
    ).toBe(true);
    expect(
      CharacterInteractionZoneSchema.safeParse({
        id: 'a',
        shape: 'ellipse',
        cx: 100,
        cy: 100,
        rx: 40,
        ry: 20,
        priority: 0,
        label: '椭圆',
      }).success,
    ).toBe(true);
    expect(
      CharacterInteractionZoneSchema.safeParse({
        id: 'a',
        shape: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 5, y: 8 },
        ],
        priority: 0,
        label: '三角',
      }).success,
    ).toBe(true);
    expect(
      CharacterInteractionZoneSchema.safeParse({
        id: 'a',
        shape: 'path',
        d: 'M0 0 L10 10',
        priority: 0,
        label: '路径',
      }).success,
    ).toBe(false);
  });

  it('id 只允许小写字母数字与连字符（兼容 legacy head/body/tail）', () => {
    const base = { shape: 'rect', x: 0, y: 0, width: 50, height: 50, priority: 0, label: 'x' };
    expect(CharacterInteractionZoneSchema.safeParse({ ...base, id: 'body' }).success).toBe(true);
    expect(CharacterInteractionZoneSchema.safeParse({ ...base, id: 'Zone A' }).success).toBe(false);
  });

  it('PetIdSchema 仍是 manifest id 的校验来源', () => {
    expect(PetIdSchema.options).toContain('cream-kitten');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run packages/protocol/src/desktop/character-manifest.test.ts
```

预期：FAIL，报 `CharacterManifestSchema` / `CharacterInteractionZoneSchema` 不存在（import 报错）。

- [ ] **Step 3: 实现 schema**

在 `packages/protocol/src/desktop/index.ts` 的 `PetSetMenuCanvasSchema` 定义块之后追加：

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run packages/protocol/src/desktop/character-manifest.test.ts
```

预期：PASS（全部用例）。若 `disabled.interaction = { enabled: false, zones: [] }` 用例因 `capabilities.interactionZones: []` 报错，确认是其他 superRefine 顺序问题——该用例必须通过，不允许改测试迁就实现。

- [ ] **Step 5: 全量回归 + 提交**

```bash
npx vitest run packages/protocol
pnpm typecheck
pnpm lint && pnpm format
git add packages/protocol/src/desktop/index.ts packages/protocol/src/desktop/character-manifest.test.ts
git commit -m "feat(protocol): CharacterManifest schema（形象协议阶段 A）"
```

预期：protocol 全部测试通过、typecheck/lint/format 干净。

---

### Task 2: 三个角色的 manifest 数据（阶段 B）

**Files:**

- Create: `apps/desktop/src/pet/character-manifests.ts`
- Test: `apps/desktop/src/pet/character-manifests.test.ts`

几何数值来自上文"数据来源备忘"（由 star-isle-visual.tsx / spritesheet-visual.tsx / image-visual CSS 换算，勿凭感觉改）。

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/pet/character-manifests.test.ts`（node 环境即可——本模块不 import 任何 React/图片）：

```ts
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PetIdSchema, type PetId } from '@pet/protocol';
import { describe, expect, it } from 'vitest';

import { CHARACTER_MANIFESTS, getCharacterManifest } from './character-manifests.js';

const ALL_MOTIONS = [
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
] as const;
const ALL_EXPRESSIONS = ['neutral', 'warm', 'happy', 'sad', 'surprised', 'shy'] as const;

/** assets.path 相对 apps/desktop/src 解析（character-manifests.ts 位于 src/pet/） */
function resolveAsset(p: string): string {
  return join(__dirname, '..', p);
}

describe('CHARACTER_MANIFESTS（形象协议阶段 B）', () => {
  it('覆盖全部 PetId，键与 manifest.id 一致', () => {
    expect([...Object.keys(CHARACTER_MANIFESTS)].sort()).toEqual([...PetIdSchema.options].sort());
    for (const [id, manifest] of Object.entries(CHARACTER_MANIFESTS)) {
      expect(manifest.id).toBe(id as PetId);
    }
  });

  it('星屿是 core-reference：bundled 级 + 三命中区（§12.1）', () => {
    const m = CHARACTER_MANIFESTS['star-isle']!;
    expect(m.release).toBe('bundled');
    expect(m.renderer).toBe('svg');
    expect(m.capabilities.interactionZones).toEqual(['primary', 'head', 'tail']);
    // 全部核心动作/表情 native（SVG CSS 全覆盖）
    for (const motion of ALL_MOTIONS) expect(m.capabilities.coreMotions[motion]).toBe('native');
    for (const expr of ALL_EXPRESSIONS) expect(m.capabilities.expressions[expr]).toBe('native');
  });

  it('CodeNoNo：dev-only（许可未确认）+ 单 primary 区（§12.2）', () => {
    const m = CHARACTER_MANIFESTS['codenono']!;
    expect(m.release).toBe('dev-only');
    expect(m.license.commercialUse).toBe(false);
    expect(m.license.sourceUrl).toBe('https://github.com/Dqd02/CodeX_Pet_NoNo');
    expect(m.capabilities.interactionZones).toEqual(['primary']);
    // 全部 11 动作 native（spritesheet 帧表全覆盖，含语义映射 touch→waving 行）
    for (const motion of ALL_MOTIONS) expect(m.capabilities.coreMotions[motion]).toBe('native');
  });

  it('奶盖：dev-only（来源未归档）+ 私有行为进扩展命名空间（§12.3）', () => {
    const m = CHARACTER_MANIFESTS['cream-kitten']!;
    expect(m.release).toBe('dev-only');
    expect(m.license.sourceUrl).toBeNull();
    expect(m.capabilities.interactionZones).toEqual(['primary']);
    expect(m.extensions.namespace).toBe('cream-kitten');
    for (const action of m.extensions.actions) {
      expect(action.startsWith('cream-kitten:')).toBe(true);
    }
    // 已知事实如实声明：blink 与 idle 是同一张图（sha256 相同）
    const blink = m.assets.files.find((f) => f.path.endsWith('blink.png'));
    const idle = m.assets.files.find((f) => f.path.endsWith('idle.png'));
    expect(blink && idle && blink.sha256 === idle.sha256).toBe(true);
  });

  it('fallback 链全部终止于 native/unsupported，无环（§7.2）', () => {
    for (const manifest of Object.values(CHARACTER_MANIFESTS)) {
      const followChain = (
        table: Record<string, string>,
        start: string,
        kind: 'motion' | 'expression',
      ): void => {
        const seen = new Set<string>([start]);
        let current = table[start]!;
        while (current.startsWith('fallback:')) {
          const target = current.slice('fallback:'.length);
          expect(seen.has(target), `${manifest.id} ${kind} fallback cycle at ${target}`).toBe(
            false,
          );
          seen.add(target);
          current = table[target]!;
        }
        expect(['native', 'unsupported']).toContain(current);
      };
      for (const motion of ALL_MOTIONS) {
        followChain(manifest.capabilities.coreMotions, motion, 'motion');
      }
      for (const expr of ALL_EXPRESSIONS) {
        followChain(manifest.capabilities.expressions, expr, 'expression');
      }
    }
  });

  it('资产文件存在且 sha256 与磁盘一致（§10.2 完整性）', () => {
    for (const manifest of Object.values(CHARACTER_MANIFESTS)) {
      for (const file of manifest.assets.files) {
        const abs = resolveAsset(file.path);
        expect(existsSync(abs), `${file.path} missing`).toBe(true);
        const hash = createHash('sha256').update(readFileSync(abs)).digest('hex');
        expect(hash, `${file.path} sha256 mismatch`).toBe(file.sha256);
      }
    }
  });

  it('getCharacterManifest 未知 id 回退星屿（与 registry 语义一致）', () => {
    expect(getCharacterManifest('not-a-pet').id).toBe('star-isle');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run apps/desktop/src/pet/character-manifests.test.ts
```

预期：FAIL，`./character-manifests.js` 模块不存在。

- [ ] **Step 3: 实现 manifest 数据**

创建 `apps/desktop/src/pet/character-manifests.ts`：

```ts
/**
 * 角色包 manifest 数据 —— 形象统一规范协议（阶段 B）。
 *
 * 协议文档：docs/superpowers/specs/2026-08-20-desktop-pet-character-protocol-design.md
 * - 几何全部是 240×260 逻辑画布坐标（§3.1/§5），换算依据见各条目注释
 * - 模块加载即 CharacterManifestSchema.parse：数据非法直接抛错（fail fast），
 *   不允许"带病注册"
 * - release 级别遵循 §12 迁移策略：星屿 bundled（core-reference），
 *   CodeNoNo/奶盖 dev-only（许可/来源未归档，禁止 release）
 * - 运行时消费方（PetExperience 命中区、面板缩略图等）迁移属于阶段 C，本模块只提供事实源
 */
import { CharacterManifestSchema, type CharacterManifest } from '@pet/protocol';

/** 画布/缩放/避让区三个角色共用（菜单与角色无关，§5.3） */
const CANVAS = {
  width: 240,
  height: 260,
  coordinateSpace: 'logical-css-px',
  scaleRange: [0.5, 2.0],
  anchor: 'bottom-right-ground',
} as const;

const MENU_EXCLUSION = [
  {
    id: 'radial-menu-left',
    reason: 'menu-overlay',
    x: 0,
    y: 0,
    width: 128,
    height: 260,
  },
];

/** 全 native 覆盖表（星屿：SVG + CSS 全覆盖） */
const ALL_NATIVE_MOTIONS = {
  idle: 'native',
  walk: 'native',
  sit: 'native',
  sleep: 'native',
  happy: 'native',
  sad: 'native',
  surprised: 'native',
  wave: 'native',
  touch: 'native',
  talk: 'native',
  dragged: 'native',
} as const;

const ALL_NATIVE_EXPRESSIONS = {
  neutral: 'native',
  warm: 'native',
  happy: 'native',
  sad: 'native',
  surprised: 'native',
  shy: 'native',
} as const;

const starIsleManifest = CharacterManifestSchema.parse({
  schemaVersion: 1,
  id: 'star-isle',
  version: '0.1.0',
  displayName: '星屿',
  petName: '星屿',
  description: '原创 SVG 星尾狐猫，蓝紫大耳，温暖陪伴。',
  renderer: 'svg',
  release: 'bundled',
  canvas: CANVAS,
  // viewBox 320×380 → 240×260（meet：scale=260/380≈0.684，x 偏移≈10.5）；
  // 含光晕(r132)/头顶皇冠/±8px 弹跳幅度的保守外包络
  visualBounds: { x: 14, y: 32, width: 208, height: 204 },
  // 命中区来自 star-isle-visual.tsx 透明 hit rect 映射后取整：
  // body(86,194,108,97)→(69,132,74,67)；head(72,96,136,124)→(60,66,93,85)；
  // tail(22,100,64,160)→(26,68,44,110)。head/tail 为 legacy 兼容 ID（§6.1）
  interaction: {
    enabled: true,
    zones: [
      {
        id: 'primary',
        shape: 'rect',
        x: 69,
        y: 132,
        width: 74,
        height: 67,
        priority: 0,
        label: '抚摸星屿',
      },
      {
        id: 'head',
        shape: 'rect',
        x: 60,
        y: 66,
        width: 93,
        height: 85,
        priority: 1,
        label: '摸摸头',
      },
      {
        id: 'tail',
        shape: 'rect',
        x: 26,
        y: 68,
        width: 44,
        height: 110,
        priority: 2,
        label: '玩尾巴',
      },
    ],
  },
  menuExclusionBounds: MENU_EXCLUSION,
  capabilities: {
    coreMotions: ALL_NATIVE_MOTIONS,
    expressions: ALL_NATIVE_EXPRESSIONS,
    interactionZones: ['primary', 'head', 'tail'],
    facing: true,
    speaking: true,
    reducedMotion: true,
    staticFallback: true,
  },
  extensions: { namespace: 'star-isle', actions: [], effects: [] },
  assets: { files: [] }, // 主体是 TSX 内联 SVG，无外部资源文件
  license: {
    spdx: null,
    sourceUrl: 'repo:apps/desktop/src/pet/star-isle-visual.tsx',
    commercialUse: true,
    attributionRequired: false,
    notes: '本项目原创角色，随仓库分发。',
  },
});

const codenonoManifest = CharacterManifestSchema.parse({
  schemaVersion: 1,
  id: 'codenono',
  version: '0.1.0',
  displayName: 'CodeNoNo',
  petName: 'CodeNoNo',
  description: 'spritesheet 帧动画角色，编程伙伴气质。',
  renderer: 'spritesheet',
  release: 'dev-only',
  canvas: CANVAS,
  // spritesheet 视口 172.8×187.2（FRAME_SCALE 0.9）水平居中 + 底部贴边
  visualBounds: { x: 34, y: 73, width: 173, height: 187 },
  // 整个视口即 data-hit="body"（spritesheet-visual.tsx:102）→ primary
  interaction: {
    enabled: true,
    zones: [
      {
        id: 'primary',
        shape: 'rect',
        x: 34,
        y: 73,
        width: 173,
        height: 187,
        priority: 0,
        label: '与 CodeNoNo 互动',
      },
    ],
  },
  menuExclusionBounds: MENU_EXCLUSION,
  capabilities: {
    // 11 动作全有帧表（CODENONO_MOTION_MAP），语义映射（touch→waving 行等）
    // 已在 spritesheet-manifest.ts 显式声明，此处记 native
    coreMotions: ALL_NATIVE_MOTIONS,
    expressions: {
      neutral: 'native', // idle 行
      warm: 'fallback:neutral',
      happy: 'native',
      sad: 'native',
      surprised: 'native',
      shy: 'native',
    },
    interactionZones: ['primary'],
    facing: true,
    speaking: true,
    reducedMotion: true,
    staticFallback: true,
  },
  extensions: { namespace: 'codenono', actions: [], effects: [] },
  assets: {
    files: [
      {
        path: 'assets/codenono/spritesheet.webp',
        sha256: '82697165ed23a82021cdf0872da0de5aa72b80d2eea202d10adf34e708a0e4d5',
      },
    ],
  },
  license: {
    spdx: null,
    sourceUrl: 'https://github.com/Dqd02/CodeX_Pet_NoNo',
    commercialUse: false,
    attributionRequired: true,
    notes:
      '上游仓库未附 LICENSE（README 推荐 MIT）；详见 assets/codenono/NOTICE.md。许可书面确认前仅 dev-only（协议 §10.1/§12.2）。',
  },
});

const creamKittenManifest = CharacterManifestSchema.parse({
  schemaVersion: 1,
  id: 'cream-kitten',
  version: '0.1.0',
  displayName: '奶盖',
  petName: '奶盖',
  description: '伪3D 卡通奶油小猫，立体光影，慵懒陪伴。',
  renderer: 'image-sequence',
  release: 'dev-only',
  canvas: CANVAS,
  // .image-pet__img max-width 90%/max-height 80% 居中 + padding-bottom 4% 的保守外包络
  visualBounds: { x: 12, y: 22, width: 216, height: 214 },
  // 整个 image-pet 容器即 data-hit="body"（image-visual.tsx:218）→ primary
  interaction: {
    enabled: true,
    zones: [
      {
        id: 'primary',
        shape: 'rect',
        x: 12,
        y: 22,
        width: 216,
        height: 214,
        priority: 0,
        label: '与奶盖互动',
      },
    ],
  },
  menuExclusionBounds: MENU_EXCLUSION,
  capabilities: {
    // 覆盖矩阵按 resolveCreamKittenAnimation 实况：
    // wave 复用 happy 帧、talk=idle 帧+speaking → 按实况声明（§7.2 禁止静默映射）
    coreMotions: {
      idle: 'native',
      walk: 'native',
      sit: 'native',
      sleep: 'native',
      happy: 'native',
      sad: 'native',
      surprised: 'native', // dragged 帧承演
      wave: 'fallback:happy',
      touch: 'native', // hungry 帧
      talk: 'native', // idle 帧 + speaking
      dragged: 'native',
    },
    expressions: {
      neutral: 'native',
      warm: 'fallback:neutral',
      happy: 'native',
      sad: 'native',
      surprised: 'native', // dragged 帧
      shy: 'fallback:happy',
    },
    interactionZones: ['primary'],
    facing: true,
    speaking: true,
    reducedMotion: true,
    staticFallback: true,
  },
  // §12.3：私有行为（眨眼/歪头/生气/自动睡眠/随机走）进扩展命名空间，
  // 不加入共享 PetMotion/PetExpression 枚举
  extensions: {
    namespace: 'cream-kitten',
    actions: [
      'cream-kitten:blink',
      'cream-kitten:tilt',
      'cream-kitten:angry',
      'cream-kitten:auto-sleep',
      'cream-kitten:auto-walk',
    ],
    effects: [],
  },
  assets: {
    files: [
      {
        path: 'assets/cream-kitten/blink.png',
        sha256: 'a52dd065fbd3823f231348bbdcf4f1210c9113e5ed052f4ea668e413abcb1e0f',
      },
      {
        path: 'assets/cream-kitten/dragged.png',
        sha256: '9696d4ccfd5c38341d542797d88fdebe939fd7ef50a43bbc210ef973ac5632d0',
      },
      {
        path: 'assets/cream-kitten/happy.png',
        sha256: '7bce85aad97c845ed1b15d09b75d54e22e5c3c242ddd2fa1981900b9bf9052c4',
      },
      {
        path: 'assets/cream-kitten/hungry.png',
        sha256: 'ab3b8fbbcaa39556b3fb5a70d421957a878bfd1299e9af95203208fe197367d9',
      },
      {
        path: 'assets/cream-kitten/idle.png',
        sha256: 'a52dd065fbd3823f231348bbdcf4f1210c9113e5ed052f4ea668e413abcb1e0f',
      },
      {
        path: 'assets/cream-kitten/sad.png',
        sha256: '10cfee2d870ec43abd2512b599d1f06a302836d11dcb4ae26ae02cf8324aa517',
      },
      {
        path: 'assets/cream-kitten/sit.png',
        sha256: '47bbb5f6746d178b148f47f77e9a1ce5420117983c077f1be31f098167cbe578',
      },
      {
        path: 'assets/cream-kitten/sleepy.png',
        sha256: 'a0dba2668c0bc428ae53637861ef638f4144a00ec2226c9cb269dca9ba0fd702',
      },
      {
        path: 'assets/cream-kitten/walk_0.png',
        sha256: 'ee6f5c985384d8d3f82695b316dd7e2cf27fe5d5fa45f36daf831dd4a245e73a',
      },
      {
        path: 'assets/cream-kitten/walk_1.png',
        sha256: '1cdbd638abee5bacdcd31fd9c95f2807cc9d9d3b46119074006cc2eae7ee1828',
      },
      {
        path: 'assets/cream-kitten/walk_2.png',
        sha256: '2bb556309abb0437934b8420478c9d6dab32a690dbb21dd38cad6549793a8106',
      },
      {
        path: 'assets/cream-kitten/walk_3.png',
        sha256: '74158af875e17bcc0182d6a6bd5f1550a60c133c00a8dcb72e6497d26e0896d6',
      },
    ],
  },
  license: {
    spdx: null,
    sourceUrl: null,
    commercialUse: false,
    attributionRequired: false,
    notes:
      '来源与许可尚未归档（无 license/ 存证）。按协议 §10.1 补齐前仅 dev-only；idle_gs.jpg 未被帧表引用，不在资产清单内。',
  },
});

/** 全部已注册角色的 manifest（键 = PetId） */
export const CHARACTER_MANIFESTS: Readonly<Record<string, CharacterManifest>> = {
  'star-isle': starIsleManifest,
  codenono: codenonoManifest,
  'cream-kitten': creamKittenManifest,
};

/** 按 id 取 manifest；未知 id 回退星屿（与 getCharacterConfig 同语义） */
export function getCharacterManifest(id: string | undefined): CharacterManifest {
  return CHARACTER_MANIFESTS[id ?? ''] ?? starIsleManifest;
}
```

注意：`resolveAsset` 在测试里按 `join(__dirname, '..', path)` 解析——`__dirname` 是 `apps/desktop/src/pet`，`'assets/...'` 相对 `apps/desktop/src`，与 manifest 中的 `path` 字段约定一致。若 vitest 的 `__dirname` 不可用（ESM），用 `new URL('.', import.meta.url)` 转换，但本仓库 vitest 配置下现有测试均直接用 `__dirname`，保持一致即可。

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run apps/desktop/src/pet/character-manifests.test.ts
```

预期：PASS。若 sha256 用例失败，说明资产文件与计划时点不一致（被修改过）——用下面命令重算并同步 manifest 与测试说明，不允许注释掉哈希断言：

```bash
node -e "const{createHash}=require('crypto'),fs=require('fs'),path=require('path');const dir='apps/desktop/src/assets/cream-kitten';for(const f of fs.readdirSync(dir).filter(x=>x.endsWith('.png')))console.log(f, createHash('sha256').update(fs.readFileSync(path.join(dir,f))).digest('hex'))"
```

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/pet/character-manifests.ts apps/desktop/src/pet/character-manifests.test.ts
git commit -m "feat(desktop): 三角色 manifest 数据（形象协议阶段 B）"
```

---

### Task 3: registry ↔ manifest ↔ PetId 一致性（阶段 A 第 2 项）

**Files:**

- Modify: `apps/desktop/src/pet/character-registry.test.ts`（文件末尾追加 describe；该文件已是 jsdom 环境，registry 引入了 image-visual 的模块级 `new Image()` 预载）
- 不改 `character-registry.ts` 本体（阶段 C 才让 registry 消费 manifest）

- [ ] **Step 1: 追加失败测试**

在 `apps/desktop/src/pet/character-registry.test.ts` 顶部 import 区加：

```ts
import { PetIdSchema } from '@pet/protocol';

import { CHARACTER_MANIFESTS } from './character-manifests.js';
```

文件末尾追加：

```ts
describe('registry ↔ manifest ↔ PetId 一致性（形象协议 §11）', () => {
  it('registry 与 manifest 恰好覆盖同一组角色', () => {
    const registryIds = listCharacters()
      .map((c) => c.id)
      .sort();
    const manifestIds = Object.keys(CHARACTER_MANIFESTS).sort();
    expect(registryIds).toEqual(manifestIds);
  });

  it('每个角色 id 都是合法 PetId（新增角色必须先扩协议枚举）', () => {
    for (const id of Object.keys(CHARACTER_MANIFESTS)) {
      expect(PetIdSchema.options).toContain(id);
    }
  });

  it('registry 卡片文案与 manifest 同源一致（displayName/description）', () => {
    for (const c of CHARACTERS) {
      const manifest = CHARACTER_MANIFESTS[c.id]!;
      expect(c.displayName).toBe(manifest.displayName);
      expect(c.description).toBe(manifest.description);
      expect(c.petName).toBe(manifest.petName);
    }
  });

  it('manifest release 级别满足迁移定位（§12）：星屿 bundled，其余 dev-only', () => {
    expect(CHARACTER_MANIFESTS['star-isle']!.release).toBe('bundled');
    expect(CHARACTER_MANIFESTS['codenono']!.release).toBe('dev-only');
    expect(CHARACTER_MANIFESTS['cream-kitten']!.release).toBe('dev-only');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run apps/desktop/src/pet/character-registry.test.ts
```

预期：新 describe FAIL（`./character-manifests.js` 尚未创建——如果 Task 2 已完成则此测试应直接通过；那么本任务的"失败步骤"以 Task 2 未完成的时间线为准，执行时若已绿，直接进 Step 3 记录说明并跳到提交）。

- [ ] **Step 3: 校验文案一致性（若有偏差以 manifest 为准改 registry）**

对比 `character-registry.ts` 的 `CHARACTERS` 三条目与 manifest 的 `displayName/petName/description`。当前两者同源（Task 2 的 manifest 文案就是从 registry 抄的），预期无需改动；若执行时出现偏差，改 `character-registry.ts` 对齐 manifest，并重跑：

```bash
npx vitest run apps/desktop/src/pet/character-registry.test.ts
```

预期：PASS（含原有用例）。

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/pet/character-registry.test.ts
git commit -m "test(desktop): registry↔manifest↔PetId 一致性锁定（形象协议阶段 A）"
```

---

### Task 4: 文档状态与落点索引

**Files:**

- Modify: `docs/superpowers/specs/2026-08-20-desktop-pet-character-protocol-design.md`（第 3 行）
- Modify: `AGENTS.md`（功能落点速查表）

- [ ] **Step 1: 更新 spec 状态行**

把设计稿头部的：

```markdown
- **状态**：设计稿，待审阅
```

改为：

```markdown
- **状态**：已批准；阶段 A+B 已落地（manifest schema + 三角色数据），阶段 C/D 见 docs/superpowers/plans/
```

- [ ] **Step 2: AGENTS.md 加落点行**

在 `AGENTS.md` 功能落点速查表中「改星屿外观/动作/交互」那一行之后插入：

```markdown
| 新增/适配桌宠形象（manifest/命中区/动作覆盖/许可） | `apps/desktop/src/pet/character-manifests.ts` + `character-registry.ts`（协议见 `docs/superpowers/specs/2026-08-20-desktop-pet-character-protocol-design.md`） | 桌宠形象协议 |
```

- [ ] **Step 3: 格式化并提交**

```bash
pnpm format
git add docs/superpowers/specs/2026-08-20-desktop-pet-character-protocol-design.md AGENTS.md
git commit -m "docs: 形象协议状态更新与 AGENTS 落点索引"
```

---

### Task 5: 全量验证

- [ ] **Step 1: 全量测试**

```bash
pnpm test
```

预期：全部通过（929+ 新增用例数；不允许任何既有用例转红）。

- [ ] **Step 2: 类型/静态检查**

```bash
pnpm typecheck && pnpm --filter @pet/desktop typecheck && pnpm lint && pnpm format
```

预期：全部干净。

- [ ] **Step 3: 确认未污染运行时行为**

```bash
git diff --stat main -- apps/desktop/src/pet/pet-experience.tsx apps/desktop/src/pet/sao-menu.tsx apps/desktop/src/pet/classic-menu.tsx apps/desktop/electron
```

预期：无输出（本阶段不动运行时/窗口/菜单代码）。

- [ ] **Step 4: 最终提交（若前序有未提交的格式化产物）**

```bash
git status --short   # 应为空；有残留则按文件归属补进对应语义提交
```

---

## 后续计划（本文件不覆盖，按 spec §14 顺序另立 plan 文档）

- **阶段 C**：产品消费方迁移——registry/manifest 驱动角色选择缩略图（替换 character-select.tsx 的 if/else 分支）、`CharacterVisualProvider` 消除 chat-panel/local-chat/settings/pet-fallback 的星屿硬编码、PetExperience 命中区从 `data-hit="head|body|tail"` 迁移到 manifest zone ID（`body`→primary 兼容映射）。
- **阶段 D**：资源预检 CLI（manifest/哈希/尺寸/透明画布一致性/许可完备）、0.5×/1×/2× 与菜单/气泡截图验收、每角色 E2E smoke、CI release 门禁。

两份 plan 分别在阶段 A+B 验收合并后编写，保证每次执行都交付可运行、可测试的增量。

## Self-Review 记录

- **Spec 覆盖**：§3.1（画布常量+superRefine）、§3.2/§6（zone schema+primary+40×40）、§4（manifest 全字段）、§5.3（三边界分离+画布内校验）、§7.2/§7.3（覆盖枚举+fallback 同类校验+链终止测试）、§9（命名空间=角色 id+前缀校验）、§10.1/§10.2（许可字段如实+哈希实测）、§12（三级 release 定位）、§14 阶段 A 全部 3 项 + 阶段 B 第 1/2/3 项中可代码化部分（许可证书面确认与帧画布工具属阶段 D/人工）。缺口：无代码化缺口；§12.3"帧对齐工具"依赖阶段 D CLI。
- **占位符扫描**：无 TBD/TODO；所有代码块完整可粘贴；哈希为实测值。
- **类型一致性**：`CharacterManifest`/`CharacterInteractionZone`/`characterZoneBBox`/`CHARACTER_MANIFESTS`/`getCharacterManifest` 在 Task 1/2/3 间签名一致；`assets.path` 解析约定（相对 `apps/desktop/src`）在实现与测试中一致。
