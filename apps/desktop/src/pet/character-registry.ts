/**
 * 角色注册表 —— 把 petId（@pet/protocol PetIdSchema）绑定到具体渲染配置。
 *
 * 每个角色登记：
 * - id：协议枚举值（star-isle / codenono）
 * - displayName：面板卡片显示名
 * - description：一句话介绍
 * - VisualComponent：渲染组件（消费 StarIsleVisualState）
 * - rendererFactory：PetRenderer 适配层工厂（与 usePetRuntime 接线）
 *
 * 新增角色 = 在此注册表加一条 + 协议 PetIdSchema 加枚举值。
 * main.tsx 根据 URL ?character= 从此表取 VisualComponent；
 * usePetRuntime 根据 rendererFactory 选择适配层。
 */
import type { PetId } from '@pet/protocol';
import type { ComponentType } from 'react';

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
}

/** 全部已注册角色（顺序即面板卡片顺序） */
export const CHARACTERS: readonly CharacterConfig[] = [
  {
    id: 'star-isle',
    petName: '星屿',
    displayName: '星屿',
    description: '原创 SVG 星尾狐猫，蓝紫大耳，温暖陪伴。',
    VisualComponent: StarIsleVisual,
    rendererFactory: createSvgPetRenderer,
  },
  {
    id: 'codenono',
    petName: 'CodeNoNo',
    displayName: 'CodeNoNo',
    description: 'spritesheet 帧动画角色，编程伙伴气质。',
    VisualComponent: SpritesheetVisual,
    rendererFactory: createSpritesheetPetRenderer,
  },
];

/** 按 petId 取角色配置；未知 id 回退到第一个（星屿） */
export function getCharacterConfig(petId: PetId | string | undefined): CharacterConfig {
  const found = CHARACTERS.find((c) => c.id === petId);
  if (found) return found;
  // CHARACTERS 至少含星屿一条；noUncheckedIndexedAccess 下需断言
  return CHARACTERS[0]!;
}

/** 列出全部角色（面板卡片用） */
export function listCharacters(): readonly CharacterConfig[] {
  return CHARACTERS;
}
