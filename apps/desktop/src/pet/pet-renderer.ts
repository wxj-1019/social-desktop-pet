/**
 * 视觉渲染状态 —— 各 renderer（SVG / spritesheet / image 等）统一产出、
 * UI 组件（StarIsleVisual / ImageVisual / SpritesheetVisual）统一消费的快照。
 *
 * 设计原则：
 * - PetRenderer 内部维护 StarIsleVisualState，任何 set 合并 patch 后回调 update(state)
 * - UI 组件（如 StarIsleVisual）只消费 StarIsleVisualState 渲染快照
 * - usePetRuntime hook 调用 PetRenderer 触发状态变更，Renderer 内部决定动画/过渡
 * - 不同渲染技术（SVG / spritesheet / image 等）各自实现 PetRenderer 做适配
 *
 * 协议映射（@pet/protocol → StarIsleVisualState）：
 * - motion   = PetMotion        → motion
 * - expression=PetExpression     → expression
 * - intensity= 归一化档位 1..3  → intensity（影响幅度）
 * - speaking = 是否播报中       → speaking
 * - reducedMotion=preferences.reducedMotion → reducedMotion
 * - facing   = 左右朝向          → facing
 *
 * 扩展字段（以下均为图片角色 image renderer 专用，其他 renderer 天然忽略，零侵入）：
 * - `_imageForceFrame`：临时强制覆盖到某张帧图，用于眨眼等场景（不改 motion/expression 语义）
 * - `_imageWaking`：标记"正在从 sleep 被唤醒"，用于挂伸懒腰过渡动画（与 happy 帧组合，500ms）
 */
import type { PetExpression, PetFacing, PetMotion } from '@pet/protocol';

/** 供视觉组件消费的完整渲染状态快照（各 renderer 统一产物） */
export interface StarIsleVisualState {
  motion: PetMotion;
  expression: PetExpression;
  /** 动作强度归一化后的档位 1..3（影响动画幅度） */
  intensity: 1 | 2 | 3;
  speaking: boolean;
  reducedMotion: boolean;
  facing: PetFacing;
  /**
   * 仅图片角色（ImageVisual）使用：临时强制覆盖到某张帧图。
   * 用于眨眼（idle 状态下用 blink 帧瞬间替换 idle 帧，不改变 motion/expression 语义），
   * 或者未来要临时切帧且不想污染 motion/expression 的场景。
   * SVG / spritesheet renderer 不使用该字段，保持 undefined 即可。
   */
  _imageForceFrame?: 'blink' | undefined;
  /**
   * 仅图片角色（ImageVisual）使用：标记"正在进行唤醒过渡"。
   * 过渡期间显示 happy 帧 + 伸懒腰 CSS 动画，500ms 后 commit 到最终 motion。
   * SVG / spritesheet renderer 不使用该字段，保持 undefined 即可。
   */
  _imageWaking?: boolean | undefined;
  /**
   * 仅图片角色（ImageVisual）使用：标记 idle 时的随机歪头方向。
   * 'left' = 向左歪头, 'right' = 向右歪头, undefined = 正常。
   * SVG / spritesheet renderer 不使用该字段。
   */
  _imageTilt?: 'left' | 'right' | undefined;
  /**
   * 仅图片角色（ImageVisual）使用：标记"生气模式"（连点3下触发，3秒自动恢复）。
   * 生气时显示张牙舞爪帧 + 生气抖动 + 💢愤怒符号。
   * SVG / spritesheet renderer 不使用该字段。
   */
  _imageAngry?: boolean | undefined;
}

export const DEFAULT_VISUAL_STATE: StarIsleVisualState = {
  motion: 'idle',
  expression: 'warm',
  intensity: 1,
  speaking: false,
  reducedMotion: false,
  facing: 'right',
  _imageForceFrame: undefined,
  _imageWaking: undefined,
  _imageTilt: undefined,
  _imageAngry: undefined,
};

/** 渲染适配层工厂契约 —— 与 usePetRuntime 接线 */
export interface PetRenderer {
  /** 播放一个动作（可选强度档位）；返回动作完成时 resolve */
  playMotion: (motion: PetMotion, intensity?: 1 | 2 | 3) => Promise<void>;
  /** 设置当前表情（如开心/害羞/惊讶……），立即作用 */
  setExpression: (expression: PetExpression) => void;
  /** 播报文案时开启/关闭播报口型，视觉上会做匹配动画 */
  setSpeaking: (active: boolean) => void;
  /** 左右朝向；有些角色会用 CSS 镜像或镜像帧 */
  setFacing: (facing: PetFacing) => void;
  /** 系统偏好"减少动作"开/关：开则停掉 CSS 循环动画、缩短动效时长 */
  setReducedMotion: (active: boolean) => void;
  /** 销毁，释放一切定时器、订阅、rAF */
  dispose: () => void;
}
