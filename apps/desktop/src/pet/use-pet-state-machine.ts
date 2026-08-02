/**
 * PetStateMachine React 控制器 —— 7.1 状态机在渲染进程的落点。
 * 提供状态订阅 + 动作请求 + 空闲降级 tick。
 * （第 3 周接入 Live2D MotionController：state → motion 播放）
 */
import type { PetState } from '@pet/pet-state';
import { PetStateMachine } from '@pet/pet-state';
import type { ActionIntent } from '@pet/protocol';
import { useEffect, useRef, useState } from 'react';

export interface PetStateController {
  state: PetState;
  /** 请求 AI 提出的动作意图（7.1：状态机审批） */
  requestAction: (intent: ActionIntent) => boolean;
  /** 手动切换状态（交互/事件驱动） */
  transition: (to: PetState, reason?: string) => boolean;
}

export function usePetStateMachine(options?: {
  idleToSitMs?: number;
  sitToSleepMs?: number;
}): PetStateController {
  const [state, setState] = useState<PetState>('STARTING');
  const smRef = useRef<PetStateMachine | null>(null);
  if (!smRef.current) {
    smRef.current = new PetStateMachine(options);
  }

  useEffect(() => {
    const sm = smRef.current!;
    // 启动完成 → IDLE
    sm.transition('IDLE', 'boot_complete');
    setState(sm.current);
    // 空闲降级 tick（7.2 长时间无操作 → 坐下/睡觉）
    const timer = setInterval(() => {
      sm.tick();
      setState(sm.current);
    }, 5_000);
    return () => clearInterval(timer);
  }, []);

  return {
    state,
    requestAction: (intent) => {
      const sm = smRef.current!;
      const decision = sm.requestAction({ intent, source: 'system' });
      if (decision.approved) setState(sm.current);
      return decision.approved;
    },
    transition: (to, reason) => {
      const sm = smRef.current!;
      const ok = sm.transition(to, reason);
      if (ok) setState(sm.current);
      return ok;
    },
  };
}
