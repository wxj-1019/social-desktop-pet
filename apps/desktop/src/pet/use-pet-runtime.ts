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
import type { PetProfile, PetRuntimeSnapshot, PetVisualCommand } from '@pet/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';

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

export function usePetRuntime(): PetRuntimeController {
  const [snapshot, setSnapshot] = useState<PetRuntimeSnapshot | null>(null);
  const [profile, setProfile] = useState<PetProfile | null>(null);
  const [visualState, setVisualState] = useState<StarIsleVisualState>(DEFAULT_VISUAL_STATE);
  const [bubbleText, setBubbleText] = useState<string | null>(null);

  const rendererRef = useRef<PetRenderer | null>(null);
  if (!rendererRef.current) {
    rendererRef.current = createSvgPetRenderer(setVisualState);
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
      case 'bubble':
        setBubbleText(command.text);
        break;
    }
  }, []);

  useEffect(() => {
    const runtime = window.pet?.petRuntime;
    const profileApi = window.pet?.petProfile;
    if (!runtime) return;

    // 兼容 StrictMode 的双次 effect：cleanup 后重建 renderer
    if (!rendererRef.current) {
      rendererRef.current = createSvgPetRenderer(setVisualState);
    }

    let disposed = false;

    void runtime.getSnapshot().then((next) => {
      if (!disposed) setSnapshot(next);
    });

    const offSnapshot = runtime.onSnapshot(setSnapshot);
    const offVisual = runtime.onVisualCommand((command) => {
      if (!disposed) applyCommand(command);
    });

    if (profileApi) {
      void profileApi.get().then((next) => {
        if (disposed) return;
        setProfile(next);
        rendererRef.current?.setReducedMotion(next.reducedMotion);
      });
    }

    return () => {
      disposed = true;
      offSnapshot();
      offVisual();
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [applyCommand]);

  return {
    snapshot,
    profile,
    visualState,
    bubbleText,
    renderer: rendererRef.current!,
    applyCommand,
  };
}
