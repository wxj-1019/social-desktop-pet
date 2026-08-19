// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CharacterVisual, useCurrentCharacter } from './character-visual.js';

let changedCb: ((profile: { petId: string }) => void) | undefined;

function installFakeProfile(petId: string): void {
  const profile = {
    version: 1,
    petId,
    displayName: 'x',
    reducedMotion: false,
    dnd: false,
    bubbleEnabled: true,
  };
  changedCb = undefined;
  (window as unknown as { pet: unknown }).pet = {
    petProfile: {
      get: vi.fn(async () => profile),
      onChanged: vi.fn((cb: (p: { petId: string }) => void) => {
        changedCb = cb;
        return () => undefined;
      }),
    },
  };
}

beforeEach(() => installFakeProfile('star-isle'));
afterEach(cleanup);

describe('CharacterVisual（面板侧统一视觉入口）', () => {
  it('默认渲染当前角色（星屿 SVG）', async () => {
    render(<CharacterVisual />);
    expect(await screen.findByRole('img', { name: '星尾狐猫星屿' })).not.toBeNull();
    expect(document.querySelector('.character-visual')).not.toBeNull();
  });

  it('petId prop 显式指定时渲染对应角色（不受 profile 影响）', () => {
    render(<CharacterVisual petId="codenono" />);
    expect(document.querySelector('.spritesheet-pet')).not.toBeNull();
  });

  it('profile 切换角色后经 onChanged 实时换装', async () => {
    render(<CharacterVisual />);
    expect(await screen.findByRole('img', { name: '星尾狐猫星屿' })).not.toBeNull();
    act(() => changedCb?.({ petId: 'cream-kitten' }));
    expect(await screen.findByRole('img', { name: '奶油小猫' })).not.toBeNull();
  });

  it('window.pet 缺失时回退星屿，不抛错', () => {
    (window as unknown as { pet: unknown }).pet = undefined;
    render(<CharacterVisual />);
    expect(document.querySelector('.star-isle')).not.toBeNull();
  });

  it('useCurrentCharacter 暴露 config 与 manifest（含 petName/renderer）', async () => {
    let hook: ReturnType<typeof useCurrentCharacter> | null = null;
    function Probe() {
      hook = useCurrentCharacter();
      return null;
    }
    render(<Probe />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook!.config.petName).toBe('星屿');
    expect(hook!.manifest.renderer).toBe('svg');
  });

  it('className prop 合并到根元素', () => {
    render(<CharacterVisual className="extra" />);
    const root = document.querySelector('.character-visual');
    expect(root?.className).toBe('character-visual extra');
  });

  it('显式 petId 时不跟随 profile 变化（缩略图语义）', async () => {
    render(<CharacterVisual petId="codenono" />);
    await screen.findByRole('img', { name: 'CodeNoNo' });
    act(() => changedCb?.({ petId: 'cream-kitten' }));
    expect(document.querySelector('.spritesheet-pet')).not.toBeNull();
  });
});
