// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DEFAULT_VISUAL_STATE } from './pet-renderer.js';
import { renderStaticStarIsle, StarIsleVisual } from './star-isle-visual.js';

const PARTS = [
  'ear-left',
  'ear-right',
  'head',
  'crown',
  'body',
  'paw-left',
  'paw-right',
  'tail',
  'tail-star',
];

describe('StarIsleVisual（原创分层 SVG 星屿）', () => {
  it('renders every layered data-part with unique names', () => {
    const html = renderToStaticMarkup(<StarIsleVisual state={DEFAULT_VISUAL_STATE} />);
    for (const part of PARTS) {
      expect(html).toContain(`data-part="${part}"`);
    }
  });

  it('uses the fixed viewBox, role and aria-label', () => {
    const html = renderToStaticMarkup(<StarIsleVisual state={DEFAULT_VISUAL_STATE} />);
    expect(html).toContain('viewBox="0 0 320 380"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="星尾狐猫星屿"');
  });

  it('keeps ears inside the head group so head animations carry them', () => {
    const html = renderToStaticMarkup(<StarIsleVisual state={DEFAULT_VISUAL_STATE} />);
    const headOpen = html.indexOf('data-part="head"');
    const earLeft = html.indexOf('data-part="ear-left"');
    const earRight = html.indexOf('data-part="ear-right"');
    // head 组必须先于耳朵出现，且其闭合 </g> 在耳朵之后 → 耳朵是 head 的子组
    expect(headOpen).toBeGreaterThan(-1);
    expect(earLeft).toBeGreaterThan(headOpen);
    expect(earRight).toBeGreaterThan(headOpen);
    expect(html.slice(headOpen).indexOf('</g>')).toBeGreaterThan(
      html.slice(earLeft).indexOf('</g>'),
    );
  });

  it('exposes transparent hit rects for head/body/tail interaction', () => {
    const html = renderToStaticMarkup(<StarIsleVisual state={DEFAULT_VISUAL_STATE} />);
    for (const part of ['head', 'body', 'tail']) {
      expect(html).toContain(`<g data-part="${part}" data-hit="${part}"`);
      expect(html).toMatch(
        new RegExp(`data-part="${part}"[^>]*>[\\s\\S]*?<rect[^>]*data-hit-rect`),
      );
    }
  });

  it('reflects motion and expression on the root svg', () => {
    const html = renderToStaticMarkup(
      <StarIsleVisual
        state={{ ...DEFAULT_VISUAL_STATE, motion: 'happy', expression: 'surprised' }}
      />,
    );
    expect(html).toContain('data-motion="happy"');
    expect(html).toContain('data-expression="surprised"');
  });

  it('reflects speaking and reducedMotion on the root svg', () => {
    const html = renderToStaticMarkup(
      <StarIsleVisual state={{ ...DEFAULT_VISUAL_STATE, speaking: true, reducedMotion: true }} />,
    );
    expect(html).toContain('data-speaking="true"');
    expect(html).toContain('data-reduced-motion="true"');
  });

  it('defaults to idle/warm when no state prop is given', () => {
    const html = renderToStaticMarkup(<StarIsleVisual />);
    expect(html).toContain('data-motion="idle"');
    expect(html).toContain('data-expression="warm"');
    expect(html).toContain('data-reduced-motion="false"');
  });

  it('keeps the required anatomy classes as CSS animation hooks', () => {
    const html = renderToStaticMarkup(<StarIsleVisual state={DEFAULT_VISUAL_STATE} />);
    for (const cls of [
      'star-isle__tail',
      'star-isle__tail-star',
      'star-isle__body',
      'star-isle__head',
      'star-isle__ear',
      'star-isle__eye',
      'star-isle__mouth',
      'star-isle__crown',
      'star-isle__cheek',
      'star-isle__paw',
    ]) {
      expect(html).toContain(cls);
    }
  });

  it('is fully self-contained vector art (no raster or external references)', () => {
    const html = renderToStaticMarkup(<StarIsleVisual state={DEFAULT_VISUAL_STATE} />);
    expect(html).not.toContain('<image');
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('renderStaticStarIsle produces standalone static markup', () => {
    const html = renderStaticStarIsle();
    expect(html).toContain('data-part="tail-star"');
    expect(html).toContain('data-part="head"');
    expect(html).toContain('data-reduced-motion="false"');
  });
});
