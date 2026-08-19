/**
 * 奶油小猫帧规格清单 —— 把"动作帧类型"映射到"帧 URL 数组 + fps"。
 *
 * 设计：
 * - 单帧动作（idle/happy/hungry/sleepy/sad/dragged/blink）：frames=[url], fps=1。
 *   ImageVisual 的 rAF 循环到单帧不启动，等同静止；CSS 动画继续提供呼吸/弹跳等形变。
 * - 多帧动作（running）：frames=[walk_0..3], fps=10。rAF 按 fps 循环切换，真逐帧动画。
 *
 * 渐进升级：要给某动作补帧，只需在 frames 数组加 URL + 调 fps。
 * 新动作的帧图请用 align_frames.py 统一画布尺寸，避免 rAF 切换时抖动。
 */
import blinkUrl from '../assets/cream-kitten/blink.png';
import draggedUrl from '../assets/cream-kitten/dragged.png';
import happyUrl from '../assets/cream-kitten/happy.png';
import hungryUrl from '../assets/cream-kitten/hungry.png';
import idleUrl from '../assets/cream-kitten/idle.png';
import sadUrl from '../assets/cream-kitten/sad.png';
import sitUrl from '../assets/cream-kitten/sit.png';
import sleepyUrl from '../assets/cream-kitten/sleepy.png';
import walk0Url from '../assets/cream-kitten/walk_0.png';
import walk1Url from '../assets/cream-kitten/walk_1.png';
import walk2Url from '../assets/cream-kitten/walk_2.png';
import walk3Url from '../assets/cream-kitten/walk_3.png';

/** 状态图枚举 —— 与 assets/cream-kitten/ 下一一对应 */
export type CreamKittenFrame =
  'idle' | 'happy' | 'hungry' | 'sleepy' | 'sad' | 'dragged' | 'running' | 'sit' | 'blink';

/** 单个动作的帧规格 */
export interface ImageFrameSpec {
  /** 帧 URL 数组（单帧 = 静止；多帧 = rAF 循环逐帧动画） */
  readonly frames: readonly string[];
  /** 播放帧率（FPS）；单帧动作 fps=1（rAF 不启动） */
  readonly fps: number;
}

export const CREAM_KITTEN_FRAME_MAP: Readonly<Record<CreamKittenFrame, ImageFrameSpec>> = {
  idle: { frames: [idleUrl], fps: 1 },
  happy: { frames: [happyUrl], fps: 1 },
  hungry: { frames: [hungryUrl], fps: 1 },
  sleepy: { frames: [sleepyUrl], fps: 1 },
  sad: { frames: [sadUrl], fps: 1 },
  dragged: { frames: [draggedUrl], fps: 1 },
  running: { frames: [walk0Url, walk1Url, walk2Url, walk3Url], fps: 12 },
  sit: { frames: [sitUrl], fps: 1 },
  blink: { frames: [blinkUrl], fps: 1 },
};

export function frameSpecFor(frame: CreamKittenFrame): ImageFrameSpec {
  return CREAM_KITTEN_FRAME_MAP[frame];
}
