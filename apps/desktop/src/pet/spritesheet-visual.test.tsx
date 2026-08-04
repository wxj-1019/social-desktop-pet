// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { StarIsleVisualState } from './pet-renderer.js';
import { renderStaticSpritesheet, SpritesheetVisual } from './spritesheet-visual.js';

const IDLE: StarIsleVisualState = {
  motion: 'idle',
  expression: 'warm',
  intensity: 1,
  speaking: false,
  reducedMotion: true, // SSR 渲染用静态态，不启动 rAF
  facing: 'right',
};

describe('SpritesheetVisual（CodeNoNo spritesheet 角色）', () => {
  it('渲染 data-hit=body 命中区（交互兼容）', () => {
    const html = renderToStaticMarkup(<SpritesheetVisual state={IDLE} />);
    expect(html).toContain('data-hit="body"');
  });

  it('写入 role/aria-label 与 data-* 状态属性', () => {
    const html = renderToStaticMarkup(<SpritesheetVisual state={IDLE} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="CodeNoNo"');
    expect(html).toContain('data-motion="idle"');
    expect(html).toContain('data-expression="warm"');
    expect(html).toContain('data-reduced-motion="true"');
    expect(html).toContain('data-facing="right"');
    expect(html).toContain('data-frame="0"');
  });

  it('左向 walk 使用独立的左向奔跑行', () => {
    const html = renderToStaticMarkup(
      <SpritesheetVisual state={{ ...IDLE, motion: 'walk', facing: 'left' }} />,
    );
    expect(html).toContain('data-facing="left"');
    expect(html).toContain('data-animation="motion:walk:left"');
    expect(html).toContain('translate(-0px, -416px)');
  });

  it('内层 img 引用 spritesheet 资产', () => {
    const html = renderToStaticMarkup(<SpritesheetVisual state={IDLE} />);
    // 视口裁剪方案：<img src="...spritesheet.webp"> 显示完整图集
    expect(html).toContain('<img');
    expect(html).toContain('src=');
  });

  it('renderStaticSpritesheet 在无 DOM 环境产出 markup', () => {
    const html = renderStaticSpritesheet();
    expect(html).toContain('data-hit="body"');
    expect(html).toContain('aria-label="CodeNoNo"');
  });

  it('不同 motion 反映到 data-motion 属性', () => {
    const walkHtml = renderToStaticMarkup(
      <SpritesheetVisual state={{ ...IDLE, motion: 'walk' }} />,
    );
    expect(walkHtml).toContain('data-motion="walk"');
  });
});
