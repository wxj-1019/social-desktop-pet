/**
 * SpritesheetVisual —— CodeNoNo spritesheet 角色的 React 渲染组件。
 *
 * 与 StarIsleVisual（SVG）并列，消费同一份 StarIsleVisualState：
 * - motion 驱动 rAF 帧循环（项目中首个 JS 帧动画循环）
 * - reducedMotion=true 时停在首帧（与 SVG 的 data-reduced-motion 语义一致）
 * - 保留 data-hit="body" 属性作为样式钩子与测试锚点；命中判定自阶段 C 起走
 *   manifest 几何区域（PetExperience 不再读取本属性）
 * - speaking 会切到 talk 动画，idle 时保留静态表情帧
 *
 * 渲染方案（视口裁剪）：
 * 外层 div overflow:hidden 作为"窗口"，内层 <img> 显示完整 spritesheet 原始尺寸
 * （1536×1872），通过 transform: translate() 偏移到当前帧 + scale 放大填满容器。
 * 这样每帧都能精确切出且按需缩放（192×208 帧放大到窗口 240×260）。
 */
import { useEffect, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import spritesheetUrl from '../assets/codenono/spritesheet.webp';

import type { StarIsleVisualState } from './pet-renderer.js';
import {
  FRAME_SIZE,
  SPRITESHEET_SIZE,
  frameCountForSpec,
  frameIntervalMsForSpec,
  frameOffsetForSpec,
  resolveSpritesheetAnimation,
} from './spritesheet-manifest.js';

export interface SpritesheetVisualProps {
  /** 渲染状态；缺省时使用默认（与 StarIsleVisual 一致） */
  state?: StarIsleVisualState;
}

/** 帧缩放倍数：单帧 192×208 × 0.9 ≈ 173×187，占窗口 240×260 约 70%，
 *  头顶留出气泡区，底部贴边但不撑满（比星屿略小，视觉更精致） */
const FRAME_SCALE = 0.9;

/** 视口尺寸 = 单帧原始尺寸 × 缩放（精确裁掉相邻帧，杜绝串台） */
const VIEWPORT_W = FRAME_SIZE.width * FRAME_SCALE; // 172.8
const VIEWPORT_H = FRAME_SIZE.height * FRAME_SCALE; // 187.2

export function SpritesheetVisual({ state }: SpritesheetVisualProps) {
  const { motion, expression, intensity, speaking, reducedMotion, facing } = state ?? {
    motion: 'idle' as const,
    expression: 'warm' as const,
    intensity: 1 as const,
    speaking: false,
    reducedMotion: false,
    facing: 'right' as const,
  };

  const animation = resolveSpritesheetAnimation({ motion, expression, speaking, facing });
  const totalFrames = frameCountForSpec(animation.spec);
  const intervalMs = frameIntervalMsForSpec(animation.spec);

  // 当前帧索引（0-based）；motion 变化时重置为 0
  const [frame, setFrame] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  useEffect(() => {
    // motion 切换 → 回到首帧（不同动作帧数不同，避免越界）
    setFrame(0);
    lastTickRef.current = 0;

    // reducedMotion：不启动帧循环，停在首帧（与 SVG data-reduced-motion 同语义）
    if (reducedMotion) return;

    const tick = (now: number): void => {
      if (lastTickRef.current === 0) lastTickRef.current = now;
      if (now - lastTickRef.current >= intervalMs) {
        lastTickRef.current = now;
        setFrame((prev) => (prev + 1) % totalFrames);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [animation.key, intervalMs, reducedMotion, totalFrames]);

  const offset = frameOffsetForSpec(animation.spec, frame);

  return (
    // 外层：撑满 pet-experience 容器，data-hit 样式钩子与测试锚点 + 状态属性
    <div
      className="spritesheet-pet"
      role="img"
      aria-label="CodeNoNo"
      data-motion={motion}
      data-expression={expression}
      data-intensity={intensity}
      data-speaking={speaking ? 'true' : 'false'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-facing={facing}
      data-animation={animation.key}
      data-frame={frame}
      data-hit="body"
    >
      {/* 视口：固定为单帧放大后的精确尺寸，overflow:hidden 裁掉所有相邻帧（杜绝串台） */}
      <div className="spritesheet-pet__viewport" style={{ width: VIEWPORT_W, height: VIEWPORT_H }}>
        <img
          className="spritesheet-pet__sheet"
          src={spritesheetUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{
            // 整图原始尺寸；scale 先于 translate（CSS 从右往左应用）：
            // 先在原始坐标系把目标帧 translate 到原点，再 scale 放大 → 帧精确对齐
            width: SPRITESHEET_SIZE.width,
            height: SPRITESHEET_SIZE.height,
            transform: `scale(${FRAME_SCALE}) translate(-${offset.x}px, -${offset.y}px)`,
            transformOrigin: '0 0',
            imageRendering: 'pixelated',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
}

/** 静态渲染能力：无 DOM / 无动画环境（SSR、fallback、测试）也可见 */
export function renderStaticSpritesheet(
  state: StarIsleVisualState = {
    motion: 'idle',
    expression: 'warm',
    intensity: 1,
    speaking: false,
    reducedMotion: true,
    facing: 'right',
  },
): string {
  return renderToStaticMarkup(<SpritesheetVisual state={state} />);
}
