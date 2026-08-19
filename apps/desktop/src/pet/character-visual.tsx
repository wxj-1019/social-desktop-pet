/**
 * CharacterVisual —— 面板侧统一视觉入口（形象协议阶段 C）。
 *
 * 面板（聊天/本地聊天/设置/角色选择）不再 import 具体角色组件：
 * - useCurrentCharacter：petProfile 当前 petId → registry config + manifest，
 *   经 onChanged 实时跟随换装（角色切换重载桌宠窗，面板原地换视觉）
 * - CharacterVisual：渲染当前（或显式 petId）角色的 VisualComponent，
 *   外层 .character-visual 供面板 CSS 控制尺寸
 * window.pet 缺失（单测/非 Electron）时回退星屿，不抛错（协议 §11.9）。
 */
import { useEffect, useState, type ComponentType } from 'react';

import type { CharacterManifest, PetId } from '@pet/protocol';

import { getCharacterManifest } from './character-manifests.js';
import { getCharacterConfig, type CharacterConfig } from './character-registry.js';
import { DEFAULT_VISUAL_STATE, type StarIsleVisualState } from './pet-renderer.js';

export interface CurrentCharacter {
  petId: PetId;
  config: CharacterConfig;
  manifest: CharacterManifest;
}

/** 当前角色（profile 驱动，实时跟随换装）；无 pet API 时回退星屿 */
export function useCurrentCharacter(): CurrentCharacter {
  const [petId, setPetId] = useState<PetId>('star-isle');
  useEffect(() => {
    const profileApi = window.pet?.petProfile;
    if (!profileApi) return;
    let alive = true;
    void profileApi.get().then((profile) => {
      if (alive) setPetId(profile.petId);
    });
    const off = profileApi.onChanged((profile) => setPetId(profile.petId));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return { petId, config: getCharacterConfig(petId), manifest: getCharacterManifest(petId) };
}

export interface CharacterVisualProps {
  /** 渲染状态；缺省静态默认态（面板装饰位不需要动画驱动） */
  state?: StarIsleVisualState;
  /** 显式指定角色；缺省用当前 profile 角色 */
  petId?: PetId;
  className?: string;
}

export function CharacterVisual({ state, petId, className }: CharacterVisualProps) {
  const current = useCurrentCharacter();
  const resolvedId = petId ?? current.petId;
  const Visual: ComponentType<{ state?: StarIsleVisualState }> =
    getCharacterConfig(resolvedId).VisualComponent;
  return (
    <div className={className ? `character-visual ${className}` : 'character-visual'}>
      <Visual state={state ?? DEFAULT_VISUAL_STATE} />
    </div>
  );
}
