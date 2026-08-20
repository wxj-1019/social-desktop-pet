import { describe, expect, it } from 'vitest';

import { runCharacterPreflight } from './character-preflight.js';

describe('runCharacterPreflight（资源预检，协议 §10/§12/§14）', () => {
  const result = runCharacterPreflight();

  it('当前数据零 error（分层门禁下全绿——本任务验收线）', () => {
    expect(result.errors).toEqual([]);
  });

  it('奶盖帧画布不一致按层级降级为 warning（dev-only，§12）', () => {
    const warnings = result.warnings.filter((w) => w.id === 'frame-canvas-consistency');
    expect(warnings.some((w) => w.characterId === 'cream-kitten')).toBe(true);
  });

  it('硬检查覆盖全部资产（哈希复核跑真实磁盘文件）', () => {
    expect(result.checkedAssets).toBeGreaterThanOrEqual(13); // 1 webp + 12 png
  });

  it('未引用资产报告为空（idle_gs.jpg 已删除）', () => {
    expect(result.warnings.filter((w) => w.id === 'unreferenced-asset')).toEqual([]);
  });

  it('spritesheet 网格整除校验通过（CodeNoNo）', () => {
    expect(result.errors.filter((e) => e.id === 'spritesheet-grid')).toEqual([]);
  });

  it('warning 集精确锁定（任何增删都是有意识变更）', () => {
    const ids = result.warnings.map((w) => `${w.characterId}:${w.id}`).sort();
    expect(ids).toEqual([
      'codenono:preview-missing',
      'cream-kitten:frame-canvas-consistency',
      'cream-kitten:license-incomplete',
      'cream-kitten:preview-missing',
      'star-isle:preview-missing',
    ]);
  });
});
