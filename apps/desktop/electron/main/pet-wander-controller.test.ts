import type { PetFacing, PetVisualCommand } from '@pet/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DisplayLike } from './display-controller.js';
import { PetWanderController, type WanderWindowPort } from './pet-wander-controller.js';

const displays: DisplayLike[] = [
  { id: 'primary', workArea: { x: 0, y: 0, width: 1000, height: 800 } },
];

function makeWindow(bounds = { x: 100, y: 500, width: 240, height: 260 }): WanderWindowPort {
  let current = { ...bounds };
  return {
    getBounds: vi.fn(() => ({ ...current })),
    setPosition: vi.fn((x: number, y: number) => {
      current = { ...current, x, y };
    }),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('PetWanderController（桌面自主移动）', () => {
  it('moves the Electron window horizontally and emits the matching facing direction', () => {
    vi.useFakeTimers();
    const win = makeWindow();
    const visuals: PetVisualCommand[] = [];
    const controller = new PetWanderController({
      getWindow: () => win,
      getDisplays: () => displays,
      emitVisual: (command) => visuals.push(command),
      random: () => 0.9,
    });

    controller.start();
    expect(controller.isActive).toBe(true);
    expect(visuals.at(-1)).toEqual({ type: 'facing', facing: 'right' });
    vi.advanceTimersByTime(1_000);
    expect(win.getBounds().x).toBeGreaterThan(100);
  });

  it('turns around at a work-area edge and never lets the window leave the display', () => {
    vi.useFakeTimers();
    const win = makeWindow({ x: 760, y: 500, width: 240, height: 260 });
    const facings: PetFacing[] = [];
    const controller = new PetWanderController({
      getWindow: () => win,
      getDisplays: () => displays,
      emitVisual: (command) => {
        if (command.type === 'facing') facings.push(command.facing);
      },
      random: () => 0.9,
    });

    controller.start();
    vi.advanceTimersByTime(100);
    expect(facings).toEqual(['right', 'left']);
    expect(win.getBounds().x).toBeLessThan(760);
    expect(win.getBounds().x).toBeGreaterThanOrEqual(0);
  });

  it('stop is idempotent, clears the timer and persists only after actual movement', () => {
    vi.useFakeTimers();
    const win = makeWindow();
    const onPositionChanged = vi.fn();
    const controller = new PetWanderController({
      getWindow: () => win,
      getDisplays: () => displays,
      emitVisual: vi.fn(),
      onPositionChanged,
      random: () => 0.9,
    });

    controller.start();
    vi.advanceTimersByTime(100);
    controller.stop();
    controller.stop();
    expect(controller.isActive).toBe(false);
    expect(onPositionChanged).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start without a live window or a display', () => {
    const controller = new PetWanderController({
      getWindow: () => null,
      getDisplays: () => [],
      emitVisual: vi.fn(),
    });
    controller.start();
    expect(controller.isActive).toBe(false);
  });
});
