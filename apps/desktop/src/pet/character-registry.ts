/**
 * 角色注册表 —— 把 petId（@pet/protocol PetIdSchema）绑定到具体渲染配置。
 *
 * 每个角色登记：
 * - id：协议枚举值（star-isle / codenono / cream-kitten）
 * - petName/displayName/description：卡片文案，派生自 character-manifests（单一事实源，§11.2）
 * - VisualComponent：渲染组件（消费 StarIsleVisualState）
 * - rendererFactory：PetRenderer 适配层工厂（与 usePetRuntime 接线）
 * - FallbackComponent：渲染抛错时的角色专属静态降级（§11.8）
 *
 * 新增角色 = 在此注册表加一条 + 协议 PetIdSchema 加枚举值。
 * main.tsx 根据 URL ?character= 从此表取 VisualComponent；
 * usePetRuntime 根据 rendererFactory 选择适配层。
 */
import type { ComponentType } from 'react';

import type { PetId } from '@pet/protocol';

import { CodenonoFallback, CreamKittenFallback, PetFallback } from './character-fallbacks.js';
import { getCharacterManifest } from './character-manifests.js';
import { createImagePetRenderer } from './image-pet-renderer.js';
import { ImageVisual } from './image-visual.js';
import type { PetRenderer, StarIsleVisualState } from './pet-renderer.js';
import { createSpritesheetPetRenderer } from './spritesheet-pet-renderer.js';
import { SpritesheetVisual } from './spritesheet-visual.js';
import { StarIsleVisual } from './star-isle-visual.js';
import { createSvgPetRenderer } from './svg-pet-renderer.js';

export interface CharacterConfig {
  id: PetId;
  /** 角色名（onboarding 气泡/自称文案用；与 displayName 同值，语义上供运行时消费） */
  petName: string;
  displayName: string;
  description: string;
  /** 渲染组件（消费 StarIsleVisualState；state 可选——与 StarIsleVisual/SpritesheetVisual 一致） */
  VisualComponent: ComponentType<{ state?: StarIsleVisualState }>;
  /** PetRenderer 适配层工厂（注入 usePetRuntime） */
  rendererFactory: (update: (state: StarIsleVisualState) => void) => PetRenderer;
  /** 渲染抛错时的角色专属静态降级（协议 §11.8）；缺省由调用方用 PetFallback */
  FallbackComponent?: ComponentType;
}

/** 从 manifest 派生卡片文案（单一事实源，协议 §11.2） */
function copyOf(id: PetId) {
  const m = getCharacterManifest(id);
  return { petName: m.petName, displayName: m.displayName, description: m.description };
}

/** 全部已注册角色（顺序即面板卡片顺序） */
export const CHARACTERS: readonly CharacterConfig[] = [
  {
    id: 'star-isle',
    ...copyOf('star-isle'),
    VisualComponent: StarIsleVisual,
    rendererFactory: createSvgPetRenderer,
    FallbackComponent: PetFallback,
  },
  {
    id: 'codenono',
    ...copyOf('codenono'),
    VisualComponent: SpritesheetVisual,
    rendererFactory: createSpritesheetPetRenderer,
    FallbackComponent: CodenonoFallback,
  },
  {
    id: 'cream-kitten',
    ...copyOf('cream-kitten'),
    VisualComponent: ImageVisual,
    rendererFactory: createImagePetRenderer,
    FallbackComponent: CreamKittenFallback,
  },
];

/** 按 petId 取角色配置；未知 id 回退到第一个（星屿，并告警留诊断痕迹，§11） */
export function getCharacterConfig(petId: PetId | string | undefined): CharacterConfig {
  const found = CHARACTERS.find((c) => c.id === petId);
  if (found) return found;
  console.warn('[character] unknown petId "%s", fallback to star-isle', petId);
  // CHARACTERS 至少含星屿一条；noUncheckedIndexedAccess 下需断言
  return CHARACTERS[0]!;
}

/** 列出全部角色（面板卡片用） */
export function listCharacters(): readonly CharacterConfig[] {
  return CHARACTERS;
}
