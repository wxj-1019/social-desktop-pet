import { describe, expect, it } from 'vitest';

import { computeClassicMenuGeometry } from './classic-menu.js';

describe('computeClassicMenuGeometry（经典环状菜单窗口适配几何）', () => {
  it('240×260 基准窗口：节点坐标还原设计值', () => {
    const g = computeClassicMenuGeometry(240, 260);
    expect(g.nodePositions[0]).toEqual({ x: 152, y: 42 });
    expect(g.nodePositions[5]).toEqual({ x: 90, y: 240 });
  });

  it('引导环完整落在窗口内（原设计 r=108 右/下缘超窗被裁，已钳制）', () => {
    const g = computeClassicMenuGeometry(240, 260);
    expect(g.ring.cx - g.ring.r).toBeGreaterThanOrEqual(0);
    expect(g.ring.cx + g.ring.r).toBeLessThanOrEqual(240);
    expect(g.ring.cy - g.ring.r).toBeGreaterThanOrEqual(0);
    expect(g.ring.cy + g.ring.r).toBeLessThanOrEqual(260);
  });

  it('小窗 168×182（缩放 70%）：全部节点钳进窗口（32px 直径留边距），环完整', () => {
    const g = computeClassicMenuGeometry(168, 182);
    for (const p of g.nodePositions) {
      expect(p.x).toBeGreaterThanOrEqual(18);
      expect(p.x).toBeLessThanOrEqual(168 - 18);
      expect(p.y).toBeGreaterThanOrEqual(18);
      expect(p.y).toBeLessThanOrEqual(182 - 18);
    }
    expect(g.ring.cx + g.ring.r).toBeLessThanOrEqual(168);
    expect(g.ring.cy + g.ring.r).toBeLessThanOrEqual(182);
  });

  it('二级面板在小窗下：left 钳进窗口、高度压缩并完整可见', () => {
    const g = computeClassicMenuGeometry(168, 182);
    expect(g.sub.left).toBeGreaterThanOrEqual(8);
    expect(g.sub.left + 148).toBeLessThanOrEqual(168);
    expect(g.sub.top).toBeGreaterThanOrEqual(8);
    expect(g.sub.maxHeight).toBeGreaterThanOrEqual(80);
    expect(g.sub.top + g.sub.maxHeight).toBeLessThanOrEqual(182);
  });
});
