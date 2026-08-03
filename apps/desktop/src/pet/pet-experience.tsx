/**
 * PetExperience —— 星屿直接交互面（Task 9）。
 *
 * 组合 usePetRuntime 的视觉状态渲染 StarIsleVisual，叠加 PetBubble 气泡，
 * 并在根容器上绑定指针交互：
 * - 按下记录起点与 data-hit 命中区（head/body/tail）
 * - 位移 >= 6px 才启动 drag（dragStart + rAF 节流的 dragMove，up 时 dragEnd），
 *   避免单击误触发窗口移动
 * - 未达阈值的抬起由 classifyPointer 决定 click（按命中区发 interaction）或
 *   double_click（打开聊天面板）
 * - contextmenu → showContextMenu + preventDefault
 *
 * StarIsleVisual 渲染抛错时由 PetVisualBoundary 降级为 PetFallback（同样可交互）。
 * window.pet 缺失（非 Electron）时所有指针处理静默跳过。
 */
import type { PetInteraction } from '@pet/protocol';
import {
  Component,
  useRef,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { PetBubble } from './pet-bubble.js';
import { PetFallback } from './pet-fallback.js';
import type { StarIsleVisualState } from './pet-renderer.js';
import {
  classifyPointer,
  createDragMoveScheduler,
  type PointerSample,
} from './pointer-interaction.js';
import { StarIsleVisual } from './star-isle-visual.js';
import { usePetRuntime } from './use-pet-runtime.js';

type HitPart = 'head' | 'body' | 'tail';

/** 命中区 → 交互指令（data-hit 属性值即此枚举） */
const HIT_INTERACTION: Record<HitPart, PetInteraction['kind']> = {
  head: 'head_touch',
  body: 'body_touch',
  tail: 'tail_touch',
};

export interface PetExperienceProps {
  /** 主视觉组件；可注入抛出渲染错误的组件以测试降级路径 */
  VisualComponent?: ComponentType<{ state: StarIsleVisualState }>;
  /** 视觉降级组件 */
  FallbackComponent?: ComponentType;
}

export function PetExperience({
  VisualComponent = StarIsleVisual,
  FallbackComponent = PetFallback,
}: PetExperienceProps) {
  const { profile, visualState, bubbleText } = usePetRuntime();

  const gestureRef = useRef<{
    start: PointerSample | null;
    hit: HitPart | null;
    dragging: boolean;
  }>({ start: null, hit: null, dragging: false });
  const lastClickAtRef = useRef<number | null>(null);
  const schedulerRef = useRef<ReturnType<typeof createDragMoveScheduler> | null>(null);

  const screenSample = (e: {
    screenX: number;
    screenY: number;
    timeStamp: number;
  }): PointerSample | null => {
    const { screenX, screenY } = e;
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;
    return { x: screenX, y: screenY, at: e.timeStamp };
  };

  /** 结束进行中的拖动（dragEnd + 取消节流 + 复位手势） */
  const endActiveDrag = () => {
    const runtime = window.pet?.petRuntime;
    const gesture = gestureRef.current;
    if (gesture?.dragging && runtime) {
      runtime.dragEnd();
      schedulerRef.current?.cancel();
    }
    gestureRef.current = { start: null, hit: null, dragging: false };
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const runtime = window.pet?.petRuntime;
    if (!runtime) return;
    const sample = screenSample(e);
    if (!sample) return;
    const hit = (e.target as Element | null)
      ?.closest?.('[data-hit]')
      ?.getAttribute('data-hit') as HitPart | null;
    gestureRef.current = { start: sample, hit, dragging: false };
    // 指针捕获：光标甩出窗口后 pointermove/up 仍会回到本元素，
    // 避免松手丢失导致拖动卡死（jsdom 不支持时静默降级）
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 环境不支持指针捕获 */
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const runtime = window.pet?.petRuntime;
    if (!runtime) return;
    const gesture = gestureRef.current;
    if (!gesture?.start) return;
    // 自愈：拖动中按钮已松开（pointerup 因故丢失）→ 立即结束拖动
    if (gesture.dragging && e.buttons === 0) {
      endActiveDrag();
      return;
    }
    const sample = screenSample(e);
    if (!sample) return;
    if (!gesture.dragging) {
      const distance = Math.hypot(sample.x - gesture.start.x, sample.y - gesture.start.y);
      if (distance >= 6) {
        gesture.dragging = true;
        runtime.dragStart({ x: sample.x, y: sample.y });
        if (!schedulerRef.current) {
          schedulerRef.current = createDragMoveScheduler((point) => {
            const runtimeNow = window.pet?.petRuntime;
            if (runtimeNow) runtimeNow.dragMove({ x: point.x, y: point.y });
          });
        }
      }
    } else {
      schedulerRef.current?.push({ x: sample.x, y: sample.y });
    }
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const runtime = window.pet?.petRuntime;
    if (!runtime) return;
    const gesture = gestureRef.current;
    if (!gesture?.start) return;
    const sample = screenSample(e) ?? gesture.start;
    if (gesture.dragging) {
      endActiveDrag();
    } else {
      const kind = classifyPointer({
        start: gesture.start,
        end: sample,
        previousClickAt: lastClickAtRef.current,
      });
      if (kind === 'double_click') {
        window.pet?.panel?.open({ view: 'chat' });
      } else if (kind === 'click' && gesture.hit) {
        runtime.interaction({ kind: HIT_INTERACTION[gesture.hit] });
      }
      lastClickAtRef.current = sample.at;
      gestureRef.current = { start: null, hit: null, dragging: false };
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 未持有捕获时忽略 */
    }
  };

  const handlePointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    endActiveDrag();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 未持有捕获时忽略 */
    }
  };

  const handleContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    const runtime = window.pet?.petRuntime;
    if (!runtime) return;
    e.preventDefault();
    runtime.showContextMenu();
  };

  return (
    <div
      className="pet-experience"
      data-testid="pet-experience"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={handleContextMenu}
    >
      <PetVisualBoundary fallback={<FallbackComponent />}>
        <VisualComponent state={visualState} />
      </PetVisualBoundary>
      {profile?.bubbleEnabled ? <PetBubble text={bubbleText} /> : null}
    </div>
  );
}

interface PetVisualBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface PetVisualBoundaryState {
  hasError: boolean;
}

/** 视觉渲染错误边界：主视觉抛错时降级为可交互的静态轮廓 */
class PetVisualBoundary extends Component<PetVisualBoundaryProps, PetVisualBoundaryState> {
  override state: PetVisualBoundaryState = { hasError: false };

  static getDerivedStateFromError(): PetVisualBoundaryState {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}
