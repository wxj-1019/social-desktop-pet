/**
 * PetWanderController —— Main 进程桌面自主移动控制器。
 *
 * PetRuntimeController 只决定何时处于 WALKING；本控制器独占 BrowserWindow
 * 坐标副作用，以固定帧率水平移动、在工作区边缘转向，并在停止时持久化一次位置。
 */
import type { PetFacing, PetVisualCommand } from '@pet/protocol';

import { clampPetWindowToDisplays, type DisplayLike } from './display-controller.js';

const WANDER_FRAME_MS = 33;
const WANDER_SPEED_PX_PER_SECOND = 54;

export interface WanderWindowPort {
  getBounds(): { x: number; y: number; width: number; height: number };
  setPosition(x: number, y: number): void;
}

export interface PetWanderControllerOptions {
  getWindow: () => WanderWindowPort | null;
  getDisplays: () => DisplayLike[];
  emitVisual: (command: PetVisualCommand) => void;
  onPositionChanged?: () => void;
  onError?: (error: unknown) => void;
  random?: () => number;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
}

export class PetWanderController {
  private readonly options: PetWanderControllerOptions;
  private readonly random: () => number;
  private readonly setIntervalFn: typeof globalThis.setInterval;
  private readonly clearIntervalFn: typeof globalThis.clearInterval;
  private interval: ReturnType<typeof globalThis.setInterval> | null = null;
  private facing: PetFacing = 'right';
  private exactX = 0;
  private moved = false;

  constructor(options: PetWanderControllerOptions) {
    this.options = options;
    this.random = options.random ?? Math.random;
    this.setIntervalFn = options.setInterval ?? globalThis.setInterval;
    this.clearIntervalFn = options.clearInterval ?? globalThis.clearInterval;
  }

  get isActive(): boolean {
    return this.interval !== null;
  }

  start(): void {
    if (this.interval !== null) return;
    const win = this.options.getWindow();
    if (!win || this.options.getDisplays().length === 0) return;

    try {
      this.exactX = win.getBounds().x;
    } catch (error) {
      this.options.onError?.(error);
      return;
    }
    this.moved = false;
    this.setFacing(this.random() < 0.5 ? 'left' : 'right');
    this.interval = this.setIntervalFn(() => this.tick(), WANDER_FRAME_MS);
  }

  stop(): void {
    if (this.interval === null) return;
    this.clearIntervalFn(this.interval);
    this.interval = null;
    const shouldPersist = this.moved;
    this.moved = false;
    if (shouldPersist) this.options.onPositionChanged?.();
  }

  private tick(): void {
    const win = this.options.getWindow();
    const displays = this.options.getDisplays();
    if (!win || displays.length === 0) {
      this.stop();
      return;
    }

    try {
      const bounds = win.getBounds();
      const step = (WANDER_SPEED_PX_PER_SECOND * WANDER_FRAME_MS) / 1000;
      let targetX = this.exactX + (this.facing === 'right' ? step : -step);
      let target = clampPetWindowToDisplays({ x: targetX, y: bounds.y }, displays, {
        width: bounds.width,
        height: bounds.height,
      });

      if (Math.abs(target.x - targetX) > Number.EPSILON) {
        this.setFacing(this.facing === 'right' ? 'left' : 'right');
        targetX = bounds.x + (this.facing === 'right' ? step : -step);
        target = clampPetWindowToDisplays({ x: targetX, y: bounds.y }, displays, {
          width: bounds.width,
          height: bounds.height,
        });
      }

      this.exactX = target.x;
      const nextX = Math.round(target.x);
      const nextY = Math.round(target.y);
      if (nextX === bounds.x && nextY === bounds.y) return;
      win.setPosition(nextX, nextY);
      this.moved = true;
    } catch (error) {
      this.options.onError?.(error);
      this.stop();
    }
  }

  private setFacing(facing: PetFacing): void {
    if (this.facing === facing && this.interval !== null) return;
    this.facing = facing;
    this.options.emitVisual({ type: 'facing', facing });
  }
}
