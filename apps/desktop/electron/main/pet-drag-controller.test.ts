import { describe, expect, it, vi } from 'vitest';

import type { DisplayLike } from './display-controller.js';
import { PetDragController, type DragWindowPort } from './pet-drag-controller.js';

const displays: DisplayLike[] = [
  { id: 'primary', workArea: { x: 0, y: 0, width: 1000, height: 800 } },
  { id: 'left', workArea: { x: -1280, y: 0, width: 1280, height: 800 } },
];

function makeWin(bounds = { x: 100, y: 50, width: 280, height: 320 }): DragWindowPort & {
  calls: Array<{ x: number; y: number }>;
  setPosition: ReturnType<typeof vi.fn>;
} {
  let current = { ...bounds };
  const setPosition = vi.fn((x: number, y: number) => {
    current = { ...current, x, y };
  });
  const calls: Array<{ x: number; y: number }> = [];
  setPosition.mockImplementation((x: number, y: number) => {
    calls.push({ x, y });
    current = { ...current, x, y };
  });
  return {
    getBounds: vi.fn(() => ({ ...current })),
    setPosition,
    calls,
  };
}

describe('PetDragController (安全拖动)', () => {
  it('starts a drag and moves by the recorded mouse offset', () => {
    const win = makeWin({ x: 100, y: 50, width: 280, height: 320 });
    const c = new PetDragController();
    expect(c.isDragging).toBe(false);

    // 鼠标按下点 (120,70)，窗口左上 (100,50) → 偏移 (-20,-20)
    c.start(win, { x: 120, y: 70 });
    expect(c.isDragging).toBe(true);

    // 鼠标移动到 (220,170) → 目标 (200,150)，在主屏可见区域内 → 原样
    c.move(win, { x: 220, y: 170 }, displays);
    expect(win.setPosition).toHaveBeenLastCalledWith(200, 150);
    expect(win.calls).toEqual([{ x: 200, y: 150 }]);
  });

  it('clamps out-of-bounds targets so the window stays at least 1/4 visible', () => {
    const win = makeWin({ x: 100, y: 50, width: 280, height: 320 });
    const c = new PetDragController();
    c.start(win, { x: 120, y: 70 });

    // 目标 (980,480) → x 夹到 930（1000-70）
    c.move(win, { x: 1000, y: 500 }, displays);
    expect(win.setPosition).toHaveBeenLastCalledWith(930, 480);
  });

  it('keeps the pet on the display the pointer moved to (negative coords)', () => {
    const win = makeWin({ x: -1300, y: 100, width: 280, height: 320 });
    const c = new PetDragController();
    // 指针在左副屏内：起始点窗口左上 (-1300,100)、指针 (-1280,120)
    c.start(win, { x: -1280, y: 120 });
    expect(win.getBounds()).toEqual({ x: -1300, y: 100, width: 280, height: 320 });

    // 指针右移 100 → 目标 (-1200,100)，在左副屏 [-1490,-70] 内 → 原样
    c.move(win, { x: -1180, y: 120 }, displays);
    expect(win.setPosition).toHaveBeenLastCalledWith(-1200, 100);
  });

  it('ignores move calls when no drag session is active', () => {
    const win = makeWin();
    const c = new PetDragController();
    c.move(win, { x: 300, y: 300 }, displays);
    expect(win.setPosition).not.toHaveBeenCalled();
    expect(c.isDragging).toBe(false);
  });

  it('end() stops the drag and clears the session', () => {
    const win = makeWin();
    const c = new PetDragController();
    c.start(win, { x: 120, y: 70 });
    c.end();
    expect(c.isDragging).toBe(false);
    c.move(win, { x: 300, y: 300 }, displays);
    expect(win.setPosition).not.toHaveBeenCalled();
  });

  it('cancel() clears the session so further moves are ignored', () => {
    const win = makeWin();
    const c = new PetDragController();
    c.start(win, { x: 120, y: 70 });
    c.cancel();
    expect(c.isDragging).toBe(false);
    c.move(win, { x: 300, y: 300 }, displays);
    expect(win.setPosition).not.toHaveBeenCalled();
  });

  it('rounds the final clamped position to integers', () => {
    const win = makeWin({ x: 100.6, y: 50.2, width: 280, height: 320 });
    const c = new PetDragController();
    c.start(win, { x: 120.1, y: 70.3 });
    // 目标可能产生小数，最终 setPosition 应为整数
    c.move(win, { x: 220.1, y: 170.3 }, displays);
    const last = win.calls.at(-1);
    expect(Number.isInteger(last?.x)).toBe(true);
    expect(Number.isInteger(last?.y)).toBe(true);
  });
});
