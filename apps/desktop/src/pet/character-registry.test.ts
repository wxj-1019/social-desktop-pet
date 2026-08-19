// @vitest-environment jsdom
// registry 导入 image-visual（模块级 new Image() 预载奶盖帧），node 环境无 Image → 必须 jsdom
import { describe, expect, it } from 'vitest';

import { PetIdSchema } from '@pet/protocol';

import { CHARACTER_MANIFESTS } from './character-manifests.js';
import { CHARACTERS, getCharacterConfig, listCharacters } from './character-registry.js';

describe('character-registry', () => {
  it('包含 star-isle 和 codenono 两个角色', () => {
    const ids = listCharacters().map((c) => c.id);
    expect(ids).toContain('star-isle');
    expect(ids).toContain('codenono');
  });

  it('每个角色都有 displayName / description / VisualComponent / rendererFactory', () => {
    for (const c of CHARACTERS) {
      expect(c.displayName.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
      expect(typeof c.VisualComponent).toBe('function');
      expect(typeof c.rendererFactory).toBe('function');
    }
  });

  it('getCharacterConfig 按 id 精确返回', () => {
    expect(getCharacterConfig('star-isle').id).toBe('star-isle');
    expect(getCharacterConfig('codenono').id).toBe('codenono');
  });

  it('getCharacterConfig 对未知 id 回退到星屿', () => {
    expect(getCharacterConfig('unknown').id).toBe('star-isle');
    expect(getCharacterConfig(undefined).id).toBe('star-isle');
  });

  it('星屿用 SVG 渲染器，CodeNoNo 用 spritesheet 渲染器', () => {
    // 通过 factory 调用后 dispose 不抛错来间接校验类型正确
    const star = getCharacterConfig('star-isle');
    const r1 = star.rendererFactory(() => {});
    r1.dispose();
    const code = getCharacterConfig('codenono');
    const r2 = code.rendererFactory(() => {});
    r2.dispose();
    expect(r1).not.toBe(r2);
  });
});

describe('registry ↔ manifest ↔ PetId 一致性（形象协议 §11）', () => {
  it('registry 与 manifest 恰好覆盖同一组角色', () => {
    const registryIds = listCharacters()
      .map((c) => c.id)
      .sort();
    const manifestIds = Object.keys(CHARACTER_MANIFESTS).sort();
    expect(registryIds).toEqual(manifestIds);
  });

  it('每个角色 id 都是合法 PetId（新增角色必须先扩协议枚举）', () => {
    for (const id of Object.keys(CHARACTER_MANIFESTS)) {
      expect(PetIdSchema.options).toContain(id);
    }
  });

  it('registry 卡片文案与 manifest 同源一致（displayName/description/petName）', () => {
    for (const c of CHARACTERS) {
      const manifest = CHARACTER_MANIFESTS[c.id];
      expect(manifest).toBeDefined();
      expect(c.displayName).toBe(manifest!.displayName);
      expect(c.description).toBe(manifest!.description);
      expect(c.petName).toBe(manifest!.petName);
    }
  });

  it('manifest release 级别满足迁移定位（§12）：星屿 bundled，其余 dev-only', () => {
    expect(CHARACTER_MANIFESTS['star-isle']!.release).toBe('bundled');
    expect(CHARACTER_MANIFESTS['codenono']!.release).toBe('dev-only');
    expect(CHARACTER_MANIFESTS['cream-kitten']!.release).toBe('dev-only');
  });
});
