/**
 * 星屿直连面指针交互纯函数 —— Task 9。
 *
 * classifyPointer 用「终点位移 + 时长 + 与上次点击的时间间隔」把一次按下-抬起
 * 分类为 click / drag / double_click；createDragMoveScheduler 用 requestAnimationFrame
 * 对拖拽 move 采样做每帧一次的最新值节流（可注入 raf/caf 便于单测）。
 */

/** 一次指针采样（屏幕坐标，CSS px；at 为相对时间原点毫秒） */
export interface PointerSample {
  x: number;
  y: number;
  at: number;
}

export type PointerGestureKind = 'click' | 'drag' | 'double_click';

/** 判定拖动的最小位移（CSS px，含临界值） */
export const DRAG_THRESHOLD_PX = 6;

/** 单击/双击的时间窗（ms） */
export const DOUBLE_CLICK_WINDOW_MS = 320;

/** 判定双击的最长按下时长（ms） */
export const MAX_PRESS_DURATION_MS = 320;

/**
 * 分类一次指针手势：
 * - 终点与起点欧氏距离 >= 6 → drag（移动就是拖动，不再考虑点击）
 * - 否则按下时长 <= 320ms 且距上次点击（previousClickAt）<= 320ms → double_click
 * - 否则 → click
 */
export function classifyPointer(args: {
  start: PointerSample;
  end: PointerSample;
  previousClickAt: number | null;
}): PointerGestureKind {
  const distance = Math.hypot(args.end.x - args.start.x, args.end.y - args.start.y);
  if (distance >= DRAG_THRESHOLD_PX) return 'drag';

  const duration = args.end.at - args.start.at;
  const gapFromPrevious = args.previousClickAt === null ? null : args.end.at - args.previousClickAt;
  if (
    duration <= MAX_PRESS_DURATION_MS &&
    gapFromPrevious !== null &&
    gapFromPrevious <= DOUBLE_CLICK_WINDOW_MS
  ) {
    return 'double_click';
  }
  return 'click';
}

export interface DragMoveScheduler {
  /** 记录最新待发送点；同一帧内多次 push 只保留最后一次 */
  push(point: { x: number; y: number }): void;
  /** 取消未发送的帧并清空待发送点（幂等） */
  cancel(): void;
}

/**
 * rAF 节流的拖拽 move 发送器：每帧最多 send 一次，发送的是该帧内最新一点。
 * raf/caf 默认取全局 requestAnimationFrame / cancelAnimationFrame，可注入以便单测。
 */
export function createDragMoveScheduler(
  send: (point: { x: number; y: number }) => void,
  raf: (cb: () => void) => number = requestAnimationFrame,
  caf: (handle: number) => void = cancelAnimationFrame,
): DragMoveScheduler {
  let rafId: number | null = null;
  let pending: { x: number; y: number } | null = null;

  return {
    push(point) {
      pending = point;
      if (rafId === null) {
        rafId = raf(() => {
          rafId = null;
          const current = pending;
          pending = null;
          if (current) send(current);
        });
      }
    },
    cancel() {
      if (rafId !== null) {
        caf(rafId);
        rafId = null;
      }
      pending = null;
    },
  };
}
