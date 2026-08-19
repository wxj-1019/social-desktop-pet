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
 * 睡眠唤醒：单击时若 visualState.motion==='sleep'，直接调用 renderer.playMotion('touch')，
 * 触发 image renderer 的 comingFromSleep 分支：伸懒腰 500ms 过渡 → 目标动作。
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

/** 桌宠画布基准尺寸（与 Main 侧 PET_WINDOW_SIZE 240×260 对应）：
 *  桌宠本体渲染区域 = 基准 × 用户缩放档位，始终锚定窗口右下角。
 *  环形菜单展开时窗口会被临时扩到 ≥ 基准（Main 侧 setMenuCanvas），
 *  扩出的空间全部在左/上 —— 桌宠屏幕位置不动，菜单画布完整可见。 */
const PET_CANVAS_BASE = { width: 240, height: 260 };

/** 命中区 → 交互指令（data-hit 属性值即此枚举） */
const HIT_INTERACTION: Record<HitPart, PetInteraction['kind']> = {
  head: 'head_touch',
  body: 'body_touch',
  tail: 'tail_touch',
};

/** 环形菜单交互面（SAO / classic 共用）：菜单内点击不进入拖拽手势流。
 *  指针捕获会把后续 click 重定向到根容器，吞掉菜单按钮 onClick；
 *  f4b9a5a 只修了 SAO，classic（.classic-radial-overlay）同源漏修。 */
export function isRadialMenuElement(target: EventTarget | null): boolean {
  return Boolean(
    (target as Element | null)?.closest?.('.sao-radial-overlay, .classic-radial-overlay'),
  );
}

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
  const { snapshot, profile, visualState, bubbleText, renderer } = usePetRuntime(
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
  /** 连续点击计数：2秒内点击>=3次触发"生气" */
  const rapidClickCountRef = useRef<number>(0);
  const rapidClickResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      void renderer.playMotion('idle');
      window.pet?.petRuntime?.chatEvent({
        phase: 'done',
        source: 'local_chat',
        output: { dialogue: '', emotion: 'warm', actionIntent: 'idle', intensity: 1 },
      });
    }
    gestureRef.current = { start: null, hit: null, dragging: false, bubbleHit: false };
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // 环形菜单（SAO/classic）内的点击不进入拖拽手势：指针捕获会把后续 click
    // 重定向到本容器，吞掉菜单按钮的 onClick（f4b9a5a 曾修 SAO，classic 同源漏修）。
    if (isRadialMenuElement(e.target)) return;
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
        const deltaY = sample.y - gesture.start.y;
        if (deltaY < 0) {
          void renderer.playMotion('dragged');
        } else {
          runtime.interaction({ kind: 'tail_touch' });
        }
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
        // 睡眠中单击先唤醒：走 playMotion('touch')，让 image renderer 的
        // comingFromSleep 分支播 500ms 伸懒腰过渡，再切到 touch（点击反馈）。
        if (visualState.motion === 'sleep') {
          void renderer.playMotion('touch');
        } else {
          // 连续3次点击（2秒窗口）触发生气
          if (rapidClickResetTimerRef.current !== null) {
            clearTimeout(rapidClickResetTimerRef.current);
          }
          rapidClickCountRef.current += 1;
          rapidClickResetTimerRef.current = setTimeout(() => {
            rapidClickCountRef.current = 0;
            rapidClickResetTimerRef.current = null;
          }, 2000);

          if (rapidClickCountRef.current >= 3) {
            rapidClickCountRef.current = 0;
            if (rapidClickResetTimerRef.current !== null) {
              clearTimeout(rapidClickResetTimerRef.current);
              rapidClickResetTimerRef.current = null;
            }
            // intensity=3 表示"生气"——image-pet-renderer 会识别并加 _imageAngry 标记
            void renderer.playMotion('sad', 3);
          } else {
            runtime.interaction({ kind: HIT_INTERACTION[gesture.hit] });
          }
        }
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

  // 桌宠画布尺寸 = 基准 × 缩放档位（菜单展开扩窗时窗口变大、画布不变；
  // resize 时重拉 scale——用户可能在菜单开着时经设置页/托盘调了大小档位）
  const [petScale, setPetScale] = useState(1);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      // 可选链贯穿整条调用链：window.pet 缺失（测试/非 Electron）时静默跳过
      void window.pet
        ?.getPetScale()
        .then((scale) => {
          if (alive && Number.isFinite(scale)) setPetScale(scale);
        })
        .catch(() => undefined);
    };
    refresh();
    window.addEventListener('resize', refresh);
    return () => {
      alive = false;
      window.removeEventListener('resize', refresh);
    };
  }, []);

  // 环形菜单画布：菜单展开期间经 Main 把窗口临时扩到 ≥240×260 基准（右下锚定，
  // 桌宠屏幕位置不动），菜单恒用基准几何 —— 任何缩放档位（0.5–2.0）下都完整
  // 可见，不再被窗口边缘截断。非 Electron（测试）环境静默跳过。
  useEffect(() => {
    window.pet?.petRuntime.setMenuCanvas(saoOpen);
  }, [saoOpen]);
  // 卸载兜底（角色切换重建窗/进程退出）：菜单还开着时收起画布，避免扩窗残留
  useEffect(() => () => window.pet?.petRuntime.setMenuCanvas(false), []);

  // 穿透开启后整窗点击都会穿过窗口：留在屏幕上的环形菜单无法被点击关闭
  //（SAO/设置页/托盘任一入口切换穿透都会经运行时快照收敛到这里）→ 立即收起菜单。
  const passThrough = snapshot?.passThrough ?? false;
  useEffect(() => {
    if (passThrough) setSaoOpen(false);
  }, [passThrough]);

  const switchMenuStyle = (style: 'sao' | 'classic') => {
    void window.pet?.petProfile?.get().then((profile) => {
      if (profile.menuStyle === style) return;
      void window.pet?.petProfile?.set({ ...profile, menuStyle: style });
    });
    setSaoOpen(false);
  };

  const handleContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
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
      {/* 桌宠画布：基准 × 缩放档位、锚定窗口右下角。菜单展开扩窗时窗口变大、
          画布不变 —— 桌宠屏幕位置不动；菜单画布（240×260 基准）与本画布右下对齐 */}
      <div
        className="pet-canvas"
        style={{
          width: Math.round(PET_CANVAS_BASE.width * petScale),
          height: Math.round(PET_CANVAS_BASE.height * petScale),
        }}
      >
        <PetVisualBoundary fallback={<FallbackComponent />}>
          <VisualComponent state={visualState} />
        </PetVisualBoundary>
        {profile?.bubbleEnabled ? <PetBubble text={bubbleText} /> : null}
        {landingVisible ? <div className="pet-landing-base" aria-hidden="true" /> : null}
      </div>
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
