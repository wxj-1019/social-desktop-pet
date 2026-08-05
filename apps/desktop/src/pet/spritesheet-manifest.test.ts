import { PetMotionSchema } from '@pet/protocol';
import { describe, expect, it } from 'vitest';

import {
  CODENONO_MOTION_MAP,
  FRAME_SIZE,
  GRID_COLUMNS,
  SPRITESHEET_SIZE,
  SpriteMotionSpecSchema,
  frameCount,
  frameIntervalMs,
  frameOffset,
  resolveSpritesheetAnimation,
} from './spritesheet-manifest.js';

describe('spritesheet-manifest / 规格', () => {
  it('网格列数与帧宽派生自整图尺寸', () => {
    expect(GRID_COLUMNS).toBe(8);
    expect(SPRITESHEET_SIZE.width / FRAME_SIZE.width).toBe(GRID_COLUMNS);
    expect(SPRITESHEET_SIZE.height / FRAME_SIZE.height).toBe(9);
  });
});

describe('spritesheet-manifest / 动作映射完整性', () => {
  // 每个 PetMotion 都必须有映射（PetMotionSchema.options 是全部合法动作）
  for (const motion of PetMotionSchema.options) {
    it(`${motion} 有合法映射`, () => {
      const spec = CODENONO_MOTION_MAP[motion];
      expect(spec).toBeDefined();
      expect(SpriteMotionSpecSchema.parse(spec)).toEqual(spec);
    });
  }

  it('所有行号在 0..8 范围内', () => {
    for (const spec of Object.values(CODENONO_MOTION_MAP)) {
      expect(spec.row).toBeGreaterThanOrEqual(0);
      expect(spec.row).toBeLessThanOrEqual(8);
    }
  });

  it('所有帧数在 1..GRID_COLUMNS 范围内', () => {
    for (const spec of Object.values(CODENONO_MOTION_MAP)) {
      expect(spec.frames).toBeGreaterThanOrEqual(1);
      expect(spec.frames).toBeLessThanOrEqual(GRID_COLUMNS);
    }
  });

  it('拒绝越过当前图集行边界的起始帧与帧数组合', () => {
    expect(
      SpriteMotionSpecSchema.safeParse({ row: 0, startFrame: 7, frames: 2, fps: 8 }).success,
    ).toBe(false);
  });
});

describe('spritesheet-manifest / 帧计算', () => {
  it('frameOffset 计算 idle 第 0 帧 = (0,0)', () => {
    expect(frameOffset('idle', 0)).toEqual({ x: 0, y: 0 });
  });

  it('walk 使用图集中真实的左右奔跑行', () => {
    expect(frameOffset('walk', 3, 'right')).toEqual({ x: 576, y: 208 });
    expect(frameOffset('walk', 3, 'left')).toEqual({ x: 576, y: 416 });
  });

  it('说话优先使用 talk 行，idle 表情可落到静态表情帧', () => {
    expect(
      resolveSpritesheetAnimation({
        motion: 'idle',
        expression: 'warm',
        speaking: true,
        facing: 'right',
      }).key,
    ).toBe('motion:talk');
    expect(
      resolveSpritesheetAnimation({
        motion: 'idle',
        expression: 'happy',
        speaking: false,
        facing: 'right',
      }).key,
    ).toBe('expression:happy');
  });

  it('frameOffset 在帧数边界循环（frame=frames 时回到 0）', () => {
    // wave frames=4 → frame 4 等价于 frame 0
    expect(frameOffset('wave', 4)).toEqual(frameOffset('wave', 0));
  });

  it('frameCount 返回每动作帧数', () => {
    expect(frameCount('idle')).toBe(6);
    expect(frameCount('sad')).toBe(8);
    expect(frameCount('wave')).toBe(4);
  });

  it('frameIntervalMs 由 fps 派生', () => {
    // idle fps=8 → 125ms
    expect(frameIntervalMs('idle')).toBe(125);
    // walk fps=10 → 100ms
    expect(frameIntervalMs('walk')).toBe(100);
  });
});
