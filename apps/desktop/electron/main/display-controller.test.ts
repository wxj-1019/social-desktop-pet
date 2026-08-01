import { describe, expect, it } from 'vitest';

import {
  resolvePetPosition,
  toAbsolute,
  toAnchor,
  DEFAULT_PET_SCALE,
  MIN_PET_SCALE,
  MAX_PET_SCALE,
  type DisplayInfo,
  type PetPosition,
} from './display-controller.js';

const petSize = { width: 360, height: 480 };

/** 双屏：主屏(0,0) 1000×800，副屏在主屏左侧(-1280,0) 1280×800 */
const dualDisplays: DisplayInfo[] = [
  { id: 'primary', workArea: { x: 0, y: 0, width: 1000, height: 800 }, scaleFactor: 1 },
  { id: 'left', workArea: { x: -1280, y: 0, width: 1280, height: 800 }, scaleFactor: 1.5 },
];

describe('DisplayController (8.5 多屏持久化)', () => {
  it('supports negative coordinates for a left-side secondary display', () => {
    const saved: PetPosition = {
      displayId: 'left',
      anchorX: 100,
      anchorY: 50,
      scale: 1,
      savedAt: 0,
    };
    const { x, y } = toAbsolute(dualDisplays[1]!, saved);
    expect(x).toBe(-1280 + 100);
    expect(y).toBe(50);
  });

  it('restores to the saved display when it exists', () => {
    const saved: PetPosition = {
      displayId: 'left',
      anchorX: 640,
      anchorY: 100,
      scale: 1.2,
      savedAt: 0,
    };
    const result = resolvePetPosition(saved, dualDisplays, petSize);
    expect(result.display.id).toBe('left');
    expect(result.scale).toBe(1.2);
  });

  it('falls back to primary display when saved display is gone (8.5)', () => {
    const saved: PetPosition = {
      displayId: 'unplugged-tv',
      anchorX: 0,
      anchorY: 0,
      scale: 1,
      savedAt: 0,
    };
    const result = resolvePetPosition(saved, dualDisplays, petSize);
    expect(result.display.id).toBe('primary');
  });

  it('defaults to bottom-center of primary when no saved position', () => {
    const result = resolvePetPosition(null, dualDisplays, petSize);
    expect(result.display.id).toBe('primary');
    expect(result.x).toBe((1000 - 360) / 2);
    expect(result.y).toBe(800 - 480 - 8);
  });

  it('clamps position so the pet stays at least 1/4 visible', () => {
    // 存一个完全跑出屏幕外的位置（负锚点 -9999）
    const saved: PetPosition = {
      displayId: 'primary',
      anchorX: -9999,
      anchorY: -9999,
      scale: 1,
      savedAt: 0,
    };
    const result = resolvePetPosition(saved, dualDisplays, petSize);
    expect(result.x).toBeGreaterThanOrEqual(0 - petSize.width + petSize.width * 0.25);
    expect(result.y).toBeGreaterThanOrEqual(0 - petSize.height + petSize.height * 0.25);
  });

  it('clamps scale to [MIN, MAX]', () => {
    const saved: PetPosition = {
      displayId: 'primary',
      anchorX: 0,
      anchorY: 0,
      scale: 99, // 超上限
      savedAt: 0,
    };
    const result = resolvePetPosition(saved, dualDisplays, petSize);
    expect(result.scale).toBe(MAX_PET_SCALE);
    const tiny: PetPosition = { ...saved, scale: 0.01 };
    expect(resolvePetPosition(tiny, dualDisplays, petSize).scale).toBe(MIN_PET_SCALE);
    expect(DEFAULT_PET_SCALE).toBe(1);
  });

  it('round-trips absolute ↔ anchor', () => {
    const saved: PetPosition = {
      displayId: 'left',
      anchorX: 123,
      anchorY: 456,
      scale: 1,
      savedAt: 0,
    };
    const abs = toAbsolute(dualDisplays[1]!, saved);
    const back = toAnchor(dualDisplays[1]!, abs);
    expect(back).toEqual({ anchorX: 123, anchorY: 456 });
  });
});
