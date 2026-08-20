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
import { CharacterManifestSchema, type CharacterManifest, type PetId } from '@pet/protocol';

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
  // 坐标换算（两步复合）：① viewBox 320×380 → 240×260（xMidYMax meet：
  // scale=260/380≈0.6842，x 偏移≈10.53，y 偏移 0）；② star-isle__frame 构图框
  // transform="translate(-2 22) scale(1.2)"（star-isle-visual.tsx:98，仅 full variant）。
  // 复合：canvas_x ≈ 0.821·src_x + 9.16，canvas_y ≈ 0.821·src_y + 15.05。
  // 可见包络：顶缘含外耳尖（src y≈32→画布≈41）叠加 3 档弹跳（−13 src 单位
  // ≈10.7px）→ 30；底缘脚底 src y≈297→画布≈259（构图框设计为贴窗底）；
  // 柔和光晕的渐变透明尾可越出画布自然裁切，不计入可见内容（协议 §5.3）。
  visualBounds: { x: 15, y: 30, width: 218, height: 230 },
  // 命中区来自 star-isle-visual.tsx 透明 hit rect 经上述复合映射取整：
  // body(86,194,108,97)→(80,174,89,80)；head(72,96,136,124)→(68,94,112,102)；
  // tail(22,100,64,160)→(27,97,53,131)。head/tail 为 legacy 兼容 ID（§6.1）
  interaction: {
    enabled: true,
    zones: [
      {
        id: 'primary',
        shape: 'rect',
        x: 80,
        y: 174,
        width: 89,
        height: 80,
        priority: 0,
        label: '抚摸星屿',
      },
      {
        id: 'head',
        shape: 'rect',
        x: 68,
        y: 94,
        width: 112,
        height: 102,
        priority: 1,
        label: '摸摸头',
      },
      {
        id: 'tail',
        shape: 'rect',
        x: 27,
        y: 97,
        width: 53,
        height: 131,
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
  // 现状：data-hit="body" 在撑满整窗的外层容器；manifest 声明收窄后的视口区为目标 primary（阶段 C 迁移生效）
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
  // 静态布局：img max-width 90%/max-height 80% 居中 + padding-bottom 4% → img 顶 ≈21–26、底 ≈235。
  // 动画极值：ck-bounce 20% 帧 translateY(−6px) 与 scaleY 1.04 增高(≈8px) 同时发生
  //（origin 底部，cubic-bezier(0.34,1.4) 过冲略加重）→ 顶缘极值 ≈11，取 11；
  // ck-tilt ±8°(scale 1.02) 角点下探 半宽108×1.02×sin8°≈15px（实际 tilt 帧≈170px 宽，
  // 真实下探≈12，取保守值）→ 底缘 235+15=250
  //（styles.css @keyframes ck-bounce / ck-tilt-left / ck-tilt-right）
  visualBounds: { x: 12, y: 11, width: 216, height: 239 },
  // 现状：data-hit="body" 在撑满整窗的外层容器；manifest 声明收窄后的图像区为目标 primary（阶段 C 迁移生效）
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
    notes: '来源与许可尚未归档（无 license/ 存证）。按协议 §10.1 补齐前仅 dev-only。',
  },
});

/** 全部已注册角色的 manifest（键 = PetId） */
export const CHARACTER_MANIFESTS: Readonly<Record<PetId, CharacterManifest>> = {
  'star-isle': starIsleManifest,
  codenono: codenonoManifest,
  'cream-kitten': creamKittenManifest,
};

/** 按 id 取 manifest；未知 id 回退星屿（与 getCharacterConfig 同语义，并告警留诊断痕迹，§11） */
export function getCharacterManifest(id: string | undefined): CharacterManifest {
  const found = CHARACTER_MANIFESTS[id as PetId];
  if (found) return found;
  console.warn('[character] unknown petId "%s", fallback to star-isle', id);
  return starIsleManifest;
}
