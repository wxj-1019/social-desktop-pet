/**
 * PetDragController —— 桌宠窗口安全拖动。
 *
 * 不 import BrowserWindow：窗口通过最小端口（getBounds/setPosition）注入，
 * 便于纯单测。拖动期间把窗口左上角限制在显示器可见区域内（至少露出 1/4），
 * 复用 DisplayController.clampPetWindowToDisplays 的规则，防止把宠物拖丢。
 */

import { clampPetWindowToDisplays, type DisplayLike } from './display-controller.js';

/** 窗口最小端口（BrowserWindow 亦满足此形态） */
export interface DragWindowPort {
  getBounds(): { x: number; y: number; width: number; height: number };
  setPosition(x: number, y: number): void;
}

export interface DragPointer {
  x: number;
  y: number;
}

/** 拖动会话：记录按下瞬间鼠标与窗口左上角的偏移（屏幕指针与窗口坐标同坐标系） */
interface DragSession {
  offsetX: number;
  offsetY: number;
}

export class PetDragController {
  private session: DragSession | null = null;

  /** 是否正在拖动中 */
  get isDragging(): boolean {
    return this.session !== null;
  }

  /** 按下：记录鼠标相对窗口左上角的偏移，之后 move 按指针位置 + 偏移移动窗口 */
  start(win: DragWindowPort, pointer: DragPointer): void {
    const bounds = win.getBounds();
    this.session = {
      offsetX: bounds.x - pointer.x,
      offsetY: bounds.y - pointer.y,
    };
  }

  /** 移动：目标 = 指针 + 偏移 → 夹进可见区域 → round 后 setPosition */
  move(win: DragWindowPort, pointer: DragPointer, displays: DisplayLike[]): void {
    if (!this.session) return;
    const targetX = pointer.x + this.session.offsetX;
    const targetY = pointer.y + this.session.offsetY;
    const bounds = win.getBounds();
    const { x, y } = clampPetWindowToDisplays({ x: targetX, y: targetY }, displays, {
      width: bounds.width,
      height: bounds.height,
    });
    win.setPosition(Math.round(x), Math.round(y));
  }

  /** 松手：结束拖动并清理会话 */
  end(): void {
    this.session = null;
  }

  /** 取消拖动（如窗口被穿透/隐藏）：清理会话，之后的 move 被忽略 */
  cancel(): void {
    this.session = null;
  }
}
