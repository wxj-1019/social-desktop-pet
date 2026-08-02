/**
 * 星屿（StarIsle）—— 原创分层 SVG 星尾狐猫。纯程序绘制，无任何外链图片 /
 * Live2D / 像素素材。分层分组通过 data-part 唯一标识（Task 9 命中区域、
 * Task 11 状态机接入均以此为锚点）；CSS 动画类由 data-motion / data-speaking
 * / data-expression / data-reduced-motion 驱动（见 styles.css）。
 *
 * 角色设定：蓝紫大耳星尾狐猫。外耳/身体/头 #cbdaf5 系浅蓝，内耳/刘海 #8199d5，
 * 瞳孔 #415277，额间暖黄光冠与尾端星 #ffe094，腮红 #f2aabd，嘴线 #795b77。
 */
import { renderToStaticMarkup } from 'react-dom/server';

import { DEFAULT_VISUAL_STATE, type StarIsleVisualState } from './pet-renderer.js';

export interface StarIsleVisualProps {
  /** 渲染状态；缺省时使用 DEFAULT_VISUAL_STATE（可脱离外部状态运行） */
  state?: StarIsleVisualState;
}

const COLORS = {
  outerEar: '#7188c8',
  fur: '#cbdaf5',
  furDeep: '#b7c9ea',
  innerEar: '#8199d5',
  pupil: '#415277',
  star: '#ffe094',
  blush: '#f2aabd',
  mouth: '#795b77',
} as const;

const STROKE = { width: 2, color: COLORS.furDeep } as const;

export function StarIsleVisual({ state = DEFAULT_VISUAL_STATE }: StarIsleVisualProps) {
  const { motion, expression, speaking, reducedMotion } = state;
  return (
    <svg
      className="star-isle"
      viewBox="0 0 320 380"
      preserveAspectRatio="xMidYMax meet"
      role="img"
      aria-label="星尾狐猫星屿"
      data-motion={motion}
      data-expression={expression}
      data-speaking={speaking ? 'true' : 'false'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
    >
      <defs>
        <radialGradient id="star-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff8cf" stopOpacity="1" />
          <stop offset="60%" stopColor="#ffe094" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffe094" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 大尾巴：从身体左下翘起，弧线回卷，尾端缀星 */}
      <g data-part="tail" data-hit="tail" className="star-isle__tail">
        <path
          d="M 96 248 C 40 242 22 192 48 122 C 62 140 88 180 102 222 Z"
          fill={COLORS.fur}
          stroke={STROKE.color}
          strokeWidth={STROKE.width}
        />
        <g data-part="tail-star" className="star-isle__tail-star">
          <circle cx="48" cy="120" r="26" fill="url(#star-glow)" />
          <path
            d="M 48 108 L 53 115 L 60 120 L 53 125 L 48 132 L 43 125 L 36 120 L 43 115 Z"
            fill={COLORS.star}
          />
        </g>
        {/* 透明命中区（有盒模型，供点击/双击；不参与视觉） */}
        <rect data-hit-rect x="22" y="100" width="88" height="160" rx="20" />
      </g>

      {/* 圆润身体 + 后足 */}
      <g data-part="body" data-hit="body" className="star-isle__body">
        <ellipse
          cx="140"
          cy="240"
          rx="54"
          ry="46"
          fill={COLORS.fur}
          stroke={STROKE.color}
          strokeWidth={STROKE.width}
        />
        <ellipse cx="140" cy="252" rx="32" ry="24" fill="#e4edfc" />
        <ellipse
          cx="98"
          cy="284"
          rx="16"
          ry="11"
          fill={COLORS.fur}
          stroke={STROKE.color}
          strokeWidth={STROKE.width}
        />
        <ellipse
          cx="182"
          cy="284"
          rx="16"
          ry="11"
          fill={COLORS.fur}
          stroke={STROKE.color}
          strokeWidth={STROKE.width}
        />
        {/* 透明命中区（身体 + 前肢范围） */}
        <rect data-hit-rect x="86" y="194" width="108" height="97" rx="24" />
      </g>

      {/* 头：浅蓝圆润头 + 双耳（在头部组内，随头部动画联动）+ 额间刘海 + 光冠 + 五官 */}
      <g data-part="head" data-hit="head" className="star-isle__head">
        {/* 蓝紫大耳 + 浅色内耳（头子组：低头/呼吸/惊讶时跟随头部） */}
        <g data-part="ear-left" className="star-isle__ear star-isle__ear-left">
          <path
            d="M 98 110 C 92 70 102 38 116 32 C 132 42 142 66 146 100 C 128 114 108 118 98 110 Z"
            fill={COLORS.outerEar}
            stroke={STROKE.color}
            strokeWidth={STROKE.width}
            strokeLinejoin="round"
          />
          <path
            d="M 106 96 C 104 72 110 50 118 46 C 128 54 134 72 137 92 C 124 102 112 104 106 96 Z"
            fill={COLORS.innerEar}
          />
        </g>
        <g data-part="ear-right" className="star-isle__ear star-isle__ear-right">
          <path
            d="M 182 110 C 188 70 178 38 164 32 C 148 42 138 66 134 100 C 152 114 172 118 182 110 Z"
            fill={COLORS.outerEar}
            stroke={STROKE.color}
            strokeWidth={STROKE.width}
            strokeLinejoin="round"
          />
          <path
            d="M 174 96 C 176 72 170 50 162 46 C 152 54 146 72 143 92 C 156 102 168 104 174 96 Z"
            fill={COLORS.innerEar}
          />
        </g>
        <ellipse
          cx="140"
          cy="158"
          rx="64"
          ry="58"
          fill={COLORS.fur}
          stroke={STROKE.color}
          strokeWidth={STROKE.width}
        />
        {/* 刘海 */}
        <path
          className="star-isle__bangs"
          d="M 86 120 C 86 100 98 84 114 82 C 122 94 126 88 134 82 C 142 76 156 76 162 84 C 172 94 174 108 174 120 C 160 112 148 118 138 120 C 126 118 108 114 86 120 Z"
          fill={COLORS.innerEar}
        />
        {/* 额间光冠 */}
        <g data-part="crown" className="star-isle__crown">
          <circle cx="140" cy="106" r="14" fill="url(#star-glow)" />
          <path
            d="M 140 94 L 145 101 L 152 106 L 145 111 L 140 118 L 135 111 L 128 106 L 135 101 Z"
            fill={COLORS.star}
          />
        </g>
        {/* 睁眼：眼白 + 瞳孔 + 白色高光 */}
        <g className="star-isle__eye star-isle__eye-open star-isle__eye-open-left">
          <ellipse cx="112" cy="158" rx="13" ry="15" fill="#ffffff" />
          <ellipse
            className="star-isle__pupil"
            cx="113"
            cy="160"
            rx="6.2"
            ry="7.6"
            fill={COLORS.pupil}
          />
          <circle cx="109.5" cy="155" r="2.6" fill="#ffffff" />
        </g>
        <g className="star-isle__eye star-isle__eye-open star-isle__eye-open-right">
          <ellipse cx="168" cy="158" rx="13" ry="15" fill="#ffffff" />
          <ellipse
            className="star-isle__pupil"
            cx="167"
            cy="160"
            rx="6.2"
            ry="7.6"
            fill={COLORS.pupil}
          />
          <circle cx="170.5" cy="155" r="2.6" fill="#ffffff" />
        </g>
        {/* 闭眼弧线（happy/sad/shy 时显示；sad 由 CSS 翻转向下） */}
        <g className="star-isle__eye star-isle__eye-closed star-isle__eye-closed-left">
          <path
            d="M 103 161 Q 112 150 121 161"
            stroke={COLORS.pupil}
            strokeWidth="3.2"
            fill="none"
            strokeLinecap="round"
          />
        </g>
        <g className="star-isle__eye star-isle__eye-closed star-isle__eye-closed-right">
          <path
            d="M 177 161 Q 168 150 159 161"
            stroke={COLORS.pupil}
            strokeWidth="3.2"
            fill="none"
            strokeLinecap="round"
          />
        </g>
        {/* 腮红 */}
        <ellipse
          className="star-isle__cheek star-isle__cheek-left"
          cx="98"
          cy="178"
          rx="11"
          ry="6.5"
          fill={COLORS.blush}
          opacity="0.5"
        />
        <ellipse
          className="star-isle__cheek star-isle__cheek-right"
          cx="182"
          cy="178"
          rx="11"
          ry="6.5"
          fill={COLORS.blush}
          opacity="0.5"
        />
        {/* 鼻 + 嘴（w 嘴型 + 说话时张开的嘴） */}
        <ellipse
          className="star-isle__nose"
          cx="140"
          cy="181"
          rx="3.4"
          ry="2.7"
          fill={COLORS.mouth}
        />
        <path
          className="star-isle__mouth"
          d="M 130 187 Q 135 193 140 187 Q 145 193 150 187"
          stroke={COLORS.mouth}
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
        />
        <ellipse
          className="star-isle__mouth-open"
          cx="140"
          cy="191"
          rx="7"
          ry="4"
          fill={COLORS.mouth}
        />
        {/* 透明命中区（头部范围，含耳朵根部） */}
        <rect data-hit-rect x="72" y="96" width="136" height="124" rx="32" />
      </g>

      {/* 前肢（与后足同一地平线 cy=284） */}
      <g data-part="paw-left" className="star-isle__paw star-isle__paw-left">
        <ellipse
          cx="115"
          cy="284"
          rx="17"
          ry="13"
          fill={COLORS.fur}
          stroke={STROKE.color}
          strokeWidth={STROKE.width}
        />
      </g>
      <g data-part="paw-right" className="star-isle__paw star-isle__paw-right">
        <ellipse
          cx="165"
          cy="284"
          rx="17"
          ry="13"
          fill={COLORS.fur}
          stroke={STROKE.color}
          strokeWidth={STROKE.width}
        />
      </g>
    </svg>
  );
}

/** 静态渲染能力：无 DOM / 无动画环境（SSR、fallback、测试）也可见 */
export function renderStaticStarIsle(state: StarIsleVisualState = DEFAULT_VISUAL_STATE): string {
  return renderToStaticMarkup(<StarIsleVisual state={state} />);
}
