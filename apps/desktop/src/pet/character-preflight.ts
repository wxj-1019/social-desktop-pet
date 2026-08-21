/**
 * 角色资源预检 —— 形象协议阶段 D（§10/§12/§14）。
 *
 * 纯模块（node 环境）：导入三份 manifest 与两份帧表，复核磁盘资产。
 * 分层门禁：硬检查（存在/哈希/绑定/网格）任何层级都是 error；
 * license 完备 bundled+ 为 error；帧画布一致仅 release 为 error。
 * CI 经 vitest 包装（pnpm test）自动门禁；CLI 入口见 tools/character-preflight-cli.ts。
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHARACTER_MANIFESTS } from './character-manifests.js';
import { CREAM_KITTEN_FRAME_MAP } from './image-frame-manifest.js';
import { CODENONO_MOTION_MAP, FRAME_SIZE, SPRITESHEET_SIZE } from './spritesheet-manifest.js';

export interface PreflightFinding {
  id: string;
  characterId: string;
  message: string;
}

export interface PreflightResult {
  errors: PreflightFinding[];
  warnings: PreflightFinding[];
  checkedAssets: number;
}

/**
 * assets.path 相对 apps/desktop/src（与 character-manifests.test.ts 的解析约定一致）。
 * 用 import.meta.url 而非 __dirname：本模块既跑在 vitest（vite shim）也跑在
 * tsx ESM CLI（apps/desktop 是 "type":"module"，__dirname 不存在）。
 */
const ASSET_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** PNG IHDR 尺寸（大端 u32 ×2 @ offset 16） */
function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * WebP 尺寸（VP8X canvas 24bit；VP8L 14bit；VP8 帧 16bit）——覆盖三种形态。
 * 偏移已对实际 spritesheet.webp（VP8L，1536×1872）复核。
 * 注意判序：lossy 的 FourCC 是 "VP8 "（空格补齐 4 字节），
 * 用 3 字节前缀 "VP8" 会误吞 VP8L/VP8X（实测曾把 VP8L 解析成 603×1758）。
 */
function webpSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8L') {
    // lossless：1B 签名(0x2f) + 14bit 宽/高 + alpha + version，小端位打包
    const b0 = buf[21]!;
    const b1 = buf[22]!;
    const b2 = buf[23]!;
    const b3 = buf[24]!;
    const w = (b0 | ((b1 & 0x3f) << 8)) + 1;
    const h = (((b1 >> 6) | (b2 << 2) | (b3 << 10)) & 0x3fff) + 1;
    return { width: w, height: h };
  }
  if (chunk === 'VP8X') {
    // extended：4B flags/reserved 后是 24bit canvas 宽/高（均减 1 存储）
    const w = buf[24]! | (buf[25]! << 8) | (buf[26]! << 16);
    const h = buf[27]! | (buf[28]! << 8) | (buf[29]! << 16);
    return { width: w + 1, height: h + 1 };
  }
  if (chunk === 'VP8 ') {
    // lossy 关键帧：3B frame tag + 3B start code(0x9d012a) 之后是 14bit 宽高
    const w = buf.readUInt16LE(26) & 0x3fff;
    const h = buf.readUInt16LE(28) & 0x3fff;
    return { width: w + 1, height: h + 1 };
  }
  return null;
}

function imageSize(abs: string): { width: number; height: number } | null {
  const buf = readFileSync(abs);
  return abs.endsWith('.png') ? pngSize(buf) : webpSize(buf);
}

const TIER_ORDER = { 'dev-only': 0, bundled: 1, release: 2 } as const;

export function runCharacterPreflight(): PreflightResult {
  const errors: PreflightFinding[] = [];
  const warnings: PreflightFinding[] = [];
  let checkedAssets = 0;
  const referenced = new Set<string>();

  for (const manifest of Object.values(CHARACTER_MANIFESTS)) {
    const tier = TIER_ORDER[manifest.release];
    const err = (id: string, message: string): void => {
      errors.push({ id, characterId: manifest.id, message });
    };
    const gate = (minTier: 1 | 2, id: string, message: string): void => {
      const finding = { id, characterId: manifest.id, message };
      if (tier >= minTier) errors.push(finding);
      else warnings.push(finding);
    };

    // 硬检查：存在 + sha256
    for (const file of manifest.assets.files) {
      const abs = join(ASSET_ROOT, file.path);
      referenced.add(file.path);
      if (!existsSync(abs)) {
        err('asset-missing', `${file.path} 不存在`);
        continue;
      }
      checkedAssets += 1;
      const hash = createHash('sha256').update(readFileSync(abs)).digest('hex');
      if (hash !== file.sha256) err('asset-hash-mismatch', `${file.path} sha256 不匹配`);
    }

    // license 完备（bundled+ error；dev-only warning）
    if (manifest.license.sourceUrl === null && !/原创|repo:/.test(manifest.license.notes ?? '')) {
      gate(1, 'license-incomplete', '无 sourceUrl 且 notes 未声明来源');
    }

    if (manifest.id === 'codenono' && manifest.renderer === 'spritesheet') {
      // 网格常量为 CodeNoNo 专用；第二个 spritesheet 角色需按 §8.4 扩展专属检查
      // 网格整除 + 行越界（硬检查）：帧表常量与磁盘图实际尺寸双向核对
      const sheetRel = 'assets/codenono/spritesheet.webp';
      const sheetAbs = join(ASSET_ROOT, sheetRel);
      if (existsSync(sheetAbs)) {
        const size = imageSize(sheetAbs);
        if (!size) {
          // 存在但无法解析尺寸：不能静默跳过网格核对（fail-closed）
          err('asset-unreadable', `${sheetRel} 存在但无法解析尺寸`);
        } else {
          if (
            size.width !== SPRITESHEET_SIZE.width ||
            size.height !== SPRITESHEET_SIZE.height ||
            size.width % FRAME_SIZE.width !== 0 ||
            size.height % FRAME_SIZE.height !== 0
          ) {
            err(
              'spritesheet-grid',
              `整图 ${size.width}×${size.height} 与帧 ${FRAME_SIZE.width}×${FRAME_SIZE.height} 网格不整除`,
            );
          }
          const rows = size.height / FRAME_SIZE.height;
          for (const spec of Object.values(CODENONO_MOTION_MAP)) {
            if (spec.row >= rows)
              err('spritesheet-grid', `动作行 ${spec.row} 越界（共 ${rows} 行）`);
          }
        }
      }
    }
    if (manifest.renderer === 'image-sequence') {
      // 帧表 ↔ manifest 双向绑定（硬检查）：帧表 URL 必须入清单；清单资产必须被帧表引用
      const manifestPaths = new Set(manifest.assets.files.map((f) => f.path));
      for (const spec of Object.values(CREAM_KITTEN_FRAME_MAP)) {
        for (const url of spec.frames) {
          const hit = [...manifestPaths].some((p) => url.endsWith(p.split('/').pop()!));
          if (!hit) err('frame-unbound', `帧表 URL 未入清单：${url}`);
        }
      }
      for (const p of manifest.assets.files) {
        const base = p.path.split('/').pop()!;
        const referenced = Object.values(CREAM_KITTEN_FRAME_MAP).some((spec) =>
          spec.frames.some((url) => url.endsWith(`/${base}`)),
        );
        if (!referenced) err('frame-unbound', `清单资产未被帧表引用：${p.path}`);
      }
      // 帧画布一致（仅 release error；当前 dev-only → warning）；
      // 单文件存在但无法解析尺寸 → 硬错误（不能混进 sizes 集合里静默降级）
      const sizes: string[] = [];
      for (const f of manifest.assets.files) {
        const abs = join(ASSET_ROOT, f.path);
        if (!existsSync(abs)) continue; // 缺失已由 asset-missing 上报，且避免 readFileSync 抛错
        const s = imageSize(abs);
        if (!s) {
          err('asset-unreadable', `${f.path} 存在但无法解析尺寸`);
          continue;
        }
        sizes.push(`${s.width}×${s.height}`);
      }
      if (sizes.length > 0 && new Set(sizes).size > 1) {
        gate(2, 'frame-canvas-consistency', `帧画布不一致：${[...new Set(sizes)].join(' / ')}`);
      }
    }
  }

  // 未引用资产（warning；动态枚举 assets/ 下角色目录，未来角色目录自动纳入扫描）
  const assetsDir = join(ASSET_ROOT, 'assets');
  if (existsSync(assetsDir)) {
    for (const entry of readdirSync(assetsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = `assets/${entry.name}`;
      for (const file of readdirSync(join(assetsDir, entry.name))) {
        const rel = `${dir}/${file}`;
        if (/\.(png|webp|jpg)$/i.test(file) && !referenced.has(rel)) {
          warnings.push({ id: 'unreferenced-asset', characterId: entry.name, message: rel });
        }
      }
    }
  }

  return { errors, warnings, checkedAssets };
}
