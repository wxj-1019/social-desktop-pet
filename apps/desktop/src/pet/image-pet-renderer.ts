/**
 * ImagePetRenderer —— 实现 PetRenderer 契约（奶油小猫伪3D 图片皮肤）。
 *
 * 与 createSvgPetRenderer / createSpritesheetPetRenderer 同构：
 * 维护 StarIsleVisualState，patch 合并后回调 update。
 * 帧由 ImageVisual 组件按 (motion, expression, speaking) 解析。
 *
 * 自动行为（仅 idle + !reducedMotion 时生效；外部介入立即取消）：
 * - 跑步：每 15-40 秒随机一次 walk，持续 3-6 秒后回 idle。
 *
 * 睡眠与唤醒（用户行为驱动，非显式 sleep 触发）：
 * - 5 分钟无用户操作（playMotion / setSpeaking）→ 自动入睡
 * - 自动唤醒：sleep 90-150 秒后自己醒来 → 500ms 伸懒腰过渡（happy）→ 回 idle
 * - 被动唤醒：sleep 中收到任何 playMotion(非 sleep) → 先 500ms 伸懒腰 → 再切用户目标动作
 */
import {
  DEFAULT_VISUAL_STATE,
  type PetRenderer,
  type StarIsleVisualState,
} from './pet-renderer.js';

const AUTO_WALK_DELAY_MIN = 15_000;
const AUTO_WALK_DELAY_MAX = 40_000;
const AUTO_WALK_DURATION_MIN = 3_000;
const AUTO_WALK_DURATION_MAX = 6_000;

/** 用户多久没操作就自动入睡 */
const IDLE_SLEEP_TIMEOUT_MS = 300_000; // 5 分钟
/** 睡眠多久后自动唤醒（90-150 秒） */
const AUTO_WAKE_DELAY_MIN = 90_000;
const AUTO_WAKE_DELAY_MAX = 150_000;
/** 唤醒过渡（伸懒腰）时长 */
const WAKE_TRANSITION_MS = 500;
/** idle 时随机歪头间隔 */
const TILT_INTERVAL_MIN = 8_000;
const TILT_INTERVAL_MAX = 20_000;
/** 歪头持续时间 */
const TILT_DURATION_MS = 1_500;
/** 生气持续时间（连点3下触发） */
const ANGRY_DURATION_MS = 3_000;
/** 眨眼间隔（4-6秒随机） */
const BLINK_INTERVAL_MIN = 4_000;
const BLINK_INTERVAL_MAX = 6_000;
/** 眨眼持续时间（300ms） */
const BLINK_DURATION_MS = 300;

type Timer = ReturnType<typeof setTimeout>;

const randomBetween = (min: number, max: number): number => min + Math.random() * (max - min);

export function createImagePetRenderer(update: (state: StarIsleVisualState) => void): PetRenderer {
  let state: StarIsleVisualState = { ...DEFAULT_VISUAL_STATE };
  let disposed = false;
  let idleActionTimer: Timer | null = null;
  let walkEndTimer: Timer | null = null;
  let autoWakeTimer: Timer | null = null;
  let wakeTransitionTimer: Timer | null = null;
  let userActivityTimer: Timer | null = null;
  let tiltTimer: Timer | null = null;
  let tiltEndTimer: Timer | null = null;
  let angryTimer: Timer | null = null;
  let blinkTimer: Timer | null = null;
  let blinkEndTimer: Timer | null = null;
  let pendingMotionAfterWake: {
    motion: StarIsleVisualState['motion'];
    intensity: 1 | 2 | 3;
  } | null = null;

  const commit = (patch: Partial<StarIsleVisualState>): void => {
    if (disposed) return;
    state = { ...state, ...patch };
    update(state);
  };

  const clearIdleActionTimer = (): void => {
    if (idleActionTimer !== null) {
      clearTimeout(idleActionTimer);
      idleActionTimer = null;
    }
  };
  const clearWalkEndTimer = (): void => {
    if (walkEndTimer !== null) {
      clearTimeout(walkEndTimer);
      walkEndTimer = null;
    }
  };
  const clearAutoWakeTimer = (): void => {
    if (autoWakeTimer !== null) {
      clearTimeout(autoWakeTimer);
      autoWakeTimer = null;
    }
  };
  const clearWakeTransitionTimer = (): void => {
    if (wakeTransitionTimer !== null) {
      clearTimeout(wakeTransitionTimer);
      wakeTransitionTimer = null;
    }
  };
  const clearUserActivityTimer = (): void => {
    if (userActivityTimer !== null) {
      clearTimeout(userActivityTimer);
      userActivityTimer = null;
    }
  };
  const clearTiltTimer = (): void => {
    if (tiltTimer !== null) {
      clearTimeout(tiltTimer);
      tiltTimer = null;
    }
  };
  const clearTiltEndTimer = (): void => {
    if (tiltEndTimer !== null) {
      clearTimeout(tiltEndTimer);
      tiltEndTimer = null;
    }
  };
  const clearAngryTimer = (): void => {
    if (angryTimer !== null) {
      clearTimeout(angryTimer);
      angryTimer = null;
    }
  };
  const clearBlinkTimer = (): void => {
    if (blinkTimer !== null) {
      clearTimeout(blinkTimer);
      blinkTimer = null;
    }
  };
  const clearBlinkEndTimer = (): void => {
    if (blinkEndTimer !== null) {
      clearTimeout(blinkEndTimer);
      blinkEndTimer = null;
    }
  };

  const clearAllAutoBehaviorTimers = (): void => {
    clearIdleActionTimer();
    clearWalkEndTimer();
    clearAutoWakeTimer();
    clearWakeTransitionTimer();
    clearUserActivityTimer();
    clearTiltTimer();
    clearTiltEndTimer();
    clearAngryTimer();
    clearBlinkTimer();
    clearBlinkEndTimer();
    pendingMotionAfterWake = null;
  };

  const resetUserActivityTimer = (): void => {
    clearUserActivityTimer();
    if (disposed || state.reducedMotion) return;
    if (state.motion === 'sleep' || wakeTransitionTimer !== null) return;
    userActivityTimer = setTimeout(() => {
      userActivityTimer = null;
      if (state.motion === 'idle' && !state.speaking) {
        clearIdleActionTimer();
        clearWalkEndTimer();
        commit({ motion: 'sleep', _imageWaking: undefined });
        enterSleep();
      }
    }, IDLE_SLEEP_TIMEOUT_MS);
  };

  const scheduleIdleAction = (): void => {
    if (disposed || state.reducedMotion) return;
    clearIdleActionTimer();
    if (state.motion !== 'idle' || state.speaking) return;

    const delayUntilWalk = randomBetween(AUTO_WALK_DELAY_MIN, AUTO_WALK_DELAY_MAX);
    idleActionTimer = setTimeout(() => runWalkCycle(), delayUntilWalk);
  };

  const scheduleIdleTilt = (): void => {
    if (disposed || state.reducedMotion) return;
    clearTiltTimer();
    if (state.motion !== 'idle' || state.speaking) return;
    const delay = randomBetween(TILT_INTERVAL_MIN, TILT_INTERVAL_MAX);
    tiltTimer = setTimeout(() => {
      if (disposed) return;
      if (state.motion !== 'idle' || state.speaking) return;
      const direction: 'left' | 'right' = Math.random() > 0.5 ? 'left' : 'right';
      commit({ _imageTilt: direction });
      tiltEndTimer = setTimeout(() => {
        if (disposed) return;
        commit({ _imageTilt: undefined });
        scheduleIdleTilt();
      }, TILT_DURATION_MS);
    }, delay);
  };

  const scheduleBlink = (): void => {
    if (disposed || state.reducedMotion) return;
    clearBlinkTimer();
    if (state.motion !== 'idle' || state.speaking) return;
    const delay = randomBetween(BLINK_INTERVAL_MIN, BLINK_INTERVAL_MAX);
    blinkTimer = setTimeout(() => {
      if (disposed) return;
      if (state.motion !== 'idle' || state.speaking) return;
      commit({ _imageForceFrame: 'blink' });
      blinkEndTimer = setTimeout(() => {
        if (disposed) return;
        commit({ _imageForceFrame: undefined });
        scheduleBlink();
      }, BLINK_DURATION_MS);
    }, delay);
  };

  const runWalkCycle = (): void => {
    if (disposed || state.reducedMotion) return;
    if (state.motion !== 'idle' || state.speaking) {
      scheduleIdleAction();
      return;
    }
    clearTiltTimer();
    clearTiltEndTimer();
    clearBlinkTimer();
    clearBlinkEndTimer();
    commit({ _imageForceFrame: undefined, _imageTilt: undefined, motion: 'walk' });
    const runMs = randomBetween(AUTO_WALK_DURATION_MIN, AUTO_WALK_DURATION_MAX);
    walkEndTimer = setTimeout(() => {
      if (disposed) return;
      commit({ motion: 'idle' });
      scheduleIdleAction();
      scheduleIdleTilt();
      scheduleBlink();
    }, runMs);
  };

  const enterSleep = (): void => {
    clearAutoWakeTimer();
    if (disposed || state.reducedMotion) return;
    const delay = randomBetween(AUTO_WAKE_DELAY_MIN, AUTO_WAKE_DELAY_MAX);
    autoWakeTimer = setTimeout(() => {
      autoWakeTimer = null;
      runWakeTransition('idle', DEFAULT_VISUAL_STATE.intensity);
    }, delay);
  };

  const runWakeTransition = (
    fallbackMotion: StarIsleVisualState['motion'],
    fallbackIntensity: 1 | 2 | 3,
  ): void => {
    if (disposed) return;
    if (pendingMotionAfterWake === null) {
      pendingMotionAfterWake = { motion: fallbackMotion, intensity: fallbackIntensity };
    }
    clearWakeTransitionTimer();
    commit({
      motion: 'happy',
      intensity: 1,
      _imageWaking: true,
    });

    wakeTransitionTimer = setTimeout(() => {
      if (disposed) return;
      wakeTransitionTimer = null;
      const final = pendingMotionAfterWake ?? {
        motion: 'idle',
        intensity: DEFAULT_VISUAL_STATE.intensity,
      };
      pendingMotionAfterWake = null;
      commit({
        motion: final.motion,
        intensity: final.intensity,
        _imageWaking: undefined,
      });
      if (final.motion === 'idle' && !state.reducedMotion && !state.speaking) {
        scheduleIdleAction();
        scheduleIdleTilt();
        scheduleBlink();
      }
      resetUserActivityTimer();
    }, WAKE_TRANSITION_MS);
  };

  scheduleIdleAction();
  scheduleIdleTilt();
  scheduleBlink();
  resetUserActivityTimer();

  return {
    playMotion(motion, intensity) {
      clearIdleActionTimer();
      clearWalkEndTimer();
      clearAngryTimer();
      commit({ _imageAngry: undefined });

      const comingFromSleep = state.motion === 'sleep';
      const isEnteringSleep = motion === 'sleep';

      if (isEnteringSleep) {
        clearAllAutoBehaviorTimers();
        commit({ motion, intensity, _imageWaking: undefined });
        enterSleep();
        return Promise.resolve();
      }

      if (comingFromSleep) {
        pendingMotionAfterWake = {
          motion,
          intensity: intensity ?? state.intensity ?? DEFAULT_VISUAL_STATE.intensity,
        };
        if (wakeTransitionTimer === null) {
          clearAutoWakeTimer();
          runWakeTransition(motion, intensity ?? state.intensity ?? DEFAULT_VISUAL_STATE.intensity);
        }
        return Promise.resolve();
      }

      commit({ motion, intensity, _imageWaking: undefined });

      // intensity=3 + motion=sad => 生气模式（由连点3下触发）
      if (motion === 'sad' && (intensity ?? state.intensity) === 3) {
        clearAngryTimer();
        commit({ _imageAngry: true });
        angryTimer = setTimeout(() => {
          if (disposed) return;
          angryTimer = null;
          commit({ _imageAngry: undefined, motion: 'idle', intensity: 1 });
          if (!state.reducedMotion) {
            scheduleIdleAction();
            scheduleIdleTilt();
            scheduleBlink();
          }
          resetUserActivityTimer();
        }, ANGRY_DURATION_MS);
      }

      if (motion === 'idle' && !state.reducedMotion) {
        scheduleIdleAction();
        scheduleIdleTilt();
        scheduleBlink();
      }
      resetUserActivityTimer();
      return Promise.resolve();
    },
    setExpression(expression) {
      commit({ expression });
    },
    setSpeaking(active) {
      clearIdleActionTimer();
      clearWalkEndTimer();
      commit({ speaking: active });
      if (!active && state.motion === 'idle' && !state.reducedMotion) {
        scheduleIdleAction();
        scheduleIdleTilt();
        scheduleBlink();
      }
      if (active) {
        resetUserActivityTimer();
      }
    },
    setFacing(facing) {
      commit({ facing });
    },
    setReducedMotion(active) {
      commit({ reducedMotion: active });
      if (active) {
        clearAllAutoBehaviorTimers();
      } else if (state.motion === 'idle' && !state.speaking) {
        scheduleIdleAction();
        scheduleIdleTilt();
        scheduleBlink();
        resetUserActivityTimer();
      } else if (state.motion === 'sleep') {
        enterSleep();
      }
    },
    dispose() {
      disposed = true;
      clearAllAutoBehaviorTimers();
    },
  };
}
