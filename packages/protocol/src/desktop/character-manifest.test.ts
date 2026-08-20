import { describe, expect, it } from 'vitest';

import {
  CharacterInteractionZoneSchema,
  CharacterManifestSchema,
  PetExpressionSchema,
  PetIdSchema,
  PetMotionSchema,
} from './index.js';

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
    extensions: { namespace: 'star-isle', actions: [] as string[], effects: [] as string[] },
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

    // 左侧越界：circle 的 cx-r < 0（派生坐标，字段级 nonnegative 抓不住）
    const circleLeft = buildValidManifest();
    (circleLeft.interaction as unknown) = {
      enabled: true,
      zones: [
        {
          id: 'primary',
          shape: 'circle',
          cx: 20,
          cy: 100,
          r: 30,
          priority: 0,
          label: '越界圆',
        },
      ],
    };
    expect(CharacterManifestSchema.safeParse(circleLeft).success).toBe(false);

    // polygon 点坐标为负
    const negPolygon = buildValidManifest();
    (negPolygon.interaction as unknown) = {
      enabled: true,
      zones: [
        {
          id: 'primary',
          shape: 'polygon',
          points: [
            { x: -10, y: 0 },
            { x: 60, y: 0 },
            { x: 60, y: 80 },
          ],
          priority: 0,
          label: '负点三角',
        },
      ],
    };
    expect(CharacterManifestSchema.safeParse(negPolygon).success).toBe(false);
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

  it('coreMotions/expressions 键集与共享枚举锁定（防漂移）', () => {
    // CharacterManifestSchema 是 z.object().strict().superRefine(...) → ZodEffects，
    // 无 .shape；strict 对象的 parse 输出键集 === schema 硬编码键集，故用探针比对
    const { capabilities } = CharacterManifestSchema.parse(buildValidManifest());
    expect(Object.keys(capabilities.coreMotions).sort()).toEqual(
      [...PetMotionSchema.options].sort(),
    );
    expect(Object.keys(capabilities.expressions).sort()).toEqual(
      [...PetExpressionSchema.options].sort(),
    );
  });

  it('fallback 链成环被 schema 拒绝（§7.2 纵深防御）', () => {
    const selfLoop = buildValidManifest();
    selfLoop.capabilities.coreMotions.sit = 'fallback:sit';
    expect(CharacterManifestSchema.safeParse(selfLoop).success).toBe(false);

    const mutual = buildValidManifest();
    mutual.capabilities.expressions.warm = 'fallback:shy';
    mutual.capabilities.expressions.shy = 'fallback:warm';
    expect(CharacterManifestSchema.safeParse(mutual).success).toBe(false);
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
