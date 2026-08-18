/**
 * usePetRuntime —— 星屿直连面的运行时控制器（Task 9）。
 *
 * mount 时一次性建立三条数据通道并把它们统一进 React 状态：
 * - petRuntime.getSnapshot() / onSnapshot → snapshot
 * - petRuntime.onVisualCommand → applyCommand 累积为 visualState + bubbleText
 * - petProfile.get() → profile（并把 reducedMotion 落到 renderer）
 *
 * renderer 由 createSvgPetRenderer 适配，visual command 经 PetRenderer 契约
 * 合并进本地 StarIsleVisualState 供组件消费。卸载清理全部订阅并 dispose。
 * window.pet 缺失（非 Electron）时静默降级，不抛错。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { stateToExpression, stateToMotion } from '@pet/pet-state';
import type { PetProfile, PetRuntimeSnapshot, PetVisualCommand } from '@pet/protocol';

import {
  DEFAULT_VISUAL_STATE,
  type PetRenderer,
  type StarIsleVisualState,
} from './pet-renderer.js';
import { createSvgPetRenderer } from './svg-pet-renderer.js';

export interface PetRuntimeController {
  /** 运行时快照（state/online/dnd/hidden）；尚未返回时为 null */
  snapshot: PetRuntimeSnapshot | null;
  /** 桌宠档案（reducedMotion/bubbleEnabled 等）；尚未返回时为 null */
  profile: PetProfile | null;
  /** 由视觉指令累积的当前渲染状态 */
  visualState: StarIsleVisualState;
  /** 当前气泡文本（bubble 指令）；null 表示无气泡 */
  bubbleText: string | null;
  /** PetRenderer 适配层（playMotion/setExpression/...） */
  renderer: PetRenderer;
  /** 把一条可视化指令应用到本地状态 */
  applyCommand: (command: PetVisualCommand) => void;
}

/** 气泡自动消失：新内容会刷新计时；超过该时长无更新则清除（设计稿 7.4 短驻留） */
const BUBBLE_TIMEOUT_MS = 5000;

/** PetRenderer 工厂类型（供不同皮肤注入） */
export type RendererFactory = (update: (state: StarIsleVisualState) => void) => PetRenderer;

export interface UsePetRuntimeOptions {
  /** PetRenderer 工厂；缺省 createSvgPetRenderer（星屿 SVG） */
  rendererFactory?: RendererFactory;
  /** 角色名（onboarding 引导气泡自称；缺省星屿） */
  petName?: string;
}

export function usePetRuntime(options: UsePetRuntimeOptions = {}): PetRuntimeController {
  const rendererFactory = options.rendererFactory ?? createSvgPetRenderer;
  const petName = options.petName ?? '星屿';
  const [snapshot, setSnapshot] = useState<PetRuntimeSnapshot | null>(null);
  const [profile, setProfile] = useState<PetProfile | null>(null);
  const [visualState, setVisualState] = useState<StarIsleVisualState>(DEFAULT_VISUAL_STATE);
  const [bubbleText, setBubbleText] = useState<string | null>(null);
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const receivedVisualRef = useRef(false);

  const rendererRef = useRef<PetRenderer | null>(null);
  if (!rendererRef.current) {
    rendererRef.current = rendererFactory(setVisualState);
  }

  const applyCommand = useCallback((command: PetVisualCommand) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    switch (command.type) {
      case 'motion':
        void renderer.playMotion(command.motion, command.intensity);
        break;
      case 'expression':
        renderer.setExpression(command.expression);
        break;
      case 'speaking':
        renderer.setSpeaking(command.active);
        break;
      case 'facing':
        renderer.setFacing(command.facing);
        break;
      case 'bubble':
        setBubbleText(command.text);
        if (bubbleTimerRef.current) {
          clearTimeout(bubbleTimerRef.current);
          bubbleTimerRef.current = null;
        }
        if (command.text) {
          bubbleTimerRef.current = setTimeout(() => {
            setBubbleText(null);
            bubbleTimerRef.current = null;
          }, BUBBLE_TIMEOUT_MS);
        }
        break;
    }
  }, []);

  // 卸载时清掉气泡计时器
  useEffect(
    () => () => {
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const runtime = window.pet?.petRuntime;
    const profileApi = window.pet?.petProfile;
    if (!runtime) return;

    // 兼容 StrictMode 的双次 effect：cleanup 后重建 renderer
    if (!rendererRef.current) {
      rendererRef.current = rendererFactory(setVisualState);
    }

    let disposed = false;
    receivedVisualRef.current = false;

    void runtime.getSnapshot().then((next) => {
      if (disposed) return;
      setSnapshot(next);
      if (!receivedVisualRef.current) {
        void rendererRef.current?.playMotion(stateToMotion(next.state), 1);
        rendererRef.current?.setExpression(stateToExpression(next.state));
      }
    });

    const offSnapshot = runtime.onSnapshot(setSnapshot);
    const offVisual = runtime.onVisualCommand((command) => {
      if (!disposed) {
        receivedVisualRef.current = true;
        applyCommand(command);
      }
    });

    let offProfileChanged: (() => void) | undefined;
    if (profileApi) {
      void profileApi.get().then((next) => {
        if (disposed) return;
        setProfile(next);
        rendererRef.current?.setReducedMotion(next.reducedMotion);
        // 首次运行引导：未标记过 onboarding 时给 3 条提示气泡（经 chatEvent 走真实链路）
        if (!localStorage.getItem('pet:onboarded')) {
          const hints = [
            `你好呀，我是${petName}！可以摸摸我的头～`,
            '拖我可以移动，右键有菜单哦',
            '双击我可以打开聊天面板',
          ];
          let delay = 800;
          for (const hint of hints) {
            const text = hint;
            setTimeout(() => {
              if (!disposed) applyCommand({ type: 'bubble', text });
            }, delay);
            delay += 2_500;
          }
          localStorage.setItem('pet:onboarded', '1');
        }
      });
      // 设置页写入档案 → main 推送变更：气泡开关/减弱动态对运行中桌宠即时生效
      if (typeof profileApi.onChanged === 'function') {
        offProfileChanged = profileApi.onChanged((next) => {
          if (disposed) return;
          setProfile(next);
          rendererRef.current?.setReducedMotion(next.reducedMotion);
        });
      }
    }

    return () => {
      disposed = true;
      offSnapshot();
      offVisual();
      offProfileChanged?.();
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [applyCommand, rendererFactory, petName]);

  return {
    snapshot,
    profile,
    visualState,
    bubbleText,
    renderer: rendererRef.current!,
    applyCommand,
  };
}
