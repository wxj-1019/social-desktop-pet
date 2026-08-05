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

  it('adds depth layers: tail belly and head shine', () => {
    const html = renderToStaticMarkup(<StarIsleVisual state={DEFAULT_VISUAL_STATE} />);
    expect(html).toContain('data-part="tail-belly"');
    expect(html).toContain('star-isle__headshine');
  });

  it('splits hind feet into independent parts for walk animation', () => {
    const html = renderToStaticMarkup(<StarIsleVisual state={DEFAULT_VISUAL_STATE} />);
    expect(html).toContain('data-part="foot-left"');
    expect(html).toContain('data-part="foot-right"');
    expect(html).toContain('class="star-isle__foot star-isle__foot-left"');
    expect(html).toContain('class="star-isle__foot star-isle__foot-right"');
  });

  it('wraps all visible parts in the rig group (whole-body bob/bounce anchor)', () => {
    const html = renderToStaticMarkup(<StarIsleVisual state={DEFAULT_VISUAL_STATE} />);
    // rig 组必须包裹所有可见部件（tail 在 rig 内、paw-right 之后闭合）
    const rigOpen = html.indexOf('class="star-isle__rig"');
    const tail = html.indexOf('data-part="tail"');
    const pawRight = html.indexOf('data-part="paw-right"');
    const rigClose = html.indexOf('</g>', pawRight);
    expect(rigOpen).toBeGreaterThan(-1);
    expect(rigOpen).toBeLessThan(tail);
    expect(pawRight).toBeGreaterThan(-1);
    expect(rigClose).toBeGreaterThan(pawRight);
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

  it('reflects the desktop facing direction on the root svg', () => {
    const html = renderToStaticMarkup(
      <StarIsleVisual state={{ ...DEFAULT_VISUAL_STATE, facing: 'left' }} />,
    );
    expect(html).toContain('data-facing="left"');
  });

  it('reflects speaking and reducedMotion on the root svg', () => {
    const html = renderToStaticMarkup(
      <StarIsleVisual state={{ ...DEFAULT_VISUAL_STATE, speaking: true, reducedMotion: true }} />,
    );
    expect(html).toContain('data-speaking="true"');
    expect(html).toContain('data-reduced-motion="true"');
  });

  it('reflects intensity on the root svg (动画幅度档位)', () => {
    const html = renderToStaticMarkup(
      <StarIsleVisual state={{ ...DEFAULT_VISUAL_STATE, intensity: 3 }} />,
    );
    expect(html).toContain('data-intensity="3"');
    const defaultHtml = renderToStaticMarkup(<StarIsleVisual />);
    expect(defaultHtml).toContain('data-intensity="1"');
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

  it('head variant uses a square head-focused viewBox (面板头像取景)', () => {
    const html = renderToStaticMarkup(<StarIsleVisual variant="head" />);
    expect(html).toContain('viewBox="80 90 120 120"');
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it('generates unique gradient ids for co-located instances (面板多头像共存)', () => {
    const html = renderToStaticMarkup(
      <>
        <StarIsleVisual />
        <StarIsleVisual variant="head" />
      </>,
    );
    const ids = [...html.matchAll(/id="fur-grad-([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
