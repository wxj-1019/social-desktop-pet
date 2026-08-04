/**
 * SpritesheetPetRenderer —— 实现 PetRenderer 契约（spritesheet 皮肤）。
 *
 * 与 createSvgPetRenderer 同构：维护 StarIsleVisualState，patch 合并后回调 update。
 * 渲染状态（motion/expression/intensity/speaking/reducedMotion）字段与 SVG 星屿完全一致，
 * 帧循环由 SpritesheetVisual 组件根据 motion 驱动（rAF），本适配层只负责状态传递。
 */
import {
  DEFAULT_VISUAL_STATE,
  type PetRenderer,
  type StarIsleVisualState,
} from './pet-renderer.js';

export function createSpritesheetPetRenderer(
  update: (state: StarIsleVisualState) => void,
): PetRenderer {
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
    setFacing(facing) {
      commit({ facing });
    },
    setReducedMotion(active) {
      commit({ reducedMotion: active });
    },
    dispose() {
      disposed = true;
    },
  };
}
