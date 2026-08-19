import { describe, expect, it } from 'vitest';

import type { CharacterInteractionZone } from '@pet/protocol';

import { hitTestZone, zoneToInteractionKind } from './zone-hit.js';

const rect = (
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  priority = 0,
): CharacterInteractionZone => ({
  id,
  shape: 'rect',
  x,
  y,
  width: w,
  height: h,
  priority,
  label: id,
  enabled: true,
});

describe('hitTestZone（manifest 区域几何命中，协议 §6）', () => {
  it('rect：内点命中、边缘外不命中', () => {
    const zones = [rect('primary', 80, 174, 89, 80)];
    expect(hitTestZone(zones, { x: 124, y: 214 })).toBe('primary');
    expect(hitTestZone(zones, { x: 79, y: 214 })).toBeNull();
    expect(hitTestZone(zones, { x: 169.5, y: 174 })).toBeNull();
  });

  it('circle：按圆心距判定', () => {
    const zones: CharacterInteractionZone[] = [
      { id: 'c', shape: 'circle', cx: 100, cy: 100, r: 30, priority: 0, label: 'c', enabled: true },
    ];
    expect(hitTestZone(zones, { x: 129, y: 100 })).toBe('c');
    expect(hitTestZone(zones, { x: 131, y: 100 })).toBeNull();
  });

  it('ellipse：归一化距离判定', () => {
    const zones: CharacterInteractionZone[] = [
      {
        id: 'e',
        shape: 'ellipse',
        cx: 100,
        cy: 100,
        rx: 40,
        ry: 20,
        priority: 0,
        label: 'e',
        enabled: true,
      },
    ];
    expect(hitTestZone(zones, { x: 139, y: 100 })).toBe('e');
    expect(hitTestZone(zones, { x: 139, y: 110 })).toBeNull();
  });

  it('polygon：射线法判定（含凹多边形）', () => {
    const zones: CharacterInteractionZone[] = [
      {
        id: 'p',
        shape: 'polygon',
        priority: 0,
        label: 'p',
        enabled: true,
        points: [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 40, y: 30 },
          { x: 20, y: 15 },
          { x: 0, y: 30 },
        ],
      },
    ];
    expect(hitTestZone(zones, { x: 20, y: 5 })).toBe('p');
    expect(hitTestZone(zones, { x: 20, y: 25 })).toBeNull();
  });

  it('priority 小者先命中；重叠时高优先级区域获胜', () => {
    const zones = [rect('big', 0, 0, 200, 200, 5), rect('small', 10, 10, 30, 30, 1)];
    expect(hitTestZone(zones, { x: 20, y: 20 })).toBe('small');
    expect(hitTestZone(zones, { x: 100, y: 100 })).toBe('big');
  });

  it('enabled=false 的区域不参与命中', () => {
    const zones: CharacterInteractionZone[] = [rect('off', 0, 0, 100, 100)];
    (zones[0] as { enabled: boolean }).enabled = false;
    expect(hitTestZone(zones, { x: 50, y: 50 })).toBeNull();
  });

  it('空 zones 数组返回 null（不可交互角色的输入）', () => {
    expect(hitTestZone([], { x: 120, y: 130 })).toBeNull();
  });
});

describe('zoneToInteractionKind（zone → 交互指令，保持现行为）', () => {
  it('head/tail 保留专属指令，其余一律 body_touch（协议 §6.3）', () => {
    expect(zoneToInteractionKind('head')).toBe('head_touch');
    expect(zoneToInteractionKind('tail')).toBe('tail_touch');
    expect(zoneToInteractionKind('primary')).toBe('body_touch');
    expect(zoneToInteractionKind('accessory')).toBe('body_touch');
  });
});
