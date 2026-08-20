import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PetIdSchema, type PetId } from '@pet/protocol';

import { CHARACTER_MANIFESTS, getCharacterManifest } from './character-manifests.js';
import { CREAM_KITTEN_FRAME_MAP } from './image-frame-manifest.js';

const ALL_MOTIONS = [
  'idle',
  'walk',
  'sit',
  'sleep',
  'happy',
  'sad',
  'surprised',
  'wave',
  'touch',
  'talk',
  'dragged',
] as const;
const ALL_EXPRESSIONS = ['neutral', 'warm', 'happy', 'sad', 'surprised', 'shy'] as const;

/** assets.path 相对 apps/desktop/src 解析（character-manifests.ts 位于 src/pet/） */
function resolveAsset(p: string): string {
  return join(__dirname, '..', p);
}

describe('CHARACTER_MANIFESTS（形象协议阶段 B）', () => {
  it('覆盖全部 PetId，键与 manifest.id 一致', () => {
    expect([...Object.keys(CHARACTER_MANIFESTS)].sort()).toEqual([...PetIdSchema.options].sort());
    for (const [id, manifest] of Object.entries(CHARACTER_MANIFESTS)) {
      expect(manifest.id).toBe(id as PetId);
    }
  });

  it('星屿是 core-reference：bundled 级 + 三命中区（§12.1）', () => {
    const m = CHARACTER_MANIFESTS['star-isle']!;
    expect(m.release).toBe('bundled');
    expect(m.renderer).toBe('svg');
    expect(m.capabilities.interactionZones).toEqual(['primary', 'head', 'tail']);
    for (const motion of ALL_MOTIONS) expect(m.capabilities.coreMotions[motion]).toBe('native');
    for (const expr of ALL_EXPRESSIONS) expect(m.capabilities.expressions[expr]).toBe('native');
  });

  it('CodeNoNo：dev-only（许可未确认）+ 单 primary 区（§12.2）', () => {
    const m = CHARACTER_MANIFESTS['codenono']!;
    expect(m.release).toBe('dev-only');
    expect(m.license.commercialUse).toBe(false);
    expect(m.license.sourceUrl).toBe('https://github.com/Dqd02/CodeX_Pet_NoNo');
    expect(m.capabilities.interactionZones).toEqual(['primary']);
    for (const motion of ALL_MOTIONS) expect(m.capabilities.coreMotions[motion]).toBe('native');
  });

  it('奶盖：dev-only（来源未归档）+ 私有行为进扩展命名空间（§12.3）', () => {
    const m = CHARACTER_MANIFESTS['cream-kitten']!;
    expect(m.release).toBe('dev-only');
    expect(m.license.sourceUrl).toBeNull();
    expect(m.capabilities.interactionZones).toEqual(['primary']);
    expect(m.extensions.namespace).toBe('cream-kitten');
    for (const action of m.extensions.actions) {
      expect(action.startsWith('cream-kitten:')).toBe(true);
    }
    // 已知事实如实声明：blink 与 idle 是同一张图（sha256 相同）
    const blink = m.assets.files.find((f) => f.path.endsWith('blink.png'));
    const idle = m.assets.files.find((f) => f.path.endsWith('idle.png'));
    expect(blink && idle && blink.sha256 === idle.sha256).toBe(true);
  });

  it('fallback 链全部终止于 native/unsupported，无环（§7.2）', () => {
    for (const manifest of Object.values(CHARACTER_MANIFESTS)) {
      const followChain = (
        table: Record<string, string>,
        start: string,
        kind: 'motion' | 'expression',
      ): void => {
        const seen = new Set<string>([start]);
        let current = table[start]!;
        while (current.startsWith('fallback:')) {
          const target = current.slice('fallback:'.length);
          expect(seen.has(target), `${manifest.id} ${kind} fallback cycle at ${target}`).toBe(
            false,
          );
          seen.add(target);
          current = table[target]!;
        }
        expect(['native', 'unsupported']).toContain(current);
      };
      for (const motion of ALL_MOTIONS) {
        followChain(manifest.capabilities.coreMotions, motion, 'motion');
      }
      for (const expr of ALL_EXPRESSIONS) {
        followChain(manifest.capabilities.expressions, expr, 'expression');
      }
    }
  });

  it('资产文件存在且 sha256 与磁盘一致（§10.2 完整性）', () => {
    for (const manifest of Object.values(CHARACTER_MANIFESTS)) {
      for (const file of manifest.assets.files) {
        const abs = resolveAsset(file.path);
        expect(existsSync(abs), `${file.path} missing`).toBe(true);
        const hash = createHash('sha256').update(readFileSync(abs)).digest('hex');
        expect(hash, `${file.path} sha256 mismatch`).toBe(file.sha256);
      }
    }
  });

  it('getCharacterManifest 未知 id 回退星屿（与 registry 语义一致）', () => {
    expect(getCharacterManifest('not-a-pet').id).toBe('star-isle');
  });

  it('奶盖帧表与 manifest 资产清单双向绑定（§10.2 完整性）', () => {
    const m = CHARACTER_MANIFESTS['cream-kitten']!;
    const manifestPaths = new Set(m.assets.files.map((f) => f.path));
    for (const spec of Object.values(CREAM_KITTEN_FRAME_MAP)) {
      for (const url of spec.frames) {
        const base = url.split('/').pop()!;
        const hit = [...manifestPaths].some((p) => p.endsWith(`/${base}`));
        expect(hit, `帧表 URL 未入清单：${base}`).toBe(true);
      }
    }
    expect(manifestPaths.size).toBe(12);
  });
});
