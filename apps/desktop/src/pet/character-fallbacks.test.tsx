// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CHARACTERS } from './character-registry.js';

afterEach(cleanup);

describe('每角色专属错误降级（协议 §11.8）', () => {
  it('全部角色声明 FallbackComponent', () => {
    for (const c of CHARACTERS) {
      expect(c.FallbackComponent, `${c.id} 应有专属降级组件`).toBeTypeOf('function');
    }
  });

  it('CodeNoNo 降级渲染静态 spritesheet 标记（含 viewport）', () => {
    const entry = CHARACTERS.find((c) => c.id === 'codenono')!;
    const Fallback = entry.FallbackComponent!;
    const { container } = render(<Fallback />);
    expect(container.querySelector('.spritesheet-pet__viewport')).not.toBeNull();
  });

  it('奶盖降级渲染静态图片标记（含 img）', () => {
    const entry = CHARACTERS.find((c) => c.id === 'cream-kitten')!;
    const Fallback = entry.FallbackComponent!;
    const { container } = render(<Fallback />);
    expect(container.querySelector('.image-pet__img')).not.toBeNull();
  });
});
