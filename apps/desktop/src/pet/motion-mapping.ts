/**
 * 动作/表情映射 —— 兼容层。
 *
 * 纯映射逻辑已上移至 @pet/pet-state 的 visual-mapping（跨进程复用，Task 3），
 * 此处仅 re-export，保持现有调用（model-loader / app.tsx）兼容。
 * 与 model-manifest.json 的 motions/expressions 清单对应
 * （10 组动作 = V-12 角色生成的动作组：待机/行走/坐/睡/开心/难过/惊讶/挥手/触摸/口型）。
 */
import type { PetExpression, PetMotion } from '@pet/protocol';

export {
  MOTIONS,
  EXPRESSIONS,
  stateToMotion,
  stateToExpression,
  shouldInterrupt,
  actionIntentToMotion,
  emotionToExpression,
  normalizeIntensity,
} from '@pet/pet-state';

export type MotionName = PetMotion;
export type ExpressionName = PetExpression;
