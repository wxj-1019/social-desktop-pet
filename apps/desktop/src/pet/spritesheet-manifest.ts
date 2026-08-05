/**
 * CodeNoNo spritesheet 规格 + 动作映射。
 *
 * CodeNoNo 的 spritesheet 是固定网格（1536×1872，192×208 帧，8 列 × 9 行），
 * 每一行对应一个原始动画（idle/running-right/.../review）。
 * 本模块把它映射到我们 10 个 PetMotion 上（@pet/protocol PetMotionSchema），
 * 供 SpritesheetVisual 按 [motion] → { row, frames, fps } 计算当前帧。
 *
 * 资产经 Vite import 引入（dev server / prod asar 都走 CSP 'self' 源），
 * 与 SVG 星屿共用 StarIsleVisualState，无需扩展渲染状态契约。
 */
import type { PetExpression, PetFacing, PetMotion } from '@pet/protocol';
import { z } from 'zod';

/** spritesheet 整图尺寸（像素）—— 与 validation.json 一致 */
export const SPRITESHEET_SIZE = { width: 1536, height: 1872 } as const;

/** 单帧尺寸（像素）—— 192×208，与窗口 240×260 宽高比几乎一致（0.923） */
export const FRAME_SIZE = { width: 192, height: 208 } as const;

/** 网格列数（8 列）—— 由规格派生，不另设常量避免不一致 */
export const GRID_COLUMNS = SPRITESHEET_SIZE.width / FRAME_SIZE.width; // 8

/** 单个动作在 spritesheet 中的定位：行号 + 该行使用帧数 + 帧率 */
export interface SpriteMotionSpec {
  /** spritesheet 中的行索引（0-based，自上而下） */
  row: number;
  /** 该行动作使用的帧数（1..GRID_COLUMNS） */
  frames: number;
  /** 动画在该行的起始列（缺省 0；静态表情可定位到单独一帧） */
  startFrame?: number;
  /** 播放帧率（FPS）；intensity 不改帧率，仅影响视觉幅度（CSS 层） */
  fps: number;
}

/**
 * PetMotion → CodeNoNo 行映射。
 *
 * CodeNoNo 原始 9 行动画 → 我们 10 个 PetMotion 的语义映射：
 *   row0 idle(6)        → idle
 *   row1 running-right(8) / row2 running-left(8) → walk（按 facing 选择）
 *   row3 waving(4)      → wave / touch(互动感)
 *   row4 jumping(5)     → happy / surprised(活泼惊讶)
 *   row5 failed(8)      → sad(失败表情)
 *   row6 waiting(6)     → sit(等待姿态)
 *   row7 sleep/review(6) → sleep
 *   row8 face/review(6) → talk 与静态表情帧
 */
export const CODENONO_MOTION_MAP: Readonly<Record<PetMotion, SpriteMotionSpec>> = {
  idle: { row: 0, frames: 6, fps: 8 },
  walk: { row: 1, frames: 8, fps: 10 },
  wave: { row: 3, frames: 4, fps: 8 },
  happy: { row: 4, frames: 5, fps: 10 },
  sad: { row: 5, frames: 8, fps: 6 },
  surprised: { row: 4, frames: 5, fps: 12 },
  touch: { row: 3, frames: 4, fps: 10 },
  talk: { row: 8, frames: 6, fps: 10 },
  sit: { row: 6, frames: 6, fps: 6 },
  sleep: { row: 7, frames: 6, fps: 2 },
};

/** walk 的左右奔跑行独立存在，不能用错误行或镜像替代。 */
export const CODENONO_WALK_MAP: Readonly<Record<PetFacing, SpriteMotionSpec>> = {
  right: CODENONO_MOTION_MAP.walk,
  left: { row: 2, frames: 8, fps: 10 },
};

/** idle 时保留 AI 表情：定位到图集中的单帧，避免整行混播成随机表情。 */
export const CODENONO_EXPRESSION_MAP: Readonly<Partial<Record<PetExpression, SpriteMotionSpec>>> = {
  happy: { row: 5, startFrame: 1, frames: 1, fps: 1 },
  sad: { row: 5, startFrame: 4, frames: 1, fps: 1 },
  surprised: { row: 8, startFrame: 5, frames: 1, fps: 1 },
  shy: { row: 8, startFrame: 1, frames: 1, fps: 1 },
};

/** 校验：每个 PetMotion 必须有映射，行号/帧数在网格内合法 */
export const SpriteMotionSpecSchema = z
  .object({
    row: z
      .number()
      .int()
      .min(0)
      .max(SPRITESHEET_SIZE.height / FRAME_SIZE.height - 1),
    startFrame: z
      .number()
      .int()
      .min(0)
      .max(GRID_COLUMNS - 1)
      .optional(),
    frames: z.number().int().min(1).max(GRID_COLUMNS),
    fps: z.number().int().min(1).max(30),
  })
  .refine((spec) => (spec.startFrame ?? 0) + spec.frames <= GRID_COLUMNS, {
    message: 'startFrame + frames must stay inside the spritesheet row',
  });

/**
 * 给定 motion 与当前帧索引（0-based），计算 spritesheet 背景偏移（px）。
 * SpritesheetVisual 用它设置 background-position。
 */
export function frameOffset(
  motion: PetMotion,
  frame: number,
  facing: PetFacing = 'right',
): { x: number; y: number } {
  const spec = motion === 'walk' ? CODENONO_WALK_MAP[facing] : CODENONO_MOTION_MAP[motion];
  return frameOffsetForSpec(spec, frame);
}

export function frameOffsetForSpec(
  spec: SpriteMotionSpec,
  frame: number,
): { x: number; y: number } {
  const col = (spec.startFrame ?? 0) + (frame % spec.frames);
  return {
    x: col * FRAME_SIZE.width,
    y: spec.row * FRAME_SIZE.height,
  };
}

/** 取某 motion 的总帧数（循环边界） */
export function frameCount(motion: PetMotion): number {
  return CODENONO_MOTION_MAP[motion].frames;
}

export interface SpritesheetAnimationRequest {
  motion: PetMotion;
  expression: PetExpression;
  speaking: boolean;
  facing: PetFacing;
}

export interface ResolvedSpritesheetAnimation {
  key: string;
  spec: SpriteMotionSpec;
}

/** 状态优先级：真实行走 > 说话 > 显式动作 > idle 表情 > idle。 */
export function resolveSpritesheetAnimation(
  request: SpritesheetAnimationRequest,
): ResolvedSpritesheetAnimation {
  if (request.motion === 'walk') {
    return {
      key: `motion:walk:${request.facing}`,
      spec: CODENONO_WALK_MAP[request.facing],
    };
  }
  if (request.speaking) {
    return { key: 'motion:talk', spec: CODENONO_MOTION_MAP.talk };
  }
  if (request.motion !== 'idle') {
    return { key: `motion:${request.motion}`, spec: CODENONO_MOTION_MAP[request.motion] };
  }
  const expressionSpec = CODENONO_EXPRESSION_MAP[request.expression];
  if (expressionSpec) {
    return { key: `expression:${request.expression}`, spec: expressionSpec };
  }
  return { key: 'motion:idle', spec: CODENONO_MOTION_MAP.idle };
}

export function frameCountForSpec(spec: SpriteMotionSpec): number {
  return spec.frames;
}

/** 取某 motion 的帧间隔（毫秒） */
export function frameIntervalMs(motion: PetMotion): number {
  return Math.round(1000 / CODENONO_MOTION_MAP[motion].fps);
}

export function frameIntervalMsForSpec(spec: SpriteMotionSpec): number {
  return Math.round(1000 / spec.fps);
}
