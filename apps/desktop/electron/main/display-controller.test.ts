import { describe, expect, it } from 'vitest';

import {
  resolvePetPosition,
  toAbsolute,
  toAnchor,
  clampPetWindowToDisplays,
  anchorPanelToPet,
  DEFAULT_PET_SCALE,
  MIN_PET_SCALE,
  MAX_PET_SCALE,
  PetPositionSchema,
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

describe('PetPositionSchema (持久化校验)', () => {
  const valid: PetPosition = {
    displayId: 'primary',
    anchorX: 0.5,
    anchorY: 0.25,
    scale: 1,
    savedAt: 100,
  };

  it('parses a valid persisted position', () => {
    expect(PetPositionSchema.parse(valid)).toEqual(valid);
  });

  it('rejects out-of-range anchors', () => {
    expect(() => PetPositionSchema.parse({ ...valid, anchorX: 1_000_000 })).toThrow();
    expect(() => PetPositionSchema.parse({ ...valid, anchorY: NaN })).toThrow();
    expect(() => PetPositionSchema.parse({ ...valid, anchorX: Infinity })).toThrow();
  });

  it('rejects out-of-range scale', () => {
    expect(() => PetPositionSchema.parse({ ...valid, scale: 0 })).toThrow();
    expect(() => PetPositionSchema.parse({ ...valid, scale: 3 })).toThrow();
  });

  it('rejects non-finite savedAt', () => {
    expect(() => PetPositionSchema.parse({ ...valid, savedAt: NaN })).toThrow();
    expect(() => PetPositionSchema.parse({ ...valid, savedAt: Infinity })).toThrow();
  });

  it('rejects extra fields (strict)', () => {
    expect(() => PetPositionSchema.parse({ ...valid, extra: true })).toThrow();
  });
});

describe('clampPetWindowToDisplays (拖动夹取)', () => {
  const petSize = { width: 280, height: 320 };

  it('keeps an already visible position unchanged', () => {
    expect(clampPetWindowToDisplays({ x: 500, y: 300 }, dualDisplays, petSize)).toEqual({
      x: 500,
      y: 300,
    });
  });

  it('clamps the right edge so at least 1/4 of the window stays visible', () => {
    // 主屏 1000px 宽，宠物窗口最多只能露出 70px（280*0.25），所以 x 最大 1000-70
    expect(clampPetWindowToDisplays({ x: 950, y: 300 }, dualDisplays, petSize)).toEqual({
      x: 930,
      y: 300,
    });
  });

  it('clamps off-screen top edge', () => {
    expect(clampPetWindowToDisplays({ x: 500, y: -300 }, dualDisplays, petSize)).toEqual({
      x: 500,
      y: -240,
    });
  });

  it('preserves negative coordinates on the left secondary display', () => {
    // 目标位于左侧副屏内（x ∈ [-1280,0)），右边界被夹到 -70
    expect(clampPetWindowToDisplays({ x: -50, y: 400 }, dualDisplays, petSize)).toEqual({
      x: -70,
      y: 400,
    });
  });

  it('falls back to the primary display when the target is on no display', () => {
    // y=900 超出所有显示器 → 回主屏并夹进可见区域
    expect(clampPetWindowToDisplays({ x: 500, y: 900 }, dualDisplays, petSize)).toEqual({
      x: 500,
      y: 720,
    });
  });

  it('returns the target unchanged when there are no displays', () => {
    expect(clampPetWindowToDisplays({ x: 100, y: 200 }, [], petSize)).toEqual({ x: 100, y: 200 });
  });
});

describe('anchorPanelToPet (面板锚定)', () => {
  const panel = { width: 360, height: 480 };
  const workArea = { x: 0, y: 0, width: 1000, height: 800 };
  const pet = { x: 100, y: 100, width: 280, height: 320 };

  it('anchors to the right side of the pet when it fits', () => {
    expect(anchorPanelToPet(pet, panel, workArea)).toEqual({ x: 380, y: 100 });
  });

  it('falls back to the left side when the right side does not fit', () => {
    const rightEdgePet = { ...pet, x: 700 };
    expect(anchorPanelToPet(rightEdgePet, panel, workArea)).toEqual({ x: 340, y: 100 });
  });

  it('clamps into the work area when neither side fits (partial visibility)', () => {
    const narrow = { x: 0, y: 0, width: 400, height: 800 };
    const petAtLeft = { x: 50, y: 100, width: 280, height: 320 };
    expect(anchorPanelToPet(petAtLeft, panel, narrow)).toEqual({ x: 310, y: 100 });
  });

  it('works on a negative-coordinate display', () => {
    const negWorkArea = { x: -1280, y: 0, width: 1280, height: 800 };
    const negPet = { x: -1200, y: 100, width: 280, height: 320 };
    // 右侧：-1200+280=-920，-920+360=-560 仍在工作区内 → 放右侧
    expect(anchorPanelToPet(negPet, panel, negWorkArea)).toEqual({ x: -920, y: 100 });
  });

  it('returns integer coordinates even when clamping yields fractions', () => {
    const fractionalPanel = { width: 361, height: 480 };
    const narrow = { x: 0, y: 0, width: 401, height: 800 };
    const petAtLeft = { x: 50, y: 100, width: 280, height: 320 };
    const result = anchorPanelToPet(petAtLeft, fractionalPanel, narrow);
    expect(Number.isInteger(result.x)).toBe(true);
    expect(Number.isInteger(result.y)).toBe(true);
    expect(result.x).toBe(311); // Math.round(401 - 361*0.25) = Math.round(310.75)
    expect(result.y).toBe(100);
  });
});
