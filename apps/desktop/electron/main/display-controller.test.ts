import { describe, expect, it } from 'vitest';

import {
  resolvePetPosition,
  toAbsolute,
  toAnchor,
  toPersistedPosition,
  clampPetWindowToDisplays,
  anchorPanelToPet,
  DEFAULT_PET_SCALE,
  MIN_PET_SCALE,
  MAX_PET_SCALE,
  PetPositionSchema,
  type DisplayInfo,
  type PetPosition,
} from './display-controller.js';

/** 真实桌宠窗口尺寸（window-controller.PET_WINDOW_SIZE） */
const petSize = { width: 240, height: 260 };

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
      anchorX: 900, // 失效显示器上的大偏移——绝不能被套到主屏
      anchorY: 700,
      scale: 1,
      savedAt: 0,
    };
    const result = resolvePetPosition(saved, dualDisplays, petSize);
    expect(result.display.id).toBe('primary');
    // 丢弃旧偏移，回主屏底部中央默认位
    expect(result.x).toBe((1000 - 240) / 2);
    expect(result.y).toBe(800 - 260 - 8);
  });

  it('defaults to bottom-center of primary when no saved position', () => {
    const result = resolvePetPosition(null, dualDisplays, petSize);
    expect(result.display.id).toBe('primary');
    expect(result.x).toBe((1000 - 240) / 2);
    expect(result.y).toBe(800 - 260 - 8);
  });

  it('treats the empty displayId factory default as no saved position', () => {
    // 生产路径：PositionStore 无文件时返回 displayId:'' 的默认值——必须走默认位，
    // 否则首次启动会被恢复到工作区左上角
    const saved: PetPosition = { displayId: '', anchorX: 0, anchorY: 0, scale: 1, savedAt: 0 };
    const result = resolvePetPosition(saved, dualDisplays, petSize);
    expect(result.display.id).toBe('primary');
    expect(result.x).toBe((1000 - 240) / 2);
    expect(result.y).toBe(800 - 260 - 8);
  });

  it('clamps a persisted right-edge position back fully into the work area', () => {
    // 拖到右边缘探出屏幕 180px 的位置会被持久化；重启恢复必须完整拉回工作区内
    const saved: PetPosition = {
      displayId: 'primary',
      anchorX: 940, // 940+240=1180 超出 1000 工作区
      anchorY: 500,
      scale: 1,
      savedAt: 0,
    };
    const result = resolvePetPosition(saved, dualDisplays, petSize);
    expect(result.x).toBe(1000 - 240);
    expect(result.y).toBe(500);
  });

  it('clamps taskbar overlap and fully off-screen positions on restore', () => {
    // 窗口完全落在工作区内 → 原样恢复
    const inside: PetPosition = {
      displayId: 'primary',
      anchorX: 380,
      anchorY: 508, // 508+260=768 ≤ 800
      scale: 1,
      savedAt: 0,
    };
    expect(resolvePetPosition(inside, dualDisplays, petSize).y).toBe(508);
    // 底部探入任务栏 → 拉回完整可见
    const overlap: PetPosition = { ...inside, anchorY: 572 }; // 572+260=832 超出 32px
    expect(resolvePetPosition(overlap, dualDisplays, petSize).y).toBe(800 - 260);
    // 完全跑出屏幕 → 拉回工作区原点
    const lost: PetPosition = { ...inside, anchorX: -9999, anchorY: -9999 };
    const result = resolvePetPosition(lost, dualDisplays, petSize);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
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

  it('toPersistedPosition maps an in-bounds position to the owning display', () => {
    const persisted = toPersistedPosition(dualDisplays, { x: 250, y: 180 });
    expect(persisted?.displayId).toBe('primary');
    expect(persisted?.anchorX).toBe(250);
    expect(persisted?.anchorY).toBe(180);
    expect(persisted?.scale).toBe(DEFAULT_PET_SCALE);
  });

  it('toPersistedPosition maps a negative-coordinate position to the left display', () => {
    const persisted = toPersistedPosition(dualDisplays, { x: -1000, y: 120 });
    expect(persisted?.displayId).toBe('left');
    expect(persisted?.anchorX).toBe(-1000 - -1280); // abs.x - workArea.x
    expect(persisted?.anchorY).toBe(120);
  });

  it('toPersistedPosition returns null when the position is outside all displays', () => {
    expect(toPersistedPosition(dualDisplays, { x: 5000, y: 5000 })).toBeNull();
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
  const petSize = { width: 240, height: 260 };

  it('keeps an already visible position unchanged', () => {
    expect(clampPetWindowToDisplays({ x: 500, y: 300 }, dualDisplays, petSize)).toEqual({
      x: 500,
      y: 300,
    });
  });

  it('clamps the right edge so the window stays fully visible', () => {
    // 主屏 1000px 宽，窗口右缘最多 1000（240 宽 → x 最大 760）
    expect(clampPetWindowToDisplays({ x: 950, y: 300 }, dualDisplays, petSize)).toEqual({
      x: 760,
      y: 300,
    });
  });

  it('clamps off-screen top edge', () => {
    expect(clampPetWindowToDisplays({ x: 500, y: -300 }, dualDisplays, petSize)).toEqual({
      x: 500,
      y: 0,
    });
  });

  it('preserves negative coordinates on the left secondary display', () => {
    // 目标位于左侧副屏内（x ∈ [-1280,0)），窗口必须完整留在屏内 → x 最大 -240
    expect(clampPetWindowToDisplays({ x: -50, y: 400 }, dualDisplays, petSize)).toEqual({
      x: -240,
      y: 400,
    });
  });

  it('falls back to the primary display when the target is on no display', () => {
    // y=900 超出所有显示器 → 回主屏并夹进完整可见
    expect(clampPetWindowToDisplays({ x: 500, y: 900 }, dualDisplays, petSize)).toEqual({
      x: 500,
      y: 540,
    });
  });

  it('returns the target unchanged when there are no displays', () => {
    expect(clampPetWindowToDisplays({ x: 100, y: 200 }, [], petSize)).toEqual({ x: 100, y: 200 });
  });
});

describe('anchorPanelToPet (面板锚定)', () => {
  const panel = { width: 360, height: 480 };
  const workArea = { x: 0, y: 0, width: 1000, height: 800 };
  const pet = { x: 100, y: 100, width: 240, height: 260 };

  it('anchors to the right side of the pet when it fits', () => {
    expect(anchorPanelToPet(pet, panel, workArea)).toEqual({ x: 340, y: 100 });
  });

  it('falls back to the left side when the right side does not fit', () => {
    const rightEdgePet = { ...pet, x: 700 };
    expect(anchorPanelToPet(rightEdgePet, panel, workArea)).toEqual({ x: 340, y: 100 });
  });

  it('clamps fully visible when neither side fits but the work area can contain the panel', () => {
    const narrow = { x: 0, y: 0, width: 400, height: 800 };
    const petAtLeft = { x: 50, y: 100, width: 240, height: 260 };
    // rightX=290，290+360>400 且左侧 50-360<0 → 夹进工作区且完整可见（上限 400-360=40）
    expect(anchorPanelToPet(petAtLeft, panel, narrow)).toEqual({ x: 40, y: 100 });
  });

  it('clamps y when the pet sits near the bottom (panel would be cut off)', () => {
    const bottomPet = { ...pet, y: 600 };
    // pet.y+480=1080 > 800 → y 抬升到 800-480=320，面板完整可见
    expect(anchorPanelToPet(bottomPet, panel, workArea)).toEqual({ x: 340, y: 320 });
  });

  it('clamps y on the left side too when the pet sits near the bottom', () => {
    const bottomRightPet = { x: 700, y: 600, width: 240, height: 260 };
    // 右侧 940+360>1000 → 左侧，y 同样抬升
    expect(anchorPanelToPet(bottomRightPet, panel, workArea)).toEqual({ x: 340, y: 320 });
  });

  it('keeps at least 1/4 visible when the work area is smaller than the panel', () => {
    const tiny = { x: 0, y: 0, width: 300, height: 800 };
    const petAtLeft = { x: 50, y: 100, width: 240, height: 260 };
    // 面板 360 > 工作区宽 300 → 1/4 规则：clamp(290, -269.75, 209.75) → 210
    expect(anchorPanelToPet(petAtLeft, panel, tiny)).toEqual({ x: 210, y: 100 });
  });

  it('works on a negative-coordinate display', () => {
    const negWorkArea = { x: -1280, y: 0, width: 1280, height: 800 };
    const negPet = { x: -1200, y: 100, width: 240, height: 260 };
    // 右侧：-1200+240=-960，-960+360=-600 仍在工作区内 → 放右侧
    expect(anchorPanelToPet(negPet, panel, negWorkArea)).toEqual({ x: -960, y: 100 });
  });

  it('returns integer coordinates even when clamping yields fractions', () => {
    const fractionalPanel = { width: 361, height: 480 };
    const narrow = { x: 0, y: 0, width: 401, height: 800 };
    const petAtLeft = { x: 90, y: 100, width: 240, height: 260 };
    const result = anchorPanelToPet(petAtLeft, fractionalPanel, narrow);
    expect(Number.isInteger(result.x)).toBe(true);
    expect(Number.isInteger(result.y)).toBe(true);
    expect(result.x).toBe(40); // 完整可见：clamp(330, 0, 401-361=40) → 40
    expect(result.y).toBe(100);
  });
});
