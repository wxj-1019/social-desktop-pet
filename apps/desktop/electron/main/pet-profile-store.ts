/**
 * PetProfileStore —— 星屿桌宠档案本地持久化（非敏感）。
 *
 * 文件：pet-profile.json（userData 下）。默认档案 DEFAULT_PET_PROFILE，
 * 缺失/损坏时由 AtomicJsonStore 回退到默认值。
 */
import { join } from 'node:path';

import { PetProfileSchema, type PetProfile } from '@pet/protocol';

import { AtomicJsonStore } from './atomic-json-store.js';

const PROFILE_FILE = 'pet-profile.json';

export const DEFAULT_PET_PROFILE: PetProfile = {
  version: 1,
  petId: 'star-isle',
  displayName: '星屿',
  reducedMotion: false,
  dnd: false,
  bubbleEnabled: true,
  menuStyle: 'sao',
};

export class PetProfileStore {
  private readonly store: AtomicJsonStore<PetProfile>;

  constructor(dir: string) {
    this.store = new AtomicJsonStore<PetProfile>(
      join(dir, PROFILE_FILE),
      PetProfileSchema,
      DEFAULT_PET_PROFILE,
    );
  }

  load(): PetProfile {
    // 迁移：老档案无 menuStyle 时补默认 'sao'（持久化即升级）
    const loaded = this.store.load();
    return { ...loaded, menuStyle: loaded.menuStyle ?? 'sao' };
  }

  save(profile: PetProfile): void {
    this.store.save(profile);
  }
}
