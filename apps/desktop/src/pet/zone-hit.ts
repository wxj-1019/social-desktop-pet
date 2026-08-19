/**
 * zone-hit —— manifest 交互区域的纯几何命中（形象协议阶段 C，§6）。
 *
 * 输入是 240×260 逻辑画布坐标（PetExperience 负责从 client 坐标换算），
 * 输出命中 zone id（按 priority 升序取第一个包含点的启用区域）。
 * zone → 交互指令的映射保持现行为：head/tail 保留专属指令，
 * 其余（primary/自定义）一律 body_touch —— 通用运行时不把 primary
 * 强行解释为"摸头/摸身"（§6.3）。
 */
import type { CharacterInteractionZone, PetInteraction } from '@pet/protocol';

function zoneContains(zone: CharacterInteractionZone, px: number, py: number): boolean {
  switch (zone.shape) {
    case 'rect':
      return px >= zone.x && px < zone.x + zone.width && py >= zone.y && py < zone.y + zone.height;
    case 'circle':
      return Math.hypot(px - zone.cx, py - zone.cy) <= zone.r;
    case 'ellipse': {
      const dx = (px - zone.cx) / zone.rx;
      const dy = (py - zone.cy) / zone.ry;
      return dx * dx + dy * dy <= 1;
    }
    case 'polygon': {
      // 射线法：向右水平射线与多边形边的交点数为奇数则在内部
      let inside = false;
      const n = zone.points.length;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = zone.points[j]!;
        const b = zone.points[i]!;
        if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
          inside = !inside;
        }
      }
      return inside;
    }
  }
}

/** 按 priority 升序返回第一个包含逻辑点的启用区域 id；无命中返回 null */
export function hitTestZone(
  zones: readonly CharacterInteractionZone[],
  point: { x: number; y: number },
): string | null {
  const ordered = [...zones].sort((a, b) => a.priority - b.priority);
  for (const zone of ordered) {
    if (zone.enabled === false) continue;
    if (zoneContains(zone, point.x, point.y)) return zone.id;
  }
  return null;
}

/** zone id → 交互指令（legacy head/tail 专属，其余通用触摸） */
export function zoneToInteractionKind(zoneId: string): PetInteraction['kind'] {
  if (zoneId === 'head') return 'head_touch';
  if (zoneId === 'tail') return 'tail_touch';
  return 'body_touch';
}
