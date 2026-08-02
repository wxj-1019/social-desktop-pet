import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_PET_PROFILE, PetProfileStore } from './pet-profile-store.js';

const dirs: string[] = [];
function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'pet-profile-store-'));
  dirs.push(dir);
  return { dir, store: new PetProfileStore(dir) };
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('PetProfileStore (非敏感本地档案)', () => {
  it('returns the default star-isle profile when no file exists', () => {
    const { store } = makeStore();
    const profile = store.load();
    expect(profile.petId).toBe('star-isle');
    expect(profile.displayName).toBe('星屿');
    expect(profile).toEqual(DEFAULT_PET_PROFILE);
  });

  it('persists a changed displayName across reloads', () => {
    const { store } = makeStore();
    const changed = { ...store.load(), displayName: '小屿' };
    store.save(changed);
    expect(store.load()).toEqual(changed);
  });

  it('falls back to the default profile on corrupted file', () => {
    const { dir, store } = makeStore();
    writeFileSync(join(dir, 'pet-profile.json'), '{broken');
    expect(store.load()).toEqual(DEFAULT_PET_PROFILE);
  });

  it('falls back to the default profile on schema mismatch', () => {
    const { dir, store } = makeStore();
    writeFileSync(join(dir, 'pet-profile.json'), JSON.stringify({ version: 1, petId: 'other' }));
    expect(store.load()).toEqual(DEFAULT_PET_PROFILE);
  });
});
