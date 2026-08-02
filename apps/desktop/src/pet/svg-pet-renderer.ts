/**
 * SVG 星屿渲染器适配层 —— 实现 PetRenderer 契约。
 *
 * 内部维护 StarIsleVisualState，任何 set 合并 patch 后立即回调
 * `update(state)`（React 侧由此 setState 驱动重绘）；dispose 后忽略一切调用。
 * playMotion 返回 resolved Promise（SVG 动画由 CSS 驱动，无需等待）。
 */
import {
  DEFAULT_VISUAL_STATE,
  type PetRenderer,
  type StarIsleVisualState,
} from './pet-renderer.js';

export function createSvgPetRenderer(update: (state: StarIsleVisualState) => void): PetRenderer {
  let state: StarIsleVisualState = { ...DEFAULT_VISUAL_STATE };
  let disposed = false;

  const commit = (patch: Partial<StarIsleVisualState>): void => {
    if (disposed) return;
    state = { ...state, ...patch };
    update(state);
  };

  return {
    playMotion(motion, intensity) {
      commit({ motion, intensity });
      return Promise.resolve();
    },
    setExpression(expression) {
      commit({ expression });
    },
    setSpeaking(active) {
      commit({ speaking: active });
    },
    setReducedMotion(active) {
      commit({ reducedMotion: active });
    },
    dispose() {
      disposed = true;
    },
  };
}
