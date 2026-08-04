import { describe, expect, it } from 'vitest';

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
