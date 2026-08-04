/**
 * PetDragController —— 桌宠窗口安全拖动。
 *
 * 不 import BrowserWindow：窗口通过最小端口（getBounds/setPosition）注入，
 * 便于纯单测。拖动期间把窗口左上角限制在显示器可见区域内（至少露出 1/4），
 * 复用 DisplayController.clampPetWindowToDisplays 的规则，防止把宠物拖丢。
 *
 * Task 12：位置持久化触发点收敛到拖动结束（onDragEnd），不再依赖 BrowserWindow
 * 的 'moved' 事件（部分环境（如 RDP 会话）setPosition 不触发 move/moved 事件）。
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

export interface DragMovement {
  /** 本次实际窗口横向位移（已应用显示器边界约束） */
  deltaX: number;
  /** 本次实际窗口纵向位移（已应用显示器边界约束） */
  deltaY: number;
}

export interface PetDragControllerOptions {
  /** 拖动取得窗口位置所有权前触发（用于停止自主漫步，避免两个控制器竞态） */
  onDragStart?: () => void;
  /** 每次窗口实际移动后触发（供运行时按 deltaX 更新左右朝向） */
  onDragMove?: (movement: DragMovement) => void;
  /** 拖动结束回调（end() 时触发，携带最后一次指针点；供调用方持久化位置） */
  onDragEnd?: (pointer: DragPointer) => void;
  /** 活跃拖动被穿透/隐藏等外部事件取消时触发 */
  onDragCancel?: () => void;
}

/** 拖动会话：记录按下瞬间鼠标与窗口左上角的偏移（屏幕指针与窗口坐标同坐标系） */
interface DragSession {
  offsetX: number;
  offsetY: number;
  lastPointer: DragPointer;
}

export class PetDragController {
  private session: DragSession | null = null;
  private readonly options: PetDragControllerOptions;

  constructor(options: PetDragControllerOptions = {}) {
    this.options = options;
  }

  /** 是否正在拖动中 */
  get isDragging(): boolean {
    return this.session !== null;
  }

  /** 按下：记录鼠标相对窗口左上角的偏移，之后 move 按指针位置 + 偏移移动窗口 */
  start(win: DragWindowPort, pointer: DragPointer): void {
    this.options.onDragStart?.();
    const bounds = win.getBounds();
    this.session = {
      offsetX: bounds.x - pointer.x,
      offsetY: bounds.y - pointer.y,
      lastPointer: pointer,
    };
  }

  /** 移动：目标 = 指针 + 偏移 → 夹进可见区域 → round 后 setPosition */
  move(win: DragWindowPort, pointer: DragPointer, displays: DisplayLike[]): void {
    if (!this.session) return;
    this.session.lastPointer = pointer;
    const targetX = pointer.x + this.session.offsetX;
    const targetY = pointer.y + this.session.offsetY;
    const bounds = win.getBounds();
    const { x, y } = clampPetWindowToDisplays({ x: targetX, y: targetY }, displays, {
      width: bounds.width,
      height: bounds.height,
    });
    const nextX = Math.round(x);
    const nextY = Math.round(y);
    win.setPosition(nextX, nextY);
    const movement = { deltaX: nextX - bounds.x, deltaY: nextY - bounds.y };
    if (movement.deltaX !== 0 || movement.deltaY !== 0) {
      this.options.onDragMove?.(movement);
    }
  }

  /** 松手：通知 onDragEnd 并结束拖动、清理会话 */
  end(): void {
    const pointer = this.session?.lastPointer;
    this.session = null;
    if (pointer) this.options.onDragEnd?.(pointer);
  }

  /** 取消拖动（如窗口被穿透/隐藏）：清理会话，之后的 move 被忽略 */
  cancel(): void {
    const wasDragging = this.session !== null;
    this.session = null;
    if (wasDragging) this.options.onDragCancel?.();
  }
}
