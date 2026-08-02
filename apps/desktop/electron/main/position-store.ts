/**
 * PositionStore —— 宠物位置本地持久化（8.5，非敏感）。
 *
 * 文件：pet-position.json（userData 下）。复用 AtomicJsonStore 做原子写；
 * anchor/scale 越界、NaN savedAt 等非法值由 PetPositionSchema 拒绝并回退默认。
 */
import { join } from 'node:path';

import { AtomicJsonStore } from './atomic-json-store.js';
import { DEFAULT_PET_SCALE, PetPositionSchema, type PetPosition } from './display-controller.js';

const POSITION_FILE = 'pet-position.json';

/** 无记录时的默认位置：displayId 为空 → 恢复时回主屏 */
export const DEFAULT_PET_POSITION: PetPosition = {
  displayId: '',
  anchorX: 0,
  anchorY: 0,
  scale: DEFAULT_PET_SCALE,
  savedAt: 0,
};

export class PositionStore {
  private readonly store: AtomicJsonStore<PetPosition>;

  constructor(dir: string) {
    this.store = new AtomicJsonStore<PetPosition>(
      join(dir, POSITION_FILE),
      PetPositionSchema,
      DEFAULT_PET_POSITION,
    );
  }

  load(): PetPosition {
    return this.store.load();
  }

  save(position: PetPosition): void {
    this.store.save(position);
  }
}
