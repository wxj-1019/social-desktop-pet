/**
 * ImageVisual —— 奶油小猫（cream-kitten）伪3D 图片状态角色。
 *
 * 逐帧动画架构（与 SpritesheetVisual 同构）：
 * - rAF 帧循环按 fps 推进帧索引（多帧动作如 running）
 * - 单帧动作（idle/happy/...）rAF 不启动，等同静止，CSS 动画继续提供形变
 * - reducedMotion=true 停在首帧（与 SVG/spritesheet 同语义）
 * - 可选 `_imageForceFrame` 临时覆盖：用于眨眼（切到 blink 单帧）
 * - 可选 `_imageWaking` 标记：标记唤醒过渡中，挂伸懒腰 CSS 动画（配合 happy 帧）
 * - facing=left 时整体 scaleX(-1)
 * - 保留 data-hit="body" 命中区，PetExperience 的指针交互继续工作
 *
 * 资产经 Vite import 引入（dev server / prod asar 都走 CSP 'self' 源）。
 */
import type { PetExpression, PetFacing, PetMotion } from '@pet/protocol';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CREAM_KITTEN_FRAME_MAP,
  type CreamKittenFrame,
  frameSpecFor,
} from './image-frame-manifest.js';
import type { StarIsleVisualState } from './pet-renderer.js';

/** 预加载状态：'loaded' = 已就绪, 'error' = 加载失败 */
type PreloadStatus = 'loaded' | 'error';

/** 模块级预加载缓存 —— 组件挂载前所有帧图已在浏览器缓存中 */
const preloadCache = new Map<string, PreloadStatus>();

function preloadAllFrames(): void {
  const allUrls = new Set<string>();
  for (const spec of Object.values(CREAM_KITTEN_FRAME_MAP)) {
    for (const url of spec.frames) {
      allUrls.add(url);
    }
  }
  for (const url of allUrls) {
    if (preloadCache.has(url)) continue;
    const img = new Image();
    img.onload = () => preloadCache.set(url, 'loaded');
    img.onerror = () => preloadCache.set(url, 'error');
    img.src = url;
  }
}
preloadAllFrames();

export interface ImageVisualProps {
  /** 渲染状态；缺省时使用默认（与 StarIsleVisual 一致） */
  state?: StarIsleVisualState;
}

export interface CreamKittenAnimationRequest {
  motion: PetMotion;
  expression: PetExpression;
  speaking: boolean;
  facing: PetFacing;
}

export interface ResolvedCreamKittenAnimation {
  key: string;
  frame: CreamKittenFrame;
}

/**
 * 状态优先级：sleep/happy/sad/surprised/touch/walk > 说话 > 表情 > idle。
 * 此函数不看 `_imageForceFrame`（它在渲染入口处作为最后一步覆盖应用）。
 */
export function resolveCreamKittenAnimation(
  request: CreamKittenAnimationRequest,
): ResolvedCreamKittenAnimation {
  switch (request.motion) {
    case 'sleep':
      return { key: 'motion:sleep', frame: 'sleepy' };
    case 'happy':
    case 'wave':
      return { key: 'motion:happy', frame: 'happy' };
    case 'sad':
      return { key: 'motion:sad', frame: 'sad' };
    case 'dragged':
      return { key: 'motion:dragged', frame: 'dragged' };
    case 'surprised':
      return { key: 'motion:surprised', frame: 'dragged' };
    case 'touch':
      return { key: 'motion:touch', frame: 'hungry' };
    case 'walk':
      return { key: 'motion:walk', frame: 'running' };
    case 'sit':
      return { key: 'motion:sit', frame: 'sit' };
    default:
      break;
  }
  if (request.speaking) {
    return { key: 'motion:talk', frame: 'idle' };
  }
  switch (request.expression) {
    case 'happy':
    case 'shy':
      return { key: 'expression:happy', frame: 'happy' };
    case 'sad':
      return { key: 'expression:sad', frame: 'sad' };
    case 'surprised':
      return { key: 'expression:surprised', frame: 'dragged' };
    default:
      return { key: 'motion:idle', frame: 'idle' };
  }
}

export function ImageVisual({ state }: ImageVisualProps) {
  const {
    motion,
    expression,
    intensity,
    speaking,
    reducedMotion,
    facing,
    _imageForceFrame,
    _imageWaking,
    _imageTilt,
    _imageAngry,
  } = state ?? {
    motion: 'idle' as const,
    expression: 'warm' as const,
    intensity: 1 as const,
    speaking: false,
    reducedMotion: false,
    facing: 'right' as const,
    _imageForceFrame: undefined,
    _imageWaking: undefined,
    _imageTilt: undefined,
    _imageAngry: undefined,
  };

  // 生气模式下：显示张牙舞爪帧（dragged 帧表情比较"凶"）
  // 帧优先级：blink > angry > motion animation
  // Renderer ensures angry and blink don't conflict by clearing angry before setting blink
  const angryOverride = _imageAngry;
  const animation = resolveCreamKittenAnimation({ motion, expression, speaking, facing });
  const dataFrame =
    _imageForceFrame === 'blink' ? 'blink' : angryOverride ? 'dragged' : animation.frame;

  const spec = frameSpecFor(dataFrame);
  const totalFrames = spec.frames.length;
  const intervalMs = Math.round(1000 / spec.fps);

  // 当前帧索引（0-based）；motion/forceFrame 变化时重置为 0
  const [frame, setFrame] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  // 跟踪最后成功显示的 URL（当前帧未加载时回退到此）
  const displayedUrlRef = useRef<string>(spec.frames[0]!);

  useEffect(() => {
    // 动作切换 → 回到首帧（不同动作帧数不同，避免越界）
    setFrame(0);
    lastTickRef.current = 0;
    // 切换动作时更新 displayedUrlRef 为新 spec 的首帧
    if (spec.frames[0] && preloadCache.get(spec.frames[0]) === 'loaded') {
      displayedUrlRef.current = spec.frames[0];
    }

    // reducedMotion：不启动帧循环，停在首帧
    if (reducedMotion) return;
    // 单帧动作：rAF 无意义，跳过（CSS 动画继续提供形变）
    if (totalFrames <= 1) return;

    const tick = (now: number): void => {
      if (lastTickRef.current === 0) lastTickRef.current = now;
      if (now - lastTickRef.current >= intervalMs) {
        lastTickRef.current = now;
        setFrame((prev) => {
          const nextIdx = (prev + 1) % totalFrames;
          const nextUrl = spec.frames[nextIdx]!;
          if (preloadCache.get(nextUrl) === 'loaded') return nextIdx;
          return prev;
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [animation.key, _imageForceFrame, intervalMs, reducedMotion, totalFrames, spec.frames]);

  const currentUrl = spec.frames[frame % totalFrames]!;
  // 计算 safeSrc：若当前帧已加载则使用并更新 ref，否则回退到最后成功显示的 URL
  let safeSrc: string;
  if (preloadCache.get(currentUrl) === 'loaded') {
    safeSrc = currentUrl;
    displayedUrlRef.current = currentUrl;
  } else {
    safeSrc = displayedUrlRef.current;
  }

  return (
    <div
      className="image-pet"
      role="img"
      aria-label="奶油小猫"
      data-motion={motion}
      data-expression={expression}
      data-intensity={intensity}
      data-speaking={speaking ? 'true' : 'false'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-facing={facing}
      data-animation={animation.key}
      data-frame={frame}
      data-waking={_imageWaking ? 'true' : 'false'}
      data-tilt={_imageTilt ?? 'none'}
      data-angry={_imageAngry ? 'true' : 'false'}
      data-blinking={_imageForceFrame === 'blink' ? 'true' : 'false'}
      data-hit="body"
    >
      <div className="image-pet__flip">
        <img
          className="image-pet__img"
          src={safeSrc}
          alt=""
          aria-hidden="true"
          draggable={false}
          data-frame={dataFrame}
        />
        {/* emotion particles: hearts when happy, Zzz when sleeping, sweat when sad */}
        {(motion === 'happy' || motion === 'wave' || expression === 'happy') && (
          <span className="image-pet__particles image-pet__particles--hearts" aria-hidden="true">
            <span className="particle particle--heart" style={{ '--i': 0 } as CSSProperties} />
            <span className="particle particle--heart" style={{ '--i': 1 } as CSSProperties} />
            <span className="particle particle--heart" style={{ '--i': 2 } as CSSProperties} />
          </span>
        )}
        {motion === 'sleep' && (
          <span className="image-pet__particles image-pet__particles--zzz" aria-hidden="true">
            <span className="particle particle--z">Z</span>
            <span className="particle particle--z">z</span>
            <span className="particle particle--z">z</span>
          </span>
        )}
        {(motion === 'sad' || expression === 'sad') && (
          <span className="image-pet__particles image-pet__particles--sweat" aria-hidden="true">
            <span className="particle particle--sweat" />
          </span>
        )}
        {_imageAngry && (
          <span className="image-pet__particles image-pet__particles--angry" aria-hidden="true">
            <span className="particle particle--angry">💢</span>
          </span>
        )}
      </div>
    </div>
  );
}

/** 静态渲染能力：无 DOM / 无动画环境（SSR、fallback、测试）也可见 */
export function renderStaticCreamKitten(
  state: StarIsleVisualState = {
    motion: 'idle',
    expression: 'warm',
    intensity: 1,
    speaking: false,
    reducedMotion: true,
    facing: 'right',
  },
): string {
  return renderToStaticMarkup(<ImageVisual state={state} />);
}
