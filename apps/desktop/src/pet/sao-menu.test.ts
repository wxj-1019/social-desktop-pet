import { describe, expect, it } from 'vitest';

import { computeSaoMenuGeometry } from './sao-menu.js';

describe('computeSaoMenuGeometry（SAO 菜单窗口适配几何）', () => {
  it('240×260 基准窗口：还原设计坐标（r=110、节点 14px）', () => {
    const g = computeSaoMenuGeometry(240, 260);
    expect(g.track).toEqual({ cx: 126, cy: 142.7, r: 110 });
    expect(g.nodeRadius).toBe(14);
    expect(g.closeRadius).toBe(10);
    // close 锚点 = 66°：x = 126 − 110·cos66 ≈ 81.3, y = 142.7 − 110·sin66 ≈ 42.2
    expect(g.points.close.x).toBeCloseTo(81.3, 0);
    expect(g.points.close.y).toBeCloseTo(42.2, 0);
    // controls 锚点 = −54°：y = 142.7 + 110·sin54 ≈ 231.7
    expect(g.points.controls.x).toBeCloseTo(61.3, 0);
    expect(g.points.controls.y).toBeCloseTo(231.7, 0);
    expect(g.segments.length).toBe(6);
  });

  it('小窗 168×182（缩放 70%）：弧与节点完整落在窗口内，节点不小于可读下限', () => {
    const g = computeSaoMenuGeometry(168, 182);
    expect(g.track.r).toBeCloseTo(Math.min((110 * 168) / 240, (110 * 182) / 260), 5);
    for (const p of Object.values(g.points)) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(168);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(182);
    }
    // 节点半径有下限：内容不随小窗等比缩到看不清
    expect(g.nodeRadius).toBeGreaterThanOrEqual(11);
    expect(g.nodeRadius).toBeLessThan(14);
    for (const seg of g.segments) {
      expect(seg.length).toBeGreaterThan(0);
    }
  });

  it('subPanelPos 在小窗下：面板完整落在窗口内', () => {
    const g = computeSaoMenuGeometry(168, 182);
    const pos = g.subPanelPos(g.points.controls, 190);
    expect(pos.left).toBeGreaterThanOrEqual(8);
    expect(pos.left + pos.width).toBeLessThanOrEqual(168);
    expect(pos.top).toBeGreaterThanOrEqual(8);
    expect(pos.top + pos.height).toBeLessThanOrEqual(182);
    expect(pos.width).toBeLessThanOrEqual(168);
    // 请求高度超过窗口时压缩（内部滚动兜底）
    expect(pos.height).toBeLessThanOrEqual(166);
  });

  it('大窗 300×325（缩放 125%）：几何随窗口放大，仍完整可见', () => {
    const g = computeSaoMenuGeometry(300, 325);
    expect(g.track.r).toBeCloseTo(Math.min((110 * 300) / 240, (110 * 325) / 260), 5);
    for (const p of Object.values(g.points)) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(300);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(325);
    }
  });
});
