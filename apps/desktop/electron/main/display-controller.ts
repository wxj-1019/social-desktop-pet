/**
 * DisplayController —— 对应设计稿 8.5 多显示器。
 *
 * 本地持久化：显示器 ID、工作区、缩放因子、锚点、相对坐标和宠物缩放。
 * 恢复时找不到原显示器则回到主屏，并将角色夹在可见区域内；坐标必须支持负数。
 *
 * 本文件为纯逻辑（可单测），Electron screen 依赖由 main 注入。
 */

import { z } from 'zod';

export interface DisplayInfo {
  id: string;
  /** 显示器工作区（相对虚拟桌面坐标，可为负） */
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

/** 轻量显示器形态（DisplayInfo 的宽松版本，供拖动等不关心缩放因子的场景） */
export interface DisplayLike {
  id: string;
  /** 显示器工作区（相对虚拟桌面坐标，可为负） */
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor?: number;
}

/** 持久化的宠物位置（相对锚点 = 相对所属显示器工作区的偏移） */
export interface PetPosition {
  displayId: string;
  /** 相对显示器工作区左上角的偏移（可为负） */
  anchorX: number;
  anchorY: number;
  scale: number;
  savedAt: number;
}

export const DEFAULT_PET_SCALE = 1;
export const MIN_PET_SCALE = 0.5;
export const MAX_PET_SCALE = 2;

/**
 * 持久化 PetPosition 的校验 schema（与上方 PetPosition 类型结构兼容）。
 * anchor 是相对显示器工作区的像素偏移（可为负，如左侧副屏），限定在合理虚拟桌面范围；
 * scale 限制在 [MIN_PET_SCALE, MAX_PET_SCALE]；savedAt 必须有限；.strict() 拒绝未知字段。
 */
export const PetPositionSchema = z
  .object({
    displayId: z.string(),
    anchorX: z.number().finite().min(-100_000).max(100_000),
    anchorY: z.number().finite().min(-100_000).max(100_000),
    scale: z.number().min(MIN_PET_SCALE).max(MAX_PET_SCALE),
    savedAt: z.number().finite(),
  })
  .strict();

/**
 * 计算宠物在虚拟桌面坐标系中的绝对位置。
 * 支持负数坐标（主屏右侧的副屏，或副屏在主屏左侧）。
 */
export function toAbsolute(display: DisplayInfo, pos: PetPosition): { x: number; y: number } {
  return {
    x: display.workArea.x + pos.anchorX,
    y: display.workArea.y + pos.anchorY,
  };
}

/**
 * 恢复位置：找到持久化时的显示器则恢复，找不到则回主屏（8.5）。
 * 同时把位置夹进目标显示器可见区域内（防角色跑出屏幕外）。
 */
export function resolvePetPosition(
  saved: PetPosition | null,
  displays: DisplayInfo[],
  petSize: { width: number; height: number },
): { display: DisplayInfo; x: number; y: number; scale: number } {
  // 1. 找持久化显示器。空 displayId（出厂默认值，PositionStore 无文件时返回）
  //    或显示器已失效（拔屏/ID 变化）→ 回主屏并丢弃旧偏移，避免把失效
  //    显示器的锚点套到主屏上导致角色贴边甚至大半跑出屏幕。
  const savedDisplay =
    saved && saved.displayId ? displays.find((d) => d.id === saved.displayId) : undefined;
  const target = savedDisplay ?? displays[0];
  if (!target) throw new Error('DisplayController: 无可用显示器');

  // 2. 计算绝对位置（负数坐标支持）：仅保存位置确实可用时才恢复，
  //    否则回默认（目标屏底部中央）
  const scale = clamp(saved?.scale ?? DEFAULT_PET_SCALE, MIN_PET_SCALE, MAX_PET_SCALE);
  const abs =
    savedDisplay && saved
      ? toAbsolute(target, saved)
      : {
          x: target.workArea.x + (target.workArea.width - petSize.width) / 2,
          y: target.workArea.y + target.workArea.height - petSize.height - 8,
        };

  // 3. 恢复位置必须完整落在工作区内：拖到屏幕边缘的位置会被持久化，若原样
  //    恢复角色会探出屏幕被裁掉（用户反馈：卡在右边缘）。恢复时夹进完整
  //    工作区（实时拖动的钳制规则与此一致，见 clampPetWindowToDisplays）。
  const x = clamp(
    abs.x,
    target.workArea.x,
    target.workArea.x + Math.max(0, target.workArea.width - petSize.width),
  );
  const y = clamp(
    abs.y,
    target.workArea.y,
    target.workArea.y + Math.max(0, target.workArea.height - petSize.height),
  );

  return { display: target, x, y, scale };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 把当前绝对位置转回相对锚点（保存前调用） */
export function toAnchor(
  display: DisplayInfo,
  abs: { x: number; y: number },
): Pick<PetPosition, 'anchorX' | 'anchorY'> {
  return {
    anchorX: abs.x - display.workArea.x,
    anchorY: abs.y - display.workArea.y,
  };
}

/**
 * 把窗口绝对位置转成可持久化的 PetPosition（Task 12，拖动结束保存用）。
 * 找不到所在显示器（窗口在虚拟桌面外）返回 null；找到则按该显示器工作区算锚点。
 */
export function toPersistedPosition(
  displays: DisplayInfo[],
  abs: { x: number; y: number },
): PetPosition | null {
  const current = displays.find(
    (d) =>
      abs.x >= d.workArea.x &&
      abs.x < d.workArea.x + d.workArea.width &&
      abs.y >= d.workArea.y &&
      abs.y < d.workArea.y + d.workArea.height,
  );
  if (!current) return null;
  const anchor = toAnchor(current, abs);
  return {
    displayId: current.id,
    anchorX: anchor.anchorX,
    anchorY: anchor.anchorY,
    scale: 1,
    savedAt: Date.now(),
  };
}

/**
 * 拖动时把目标位置夹进可见区域（与 resolvePetPosition 规则一致）：
 * 目标左上角所在显示器内夹取，**窗口完整落在工作区内**（用户反馈：桌宠
 * 探出屏幕边缘会被裁掉，拖动与恢复都不允许跑出屏幕）。
 * 保留负坐标（支持左侧副屏）；无显示器时原样返回。
 */
export function clampPetWindowToDisplays(
  target: { x: number; y: number },
  displays: DisplayLike[],
  petSize: { width: number; height: number },
): { x: number; y: number } {
  const current =
    displays.find(
      (d) =>
        target.x >= d.workArea.x &&
        target.x < d.workArea.x + d.workArea.width &&
        target.y >= d.workArea.y &&
        target.y < d.workArea.y + d.workArea.height,
    ) ?? displays[0];
  if (!current) return { x: target.x, y: target.y };

  return {
    x: clamp(
      target.x,
      current.workArea.x,
      current.workArea.x + Math.max(0, current.workArea.width - petSize.width),
    ),
    y: clamp(
      target.y,
      current.workArea.y,
      current.workArea.y + Math.max(0, current.workArea.height - petSize.height),
    ),
  };
}

/**
 * 把面板锚定到宠物窗口旁边：优先宠物右侧；放不下则左侧；两侧都放不下则夹进工作区
 * （至少部分可见）。y 与宠物顶部对齐。返回整数坐标。
 */
export function anchorPanelToPet(
  pet: { x: number; y: number; width: number; height: number },
  panel: { width: number; height: number },
  workArea: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  const rightX = pet.x + pet.width;

  // 1. 优先右侧
  if (rightX + panel.width <= workArea.x + workArea.width) {
    return { x: Math.round(rightX), y: Math.round(pet.y) };
  }

  // 2. 放不下则左侧
  const leftX = pet.x - panel.width;
  if (leftX >= workArea.x) {
    return { x: Math.round(leftX), y: Math.round(pet.y) };
  }

  // 3. 两侧都放不下 → 夹进工作区（保留至少 1/4 可见）
  const visibleW = panel.width * 0.25;
  const visibleH = panel.height * 0.25;
  const x = clamp(
    rightX,
    workArea.x - panel.width + visibleW,
    workArea.x + workArea.width - visibleW,
  );
  const y = clamp(
    pet.y,
    workArea.y - panel.height + visibleH,
    workArea.y + workArea.height - visibleH,
  );
  return { x: Math.round(x), y: Math.round(y) };
}
