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
 * - contextmenu → 切换 SAO 左侧环形菜单 + preventDefault
 *
 * StarIsleVisual 渲染抛错时由 PetVisualBoundary 降级为 PetFallback（同样可交互）。
 * window.pet 缺失（非 Electron）时所有指针处理静默跳过。
 */
import {
  Component,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import type { PetInteraction, PetRuntimeSnapshot } from '@pet/protocol';

import { ClassicMenu } from './classic-menu.js';
import { PetBubble } from './pet-bubble.js';
import { PetFallback } from './pet-fallback.js';
import type { StarIsleVisualState } from './pet-renderer.js';
import {
  classifyPointer,
  createDragMoveScheduler,
  type PointerSample,
} from './pointer-interaction.js';
import { SaoMenu } from './sao-menu.js';
import { StarIsleVisual } from './star-isle-visual.js';
import { usePetRuntime, type RendererFactory } from './use-pet-runtime.js';

type HitPart = 'head' | 'body' | 'tail';

/** 命中区 → 交互指令（data-hit 属性值即此枚举） */
const HIT_INTERACTION: Record<HitPart, PetInteraction['kind']> = {
  head: 'head_touch',
  body: 'body_touch',
  tail: 'tail_touch',
};

export interface PetExperienceProps {
  /** 主视觉组件；可注入抛出渲染错误的组件以测试降级路径 */
  VisualComponent?: ComponentType<{ state?: StarIsleVisualState }>;
  /** 视觉降级组件 */
  FallbackComponent?: ComponentType;
  /** PetRenderer 工厂（皮肤注入；缺省 SVG 星屿） */
  rendererFactory?: RendererFactory;
  /** 角色名（onboarding 引导气泡自称用；缺省星屿） */
  petName?: string;
}

export function PetExperience({
  VisualComponent = StarIsleVisual,
  FallbackComponent = PetFallback,
  rendererFactory,
  petName,
}: PetExperienceProps) {
  const { snapshot, profile, visualState, bubbleText } = usePetRuntime(
    rendererFactory ? { rendererFactory, petName } : { petName },
  );

  const gestureRef = useRef<{
    start: PointerSample | null;
    hit: HitPart | null;
    dragging: boolean;
    /** 按下点在说话气泡上（抬起时点击气泡 → 直达聊天面板，缩短聊天路径） */
    bubbleHit: boolean;
  }>({ start: null, hit: null, dragging: false, bubbleHit: false });
  const lastClickAtRef = useRef<number | null>(null);
  const schedulerRef = useRef<ReturnType<typeof createDragMoveScheduler> | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const screenSample = (e: {
    screenX: number;
    screenY: number;
    timeStamp: number;
  }): PointerSample | null => {
    const { screenX, screenY } = e;
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;
    return { x: screenX, y: screenY, at: e.timeStamp };
  };

  /** 结束进行中的拖动（dragEnd + 取消节流 + 复位手势 + 落地回 idle） */
  const endActiveDrag = () => {
    const runtime = window.pet?.petRuntime;
    const gesture = gestureRef.current;
    if (gesture?.dragging && runtime) {
      runtime.dragEnd();
      schedulerRef.current?.cancel();
      setIsDragging(false);
      // 落地回常态：拖动时给了惊讶（shake_head），松手后经 chatEvent done 回 idle
      //（actionIntent 取 idle → 直接回基础动作，不播多余点头）
      window.pet?.petRuntime?.chatEvent({
        phase: 'done',
        source: 'local_chat',
        output: { dialogue: '', emotion: 'warm', actionIntent: 'idle', intensity: 1 },
      });
    }
    gestureRef.current = { start: null, hit: null, dragging: false, bubbleHit: false };
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // 手势/点击只认主键（左键）：右键交给 SAO 菜单（contextmenu），
    // 快速双击右键不得被分类为 double_click 弹出面板
    if (e.button !== 0) return;
    // SAO 菜单覆盖层内的交互交给按钮自己：这里若继续走手势并
    // setPointerCapture，Chromium 会把后续 click 全部重定向到根容器，
    // 菜单按钮的 onClick 永远不触发（jsdom 无捕获实现，单测发现不了）
    if ((e.target as Element | null)?.closest?.('.sao-radial-overlay')) return;
    const runtime = window.pet?.petRuntime;
    if (!runtime) return;
    const sample = screenSample(e);
    if (!sample) return;
    const hit = (e.target as Element | null)
      ?.closest?.('[data-hit]')
      ?.getAttribute('data-hit') as HitPart | null;
    const bubbleHit = Boolean((e.target as Element | null)?.closest?.('.pet-speech'));
    gestureRef.current = { start: sample, hit, dragging: false, bubbleHit };
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
        setIsDragging(true);
        // 拖动时先给惊讶表情（摇头）——用户看到"被拎起来了"；
        // 随后 dragStart 的 walk（persistent）会覆盖该瞬时动作
        runtime.interaction({ kind: 'tail_touch' });
        // Main 必须从真实按下点记录窗口偏移；随后立即补发越过阈值的当前点，
        // 否则首段 6px+ 位移会被吃掉，短拖拽也无法产生方向反馈。
        runtime.dragStart({ x: gesture.start.x, y: gesture.start.y });
        runtime.dragMove({ x: sample.x, y: sample.y });
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
    // 只处理主键抬起：左键拖拽中松开其它按钮不得提前终止手势
    if (e.button !== 0) return;
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
      } else if (kind === 'click' && gesture.bubbleHit) {
        // 点击气泡 → 直达聊天面板（比"双击身体"更短的聊天入口）
        window.pet?.panel?.open({ view: 'chat' });
      } else if (kind === 'click' && gesture.hit) {
        runtime.interaction({ kind: HIT_INTERACTION[gesture.hit] });
      }
      lastClickAtRef.current = sample.at;
      gestureRef.current = { start: null, hit: null, dragging: false, bubbleHit: false };
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

  const [saoOpen, setSaoOpen] = useState(false);
  /** 落岛开场：首次快照为 STARTING 时显示脚下底座，约 2.6s 后自动退出（帮用户定位桌宠） */
  const [landingVisible, setLandingVisible] = useState(false);

  // 穿透开启后整窗点击都会穿过窗口：留在屏幕上的环形菜单无法被点击关闭
  //（SAO/设置页/托盘任一入口切换穿透都会经运行时快照收敛到这里）→ 立即收起菜单。
  const passThrough = snapshot?.passThrough ?? false;
  useEffect(() => {
    if (passThrough) setSaoOpen(false);
  }, [passThrough]);

  /** 切换环形菜单 UI 风格（写档案 → onChanged 广播驱动重渲染；立即关闭菜单） */
  const switchMenuStyle = (style: 'sao' | 'classic') => {
    void window.pet?.petProfile?.get().then((profile) => {
      if (profile.menuStyle === style) return;
      void window.pet?.petProfile?.set({ ...profile, menuStyle: style });
    });
    setSaoOpen(false);
  };

  const handleContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    // 右键只切换 SAO 左侧环形菜单（原生菜单经其"控制 → 系统托盘"入口触达）
    e.preventDefault();
    setSaoOpen((prev) => !prev);
  };

  // 落岛开场时长：底座展示窗口（入场 250ms + 停留 + 退场 600ms ≈ 2.6s）
  const LANDING_BASE_MS = 2_600;
  useEffect(() => {
    if (!landingVisible) return;
    const timer = setTimeout(() => setLandingVisible(false), LANDING_BASE_MS);
    return () => clearTimeout(timer);
  }, [landingVisible]);
  // 首次快照为 STARTING（冷启动）→ 展示落岛底座；非冷启动（恢复/角色切换）不展示
  const prevStateRef = useRef<PetRuntimeSnapshot['state'] | null>(null);
  useEffect(() => {
    const state = snapshot?.state ?? null;
    if (state === 'STARTING' && prevStateRef.current === null && !landingVisible) {
      setLandingVisible(true);
    }
    prevStateRef.current = state;
  }, [snapshot, landingVisible]);

  return (
    <div
      className={isDragging ? 'pet-experience pet-dragging' : 'pet-experience'}
      data-testid="pet-experience"
      data-state={snapshot?.state ?? null}
      data-landing={landingVisible ? 'true' : null}
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
      {landingVisible ? <div className="pet-landing-base" aria-hidden="true" /> : null}
      {(profile?.menuStyle ?? 'sao') === 'classic' ? (
        <ClassicMenu
          isOpen={saoOpen}
          onClose={() => setSaoOpen(false)}
          dnd={snapshot?.dnd ?? profile?.dnd ?? false}
          passThrough={snapshot?.passThrough ?? false}
          onSwitchMenuStyle={() => switchMenuStyle('sao')}
        />
      ) : (
        <SaoMenu
          isOpen={saoOpen}
          onClose={() => setSaoOpen(false)}
          dnd={snapshot?.dnd ?? profile?.dnd ?? false}
          passThrough={snapshot?.passThrough ?? false}
          onSwitchMenuStyle={() => switchMenuStyle('classic')}
        />
      )}
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
