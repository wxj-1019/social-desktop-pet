import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { PetPosition } from './display-controller.js';
import { DEFAULT_PET_POSITION, PositionStore } from './position-store.js';

const dirs: string[] = [];
function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'position-store-'));
  dirs.push(dir);
  return { dir, store: new PositionStore(dir) };
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

const valid: PetPosition = {
  displayId: 'primary',
  anchorX: 0.5,
  anchorY: 0.25,
  scale: 1,
  savedAt: 123,
};

describe('PositionStore (8.5 位置持久化)', () => {
  it('saves and loads a position round-trip', () => {
    const { dir, store } = makeStore();
    store.save(valid);
    expect(store.load()).toEqual(valid);
    expect(existsSync(join(dir, 'pet-position.json'))).toBe(true); // 文件名 pet-position.json
  });

  it('rejects anchorX out of range and keeps fallback', () => {
    const { store } = makeStore();
    expect(() => store.save({ ...valid, anchorX: 1.5 })).toThrow();
    expect(store.load()).toEqual(DEFAULT_PET_POSITION);
  });

  it('rejects scale out of range', () => {
    const { store } = makeStore();
    expect(() => store.save({ ...valid, scale: 0 })).toThrow();
    expect(store.load()).toEqual(DEFAULT_PET_POSITION);
  });

  it('rejects NaN savedAt', () => {
    const { store } = makeStore();
    expect(() => store.save({ ...valid, savedAt: NaN })).toThrow();
    expect(store.load()).toEqual(DEFAULT_PET_POSITION);
  });

  it('falls back to the default position on corrupted file', () => {
    const { dir, store } = makeStore();
    writeFileSync(join(dir, 'pet-position.json'), 'nope');
    expect(store.load()).toEqual(DEFAULT_PET_POSITION);
  });
});
