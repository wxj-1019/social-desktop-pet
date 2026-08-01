/**
 * 动作/表情映射 —— 7.1 PetStateMachine → 7.2 Live2D MotionController 的纯逻辑层。
 *
 * 与 model-manifest.json 的 motions/expressions 清单对应
 * （10 组动作 = V-12 角色生成的动作组：待机/行走/坐/睡/开心/难过/惊讶/挥手/触摸/口型）。
 *
 * 纯函数可单测；Cubism SDK 集成（V-1 许可后）只消费这里的映射结果。
 */
import type { PetState } from '@pet/protocol';

export const MOTIONS = [
  'idle',
  'walk',
  'sit',
  'sleep',
  'happy',
  'sad',
  'surprised',
  'wave',
  'touch',
  'talk',
] as const;
export type MotionName = (typeof MOTIONS)[number];

export const EXPRESSIONS = ['neutral', 'warm', 'happy', 'sad', 'surprised', 'shy'] as const;
export type ExpressionName = (typeof EXPRESSIONS)[number];

/** 状态 → 主动作（7.2 播放逻辑：状态切换即切动作） */
export function stateToMotion(state: PetState): MotionName {
  switch (state) {
    case 'WALKING':
      return 'walk';
    case 'SITTING':
      return 'sit';
    case 'SLEEPING':
      return 'sleep';
    case 'CHATTING':
      return 'talk'; // 口型动作（说话时播放）
    case 'HOSTING':
    case 'VISITING':
      return 'wave'; // 接待/拜访：挥手
    case 'STARTING':
    case 'IDLE':
    case 'QUIET':
    case 'HIDDEN':
    case 'OFFLINE':
    default:
      return 'idle';
  }
}

/** 状态 → 默认表情 */
export function stateToExpression(state: PetState): ExpressionName {
  switch (state) {
    case 'SLEEPING':
      return 'neutral';
    case 'HIDDEN':
    case 'OFFLINE':
      return 'neutral';
    default:
      return 'warm';
  }
}

/**
 * 动作优先级（打断规则）：正在播放的高优先级动作不被低优先级打断。
 * 例：SLEEPING（sleep）中收到 QUIET → idle 不打断 sleep。
 */
export const MOTION_PRIORITY: Record<MotionName, number> = {
  idle: 0,
  talk: 1,
  sit: 2,
  walk: 2,
  wave: 3,
  happy: 3,
  sad: 3,
  surprised: 4,
  touch: 4,
  sleep: 5,
};

/** 判断新动作是否应打断当前动作（7.2 防抖动） */
export function shouldInterrupt(current: MotionName, next: MotionName): boolean {
  return MOTION_PRIORITY[next] > MOTION_PRIORITY[current];
}
