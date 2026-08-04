/**
 * 桌宠渲染器契约 —— Task 3 计划欠账在此补齐。
 *
 * 与渲染技术解耦：Live2D（V-1 许可后）与原创 SVG（StarIsle）均可实现 PetRenderer，
 * 上层（PetRendererController / Task 9 命中区域 / Task 11 状态机 hook）只依赖此接口。
 */
import type { PetExpression, PetFacing, PetMotion } from '@pet/protocol';

/** 渲染器契约（渲染进程） */
export interface PetRenderer {
  /** 播放一个动作；实现立即反映状态并返回 resolved Promise（不阻塞调用方） */
  playMotion(motion: PetMotion, intensity: 1 | 2 | 3): Promise<void>;
  /** 切换表情 */
  setExpression(expression: PetExpression): void;
  /** 口型/说话态 */
  setSpeaking(active: boolean): void;
  /** 桌面水平朝向（自主移动转向时更新） */
  setFacing(facing: PetFacing): void;
  /** 动画降级（系统「减弱动态效果」偏好） */
  setReducedMotion(active: boolean): void;
  /** 释放渲染器资源；之后所有调用被忽略 */
  dispose(): void;
}

/** 星屿（StarIsle）原创 SVG 角色的纯渲染状态 —— React 组件据此绘制 */
export interface StarIsleVisualState {
  motion: PetMotion;
  expression: PetExpression;
  /** 动作强度归一化后的档位 1..3（影响动画幅度） */
  intensity: 1 | 2 | 3;
  speaking: boolean;
  reducedMotion: boolean;
  facing: PetFacing;
}

export const DEFAULT_VISUAL_STATE: StarIsleVisualState = {
  motion: 'idle',
  expression: 'warm',
  intensity: 1,
  speaking: false,
  reducedMotion: false,
  facing: 'right',
};
