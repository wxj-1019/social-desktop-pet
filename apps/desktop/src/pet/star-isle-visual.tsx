/**
 * 星屿（StarIsle）—— 原创分层 SVG 星尾狐猫。纯程序绘制，无任何外链图片 /
 * Live2D / 像素素材。分层分组通过 data-part 唯一标识（Task 9 命中区域、
 * Task 11 状态机接入均以此为锚点）；CSS 动画类由 data-motion / data-speaking
 * / data-expression / data-reduced-motion / data-intensity 驱动（见 styles.css）。
 *
 * 角色设定：蓝紫大耳星尾狐猫。外耳/身体/头 #cbdaf5 系浅蓝，内耳/刘海 #8199d5，
 * 瞳孔 #415277，额间暖黄光冠与尾端星 #ffe094，腮红 #f2aabd，嘴线 #795b77。
 */
import { useId } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { DEFAULT_VISUAL_STATE, type StarIsleVisualState } from './pet-renderer.js';

export interface StarIsleVisualProps {
  /** 渲染状态；缺省时使用 DEFAULT_VISUAL_STATE（可脱离外部状态运行） */
  state?: StarIsleVisualState;
  /** full：完整角色（桌宠窗/空状态插图）；head：头部特写取景（面板头像，
   *  免去 CSS 负边距裁剪，直接按容器大小缩放） */
  variant?: 'full' | 'head';
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

export function StarIsleVisual({
  state = DEFAULT_VISUAL_STATE,
  variant = 'full',
}: StarIsleVisualProps) {
  const { motion, expression, intensity, speaking, reducedMotion } = state;
  // 渐变 ID 按实例唯一化：面板/桌宠多处复用同一 SVG 时避免 url(#…) 跨实例冲突
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const grad = {
    starGlow: `star-glow-${uid}`,
    fur: `fur-grad-${uid}`,
    tail: `tail-grad-${uid}`,
    halo: `halo-glow-${uid}`,
  } as const;
  // head 取景：构图框变换后的头部区域（含耳尖与下巴），居中方形裁切
  const viewBox = variant === 'head' ? '50 64 220 220' : '0 0 320 380';
  const aspect = variant === 'head' ? 'xMidYMid meet' : 'xMidYMax meet';
  return (
    <svg
      className={variant === 'head' ? 'star-isle star-isle--head' : 'star-isle'}
      viewBox={viewBox}
      preserveAspectRatio={aspect}
      role="img"
      aria-label="星尾狐猫星屿"
      data-motion={motion}
      data-expression={expression}
      data-intensity={intensity}
      data-speaking={speaking ? 'true' : 'false'}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
    >
      <defs>
        <radialGradient id={grad.starGlow} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff8cf" stopOpacity="1" />
          <stop offset="60%" stopColor="#ffe094" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffe094" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={grad.fur} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#e4edfc" />
          <stop offset="55%" stopColor="#cbdaf5" />
          <stop offset="100%" stopColor="#a9bce8" />
        </linearGradient>
        <linearGradient id={grad.tail} x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#dbe6fa" />
          <stop offset="60%" stopColor="#b7c9ea" />
          <stop offset="100%" stopColor="#8fa8dd" />
        </linearGradient>
        {/* 棉花糖主题：暖粉奶油光环（与面板 #FFF8FB/#B83F68 同族） */}
        <radialGradient id={grad.halo} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#f2aabd" stopOpacity="0.32" />
          <stop offset="55%" stopColor="#f6c8d8" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#fff0f5" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 构图框：放大 1.2 倍并下移，脚底精确贴到窗口底边（meet 缩放下脚距底 0px），
          头顶留出气泡区（此前角色只占窗口约 65%、底部悬空且偏左） */}
      <g className="star-isle__frame" transform="translate(-2 22) scale(1.2)">
        {/* 背后棉花糖光环（角色底层背景，不参与命中） */}
        <circle className="star-isle__halo" cx="140" cy="196" r="132" fill={`url(#${grad.halo})`} />
        <circle className="star-isle__halo" cx="140" cy="150" r="84" fill={`url(#${grad.halo})`} />

        {/* 全身骨架（rig）：walk 垂直 bob / happy 弹跳在此整体平移——避免各部件
            rotate+translateY 组合时旋转吃掉位移（头/四肢与身体分离的观感错位） */}
        <g className="star-isle__rig">
          {/* 大尾巴：从身体左下翘起，弧线回卷，尾端缀星；内腹浅色增加层次 */}
          <g data-part="tail" data-hit="tail" className="star-isle__tail">
            <path
              d="M 96 248 C 40 242 22 192 48 122 C 62 140 88 180 102 222 Z"
              fill={`url(#${grad.tail})`}
              stroke={STROKE.color}
              strokeWidth={STROKE.width}
            />
            <path
              data-part="tail-belly"
              d="M 96 246 C 66 240 52 208 60 158 C 74 176 90 204 96 230 Z"
              fill="#e4edfc"
            />
            <g data-part="tail-star" className="star-isle__tail-star">
              <circle cx="48" cy="120" r="26" fill={`url(#${grad.starGlow})`} />
              <path
                d="M 48 108 L 53 115 L 60 120 L 53 125 L 48 132 L 43 125 L 36 120 L 43 115 Z"
                fill={COLORS.star}
              />
            </g>
            {/* 透明命中区（有盒模型，供点击/双击；不参与视觉）。
                右边界收在 86：与身体命中区（x86 起）错开，避免点尾巴腹部误触 body */}
            <rect data-hit-rect x="22" y="100" width="64" height="160" rx="20" />
          </g>

          {/* 圆润身体（不含后足；后足独立成组，走路循环对角步态动画不参与 body 呼吸形变） */}
          <g data-part="body" data-hit="body" className="star-isle__body">
            <ellipse
              cx="140"
              cy="240"
              rx="54"
              ry="46"
              fill={`url(#${grad.fur})`}
              stroke={STROKE.color}
              strokeWidth={STROKE.width}
            />
            <ellipse cx="140" cy="252" rx="32" ry="24" fill="#e4edfc" />
            {/* 透明命中区（身体 + 前肢范围） */}
            <rect data-hit-rect x="86" y="194" width="108" height="97" rx="24" />
          </g>

          {/* 后足（独立组：走路循环对角步态动画；不参与 body 呼吸形变） */}
          <g data-part="foot-left" className="star-isle__foot star-isle__foot-left">
            <ellipse
              cx="98"
              cy="284"
              rx="16"
              ry="11"
              fill={COLORS.fur}
              stroke={STROKE.color}
              strokeWidth={STROKE.width}
            />
          </g>
          <g data-part="foot-right" className="star-isle__foot star-isle__foot-right">
            <ellipse
              cx="182"
              cy="284"
              rx="16"
              ry="11"
              fill={COLORS.fur}
              stroke={STROKE.color}
              strokeWidth={STROKE.width}
            />
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
              fill={`url(#${grad.fur})`}
              stroke={STROKE.color}
              strokeWidth={STROKE.width}
            />
            {/* 头顶柔和高光（刘海之下，增加立体感） */}
            <ellipse
              className="star-isle__headshine"
              cx="112"
              cy="126"
              rx="16"
              ry="10"
              fill="#ffffff"
              opacity="0.32"
            />
            {/* 刘海 */}
            <path
              className="star-isle__bangs"
              d="M 86 120 C 86 100 98 84 114 82 C 122 94 126 88 134 82 C 142 76 156 76 162 84 C 172 94 174 108 174 120 C 160 112 148 118 138 120 C 126 118 108 114 86 120 Z"
              fill={COLORS.innerEar}
            />
            {/* 额间光冠 */}
            <g data-part="crown" className="star-isle__crown">
              <circle cx="140" cy="106" r="14" fill={`url(#${grad.starGlow})`} />
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
        </g>

        {/* 环绕星光与尾巴星尘（装饰层：不参与命中，不含 data-part） */}
        <g>
          <path
            className="star-isle__sparkle"
            d="M 52 82 L 53.8 86.2 L 58 88 L 53.8 89.8 L 52 94 L 50.2 89.8 L 46 88 L 50.2 86.2 Z"
            fill={COLORS.star}
          />
          <path
            className="star-isle__sparkle"
            d="M 228 82 L 229.8 86.2 L 234 88 L 229.8 89.8 L 228 94 L 226.2 89.8 L 222 88 L 226.2 86.2 Z"
            fill={COLORS.blush}
          />
          <path
            className="star-isle__sparkle"
            d="M 240 166 L 241.8 170.2 L 246 172 L 241.8 173.8 L 240 178 L 238.2 173.8 L 234 172 L 238.2 170.2 Z"
            fill={COLORS.star}
          />
          <path
            className="star-isle__sparkle"
            d="M 30 166 L 31.8 170.2 L 36 172 L 31.8 173.8 L 30 178 L 28.2 173.8 L 24 172 L 28.2 170.2 Z"
            fill={COLORS.blush}
          />
          <circle
            className="star-isle__stardust"
            cx="66"
            cy="156"
            r="3.4"
            fill="#fff8cf"
            opacity="0.8"
          />
          <circle
            className="star-isle__stardust"
            cx="74"
            cy="196"
            r="2.6"
            fill="#f6c8d8"
            opacity="0.7"
          />
        </g>
      </g>
    </svg>
  );
}

/** 静态渲染能力：无 DOM / 无动画环境（SSR、fallback、测试）也可见 */
export function renderStaticStarIsle(state: StarIsleVisualState = DEFAULT_VISUAL_STATE): string {
  return renderToStaticMarkup(<StarIsleVisual state={state} />);
}
