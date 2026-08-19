/**
 * 跨进程视觉映射 —— 7.1 状态机 / 意图 → 7.2 Live2D MotionController 的纯逻辑层。
 *
 * 类型全部来自 @pet/protocol（PetMotion / PetExpression / ActionIntent / Emotion / PetState），
 * 保证 Main / Preload / Renderer 三端复用的契约一致。纯函数可单测；
 * Cubism SDK 集成（V-1 许可后）只消费这里的映射结果。
 */
import type { ActionIntent, Emotion, PetExpression, PetMotion, PetState } from '@pet/protocol';

/** 与 model-manifest.json 的 motions 清单对应（10 组动作 = V-12 角色生成的动作组） */
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
  'dragged',
] as const satisfies readonly PetMotion[];

/** 与 model-manifest.json 的 expressions 清单对应 */
export const EXPRESSIONS = [
  'neutral',
  'warm',
  'happy',
  'sad',
  'surprised',
  'shy',
] as const satisfies readonly PetExpression[];

/** 状态 → 主动作（7.2 播放逻辑：状态切换即切动作） */
export function stateToMotion(state: PetState): PetMotion {
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
export function stateToExpression(state: PetState): PetExpression {
  switch (state) {
    case 'SLEEPING':
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
export const MOTION_PRIORITY: Record<PetMotion, number> = {
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
  dragged: 4,
};

/** 判断新动作是否应打断当前动作（7.2 防抖动） */
export function shouldInterrupt(current: PetMotion, next: PetMotion): boolean {
  return MOTION_PRIORITY[next] > MOTION_PRIORITY[current];
}

/** AI actionIntent → 可播放 motion（10.2 意图 → 7.2 动作） */
export function actionIntentToMotion(intent: ActionIntent): PetMotion {
  switch (intent) {
    case 'idle':
      return 'idle';
    case 'wave':
      return 'wave';
    case 'nod':
      return 'talk';
    case 'shake_head':
      return 'surprised';
    case 'touch':
      return 'touch';
    case 'sit':
      return 'sit';
    case 'sleep':
      return 'sleep';
    case 'walk':
      return 'walk';
    case 'cheer':
      return 'happy';
    case 'comfort':
      return 'touch';
  }
}

/** AI emotion → 可渲染表情（10.2 情绪 → 7.2 表情） */
export function emotionToExpression(emotion: Emotion): PetExpression {
  switch (emotion) {
    case 'neutral':
      return 'neutral';
    case 'warm':
      return 'warm';
    case 'happy':
      return 'happy';
    case 'sad':
      return 'sad';
    case 'surprised':
      return 'surprised';
    case 'shy':
      return 'shy';
    case 'apologetic':
      return 'sad';
    case 'concerned':
      return 'warm';
  }
}

/**
 * 强度归一化（10.2 intensity 1..5 → 视觉 1|2|3）：
 * <=2 → 1，<=4 → 2，其余 → 3（负值/越界钳制到范围内）。
 */
export function normalizeIntensity(value: number): 1 | 2 | 3 {
  if (value <= 2) return 1;
  if (value <= 4) return 2;
  return 3;
}
