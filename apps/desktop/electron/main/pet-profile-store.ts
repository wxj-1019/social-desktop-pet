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
    return this.store.load();
  }

  save(profile: PetProfile): void {
    this.store.save(profile);
  }
}
