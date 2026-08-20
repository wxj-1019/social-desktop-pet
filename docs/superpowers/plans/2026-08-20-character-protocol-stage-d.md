# 桌宠形象统一规范协议 · 阶段 D 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地形象协议阶段 D（§14 自动验收与准入）——资源预检 CLI + 分层发布门禁、schema 级 fallback 环检测、奶盖包络动画极值校正、阶段 C 遗留小修（二层降级/未知 PetId 诊断/文案注释漂移）、缩放等价命中测试、每角色 E2E smoke、CI 接线。

**Architecture:** 预检核心是纯模块 `apps/desktop/src/pet/character-preflight.ts`（导入三份 manifest 与两份帧表做绑定校验 + 内置 PNG/WebP 尺寸解析 + sha256 复核 + 分层门禁 dev-only/bundled/release），配套 vitest 包装使 `pnpm test` 自动成为 CI 门禁；CLI 入口 `tools/character-preflight-cli.ts`（tsx 运行）供本地发布流程输出完整报告。其余任务各自独立、无耦合。

**Tech Stack:** TypeScript strict、zod（@pet/protocol）、node:crypto/fs、tsx、Vitest（node）、Playwright Electron、GitHub Actions（ci.yml 已有 quality job）。

**Approved spec:** `docs/superpowers/specs/2026-08-20-desktop-pet-character-protocol-design.md`（§10 资源许可安全 / §12 迁移等级 / §14 阶段 D）
**前置:** 阶段 A+B+C 已在 main（36f1517）：manifest schema/三角色数据/面板视觉入口/几何命中/专属降级；backlog 记录在两份 plan 文档"执行结果"节。

---

## 执行前置检查

- [ ] 从 main 切出 `feat/character-protocol-stage-d`，`git status` 干净。
- [ ] 基线：`pnpm test` 全绿（976/976）。

**验证命令**（Windows Git Bash，仓库根）：

```bash
npx vitest run <文件>
pnpm test
pnpm typecheck && pnpm --filter @pet/desktop typecheck
pnpm lint && pnpm format
pnpm preflight:characters        # Task 3 落地后可用
```

## File Structure

- Modify `packages/protocol/src/desktop/index.ts` + `character-manifest.test.ts` —— schema 级 fallback 环检测（Task 1）
- Modify `apps/desktop/src/pet/character-manifests.ts` + 新增绑定断言进 `character-manifests.test.ts` —— 奶盖包络极值 + 帧表↔manifest 绑定（Task 2）
- Create `apps/desktop/src/pet/character-preflight.ts` + `character-preflight.test.ts`、`tools/character-preflight-cli.ts`；Modify 根 `package.json` scripts；删除 `apps/desktop/src/assets/cream-kitten/idle_gs.jpg`（Task 3）
- Modify `apps/desktop/src/pet/pet-experience.tsx`（二层 boundary）、`character-registry.ts` + `character-manifests.ts`（未知 id 诊断 warn）、`apps/desktop/src/app/friends.tsx`（petName 文案）、`electron/main/security.ts` + `preload/index.ts`（注释漂移）（Task 4）
- Modify `apps/desktop/src/pet/pet-experience.test.tsx` —— 缩放等价命中测试（Task 5）
- Create `e2e/character-skins.spec.ts` —— 每角色 smoke（Task 6）
- Modify `.github/workflows/ci.yml`、spec 状态行、AGENTS.md、本 plan 执行结果（Task 7）

## 分层门禁设计（Task 3 核心语义，勿偏移）

| 检查                                                                                                            | dev-only  | bundled   | release   |
| --------------------------------------------------------------------------------------------------------------- | --------- | --------- | --------- |
| manifest schema parse / 文件存在 / sha256 匹配 / PetId 一致 / 帧表↔manifest 资产双向绑定 / spritesheet 网格整除 | **error** | **error** | **error** |
| license 完备（sourceUrl 或 notes 说明来源；commercialUse/attributionRequired 已声明）                           | warning   | **error** | **error** |
| image-sequence 帧画布尺寸一致 / assets.preview 存在                                                             | warning   | warning   | **error** |

当前数据预期：全部硬检查通过；奶盖帧画布不一致 → dev-only 下为 warning（CLI 退出码 0，报告记录）；星屿无帧无 preview → preview 检查 bundled 下为 warning（星屿是 bundled；该检查仅 release 为 error ✓）。**预检对当前数据必须全绿（0 error）**——这是 Task 3 的验收线。

---

### Task 1: schema 级 fallback 环检测（backlog A+B#4）

**Files:**

- Modify: `packages/protocol/src/desktop/index.ts`（CharacterManifestSchema superRefine 内追加）
- Test: `packages/protocol/src/desktop/character-manifest.test.ts`

- [ ] **Step 1: 失败测试** —— character-manifest.test.ts 的 `CharacterManifestSchema` describe 追加：

```ts
it('fallback 链成环被 schema 拒绝（§7.2 纵深防御）', () => {
  const selfLoop = buildValidManifest();
  selfLoop.capabilities.coreMotions.sit = 'fallback:sit';
  expect(CharacterManifestSchema.safeParse(selfLoop).success).toBe(false);

  const mutual = buildValidManifest();
  mutual.capabilities.expressions.warm = 'fallback:shy';
  mutual.capabilities.expressions.shy = 'fallback:warm';
  expect(CharacterManifestSchema.safeParse(mutual).success).toBe(false);
});
```

- [ ] **Step 2:** `npx vitest run packages/protocol/src/desktop/character-manifest.test.ts` → 新用例 FAIL（现 schema 不查环）。

- [ ] **Step 3: 实现** —— superRefine 末尾（extensions 检查之后）追加：

```ts
// §7.2 fallback 链必须终止于 native/unsupported（无环；桌面测试兜底之外的纵深防御）
const checkChain = (table: Record<string, string>, kind: 'coreMotions' | 'expressions'): void => {
  for (const start of Object.keys(table)) {
    const seen = new Set<string>([start]);
    let current = table[start]!;
    while (current.startsWith('fallback:')) {
      const target = current.slice('fallback:'.length);
      if (seen.has(target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['capabilities', kind, start],
          message: `fallback cycle detected at ${kind}.${start} -> ${target}`,
        });
        break;
      }
      seen.add(target);
      current = table[target]!;
    }
  }
};
checkChain(m.capabilities.coreMotions as Record<string, string>, 'coreMotions');
checkChain(m.capabilities.expressions as Record<string, string>, 'expressions');
```

- [ ] **Step 4:** 跑该文件 → 全过（既有 13 + 新 1）。跑 `npx vitest run packages/protocol apps/desktop/src/pet/character-manifests.test.ts` 确认三角色数据无环不受伤。

- [ ] **Step 5: 提交** `git commit -m "feat(protocol): manifest fallback 链环检测（形象协议阶段 D）"`（含两文件）。

---

### Task 2: 奶盖包络动画极值 + 帧表↔manifest 绑定（backlog A+B#5/#6）

**Files:**

- Modify: `apps/desktop/src/pet/character-manifests.ts`（cream-kitten visualBounds + 注释）
- Test: `apps/desktop/src/pet/character-manifests.test.ts`（追加绑定用例）

- [ ] **Step 1: 读实值重算包络** —— 读 `styles.css` 的 `@keyframes ck-bounce`（translateY −6px + scale(0.96,1.04)，origin 底部中线）与 `@keyframes ck-tilt-left/right`（旋转角度 θ，origin 底部）。按 240×260 逻辑画布计算 img 盒（max-height 80% ≈ 199.7、底缘 ≈235）：
  - 顶缘极值 ≈ img 顶(≈35) − 6(bounce 上移) − 199.7×0.04(纵向 scale) ≈ 21 → 取 14 留余量
  - 底缘极值 ≈ 235 + 半宽108×sin θ（tilt 角点下探；θ=8° 时 ≈15）→ 250
  - 落盘值：`visualBounds: { x: 12, y: 14, width: 216, height: 236 }`（底缘 250 ≤ 260 过 schema；若实测 θ 不同按实测修正 height，注释必须写明推导）
  - 注释模板：`// ck-bounce：−6px + scaleY 1.04（origin 底部）→ 顶缘 14；ck-tilt ±N° 角点下探 半宽×sin N°≈Xpx → 底缘 250（styles.css @keyframes ck-*）`

- [ ] **Step 2: 绑定失败测试**（先写先红——绑定检查当前应已满足，故无红可看，锁定型；直接进 Step 3）追加到 character-manifests.test.ts：

```ts
it('奶盖帧表与 manifest 资产清单双向绑定（§10.2 完整性）', () => {
  const m = CHARACTER_MANIFESTS['cream-kitten']!;
  const manifestPaths = new Set(m.assets.files.map((f) => f.path));
  // CREAM_KITTEN_FRAME_MAP 的每个 URL 都对应清单里的一个文件（Vite URL → 相对路径）
  for (const spec of Object.values(CREAM_KITTEN_FRAME_MAP)) {
    for (const url of spec.frames) {
      const rel = url.replace(/^.*\/assets\//, 'assets/');
      expect(manifestPaths.has(rel), `帧表 URL 未入清单：${rel}`).toBe(true);
    }
  }
  expect(manifestPaths.size).toBe(12);
});
```

（import `CREAM_KITTEN_FRAME_MAP` from './image-frame-manifest.js'；Vite dev URL 形如 `/src/assets/...` 或打包 hash URL——以实际断言跑通为准，若 replace 规则不匹配真实 URL 形态，改为按文件名后缀匹配 `path.endsWith(basename)`，报告中说明采用哪种。）

- [ ] **Step 3: 实现** —— 修改 manifest 数据（Step 1 数值 + 注释）；跑 `npx vitest run apps/desktop/src/pet/character-manifests.test.ts apps/desktop/src/pet/character-registry.test.ts` 全绿（既有 8 + 新 1；schema in-canvas 校验通过）。

- [ ] **Step 4: 提交** `git commit -m "fix(desktop): 奶盖视觉包络补动画极值；帧表↔manifest 绑定锁定（形象协议阶段 D）"`。

---

### Task 3: 资源预检核心 + CLI（阶段 D 核心交付）

**Files:**

- Create: `apps/desktop/src/pet/character-preflight.ts`、`apps/desktop/src/pet/character-preflight.test.ts`
- Create: `tools/character-preflight-cli.ts`
- Modify: 根 `package.json`（scripts 加 `"preflight:characters": "tsx tools/character-preflight-cli.ts"`）
- Delete: `apps/desktop/src/assets/cream-kitten/idle_gs.jpg`（grep 确认无引用后删除）

- [ ] **Step 1: 失败测试** —— `character-preflight.test.ts`：

```ts
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
});
```

- [ ] **Step 2:** 跑 → FAIL（模块不存在）。

- [ ] **Step 3: 实现** `character-preflight.ts`（完整骨架，实现者补齐时不得改变分层语义）：

```ts
/**
 * 角色资源预检 —— 形象协议阶段 D（§10/§12/§14）。
 *
 * 纯模块（node 环境）：导入三份 manifest 与两份帧表，复核磁盘资产。
 * 分层门禁：硬检查（存在/哈希/绑定/网格）任何层级都是 error；
 * license 完备 bundled+ 为 error；帧画布一致/preview 仅 release 为 error。
 * CI 经 vitest 包装（pnpm test）自动门禁；CLI 入口见 tools/character-preflight-cli.ts。
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CREAM_KITTEN_FRAME_MAP } from './image-frame-manifest.js';
import { CHARACTER_MANIFESTS } from './character-manifests.js';
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

/** assets.path 相对 apps/desktop/src（与 character-manifests.test.ts 的解析约定一致） */
const ASSET_ROOT = join(__dirname, '..');

/** PNG IHDR 尺寸（大端 u32 ×2 @ offset 16） */
function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** WebP 尺寸（VP8X canvas 24bit；VP8L 14bit；VP8 帧 16bit）——覆盖本仓库三种形态 */
function webpSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (buf.toString('ascii', 12, 15) === 'VP8') {
    // lossy: 帧头 3B + 3B sync 0x9d012a + 14bit w/h（减一）
    const w = buf.readUInt16LE(26) & 0x3fff;
    const h = buf.readUInt16LE(28) & 0x3fff;
    return { width: w + 1, height: h + 1 };
  }
  if (buf.toString('ascii', 12, 16) === 'VP8L') {
    // lossless: signature 0x2f 后 14bit w-1/h-1（跨字节位打包）
    const b0 = buf[21]!;
    const b1 = buf[22]!;
    const b2 = buf[23]!;
    const b3 = buf[24]!;
    const w = (b0 | ((b1 & 0x3f) << 8)) + 1;
    const h = (((b1 >> 6) | (b2 << 2) | (b3 << 10)) & 0x3fff) + 1;
    return { width: w, height: h };
  }
  if (buf.toString('ascii', 12, 16) === 'VP8X') {
    // extended: 24bit canvas w-1/h-1 @ offset 24/27（小端字节序）
    const w = buf[24]! | (buf[25]! << 8) | (buf[26]! << 16);
    const h = buf[27]! | (buf[28]! << 8) | (buf[29]! << 16);
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

    // 硬检查：license 完备（bundled+ error，dev-only warning）
    if (manifest.license.sourceUrl === null && !/原创|repo:/.test(manifest.license.notes ?? '')) {
      gate(1, 'license-incomplete', '无 sourceUrl 且 notes 未声明来源');
    }

    // renderer 专项
    if (manifest.renderer === 'spritesheet') {
      // 网格整除（硬检查）：CodeNoNo 帧表常量与磁盘图实际尺寸双向核对
      const sheetAbs = join(ASSET_ROOT, 'assets/codenono/spritesheet.webp');
      const size = existsSync(sheetAbs) ? imageSize(sheetAbs) : null;
      if (size) {
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
          if (spec.row >= rows) err('spritesheet-grid', `动作行 ${spec.row} 越界（共 ${rows} 行）`);
        }
      }
    }
    if (manifest.renderer === 'image-sequence') {
      // 帧表 ↔ manifest 双向绑定（硬检查）
      const manifestPaths = new Set(manifest.assets.files.map((f) => f.path));
      for (const spec of Object.values(CREAM_KITTEN_FRAME_MAP)) {
        for (const url of spec.frames) {
          const hit = [...manifestPaths].some((p) => url.endsWith(p.split('/').pop()!));
          if (!hit) err('frame-unbound', `帧表 URL 未入清单：${url}`);
        }
      }
      // 帧画布一致（仅 release error；当前 dev-only → warning）
      const sizes = manifest.assets.files.map((f) => {
        const s = imageSize(join(ASSET_ROOT, f.path));
        return s ? `${s.width}×${s.height}` : 'unreadable';
      });
      if (new Set(sizes).size > 1) {
        gate(2, 'frame-canvas-consistency', `帧画布不一致：${[...new Set(sizes)].join(' / ')}`);
      }
    }

    // preview（仅 release error）
    if (!manifest.assets.preview) {
      gate(2, 'preview-missing', 'release 级需要 assets.preview');
    }
  }

  // 未引用资产（warning；仅扫描角色资产目录的直接文件）
  for (const dir of ['assets/codenono', 'assets/cream-kitten']) {
    const absDir = join(ASSET_ROOT, dir);
    if (!existsSync(absDir)) continue;
    for (const name of readdirSync(absDir)) {
      const rel = `${dir}/${name}`;
      if (/\.(png|webp|jpg)$/i.test(name) && !referenced.has(rel) && name !== 'NOTICE.md') {
        warnings.push({ id: 'unreferenced-asset', characterId: dir.split('/')[1]!, message: rel });
      }
    }
  }

  return { errors, warnings, checkedAssets };
}
```

注意：`CODENONO_MOTION_MAP` 从 spritesheet-manifest.js 导入（已导出）；`__dirname` 在 vitest node 环境可用（同 manifests 测试先例）。实现后**必须跑通真实数据**：codenono webp 是 1536×1872、三种 header 形态按实际文件验证（若解析错位，打印 buf 前 40 字节十六进制对照 WebP 规范调 offset——报告中写明实际命中哪种形态）。

- [ ] **Step 4: CLI** —— `tools/character-preflight-cli.ts`：

```ts
/**
 * 角色资源预检 CLI（形象协议阶段 D）——本地发布流程用。
 * 输出分级报告（error/warning/统计），有 error 时退出码 1。
 * CI 门禁走 vitest 包装（apps/desktop/src/pet/character-preflight.test.ts）。
 */
import { runCharacterPreflight } from '../apps/desktop/src/pet/character-preflight.js';

const result = runCharacterPreflight();
for (const e of result.errors) console.error(`[ERROR] ${e.characterId} ${e.id}: ${e.message}`);
for (const w of result.warnings) console.warn(`[WARN ] ${w.characterId} ${w.id}: ${w.message}`);
console.log(
  `已复核资产 ${result.checkedAssets} 个；error ${result.errors.length}，warning ${result.warnings.length}`,
);
process.exit(result.errors.length > 0 ? 1 : 0);
```

根 `package.json` scripts 追加：`"preflight:characters": "tsx tools/character-preflight-cli.ts"`（放 test:e2e 之后）。tsx 可用性：workspace 内 `pnpm exec tsx`（server devDeps 已有 tsx；CI quality job 全量 install 后同样可用）。

- [ ] **Step 5: 删除 idle_gs.jpg** —— `rg -n "idle_gs" apps/desktop e2e packages` 确认零引用后 `git rm apps/desktop/src/assets/cream-kitten/idle_gs.jpg`。

- [ ] **Step 6: 验证** —— `npx vitest run apps/desktop/src/pet/character-preflight.test.ts` 全过；`pnpm preflight:characters` 输出 0 error（奶盖帧不一致等以 warning 呈现）；`pnpm --filter @pet/desktop typecheck`、lint、format 干净。

- [ ] **Step 7: 提交** `git commit -m "feat(desktop): 角色资源预检核心+CLI 与分层门禁（形象协议阶段 D）"`（四文件 + 删除）。

---

### Task 4: 阶段 C 遗留小修合集（backlog C#1/#2/#4）

**Files:**

- Modify: `apps/desktop/src/pet/pet-experience.tsx`（二层 boundary）
- Modify: `apps/desktop/src/pet/character-registry.ts`、`character-manifests.ts`（未知 id 诊断）
- Modify: `apps/desktop/src/app/friends.tsx`（三处文案）
- Modify: `apps/desktop/electron/main/security.ts:86`、`electron/preload/index.ts:131`（注释）

- [ ] **Step 1: 失败测试** —— pet-experience.test.tsx 追加：

```tsx
it('降级组件自身崩溃时落到通用 PetFallback（二层 boundary，§11.8）', () => {
  function ThrowingVisual(): never {
    throw new Error('visual boom');
  }
  function ThrowingFallback(): never {
    throw new Error('fallback boom');
  }
  render(<PetExperience VisualComponent={ThrowingVisual} FallbackComponent={ThrowingFallback} />);
  expect(document.querySelector('[data-testid="star-isle-fallback"]')).not.toBeNull();
});
```

- [ ] **Step 2:** 跑 → FAIL（当前 fallback 崩溃会冒泡）。

- [ ] **Step 3: 实现**
      (a) pet-experience.tsx：`PetVisualBoundary` 的 fallback 渲染处包第二层 —— 即 JSX 中 `<PetVisualBoundary fallback={<FallbackComponent />}>` 改为嵌套：

```tsx
<PetVisualBoundary
  fallback={
    <PetVisualBoundary fallback={<PetFallback />}>
      <FallbackComponent />
    </PetVisualBoundary>
  }
>
  <VisualComponent state={visualState} />
</PetVisualBoundary>
```

（import `PetFallback` from './pet-fallback.js'；`PetVisualBoundary` 是本文件内类组件，可直接复用。）
(b) character-registry.ts `getCharacterConfig` 与 character-manifests.ts `getCharacterManifest`：未知 id 回退前加 `console.warn('[character] unknown petId "%s", fallback to star-isle', id)`（两处；spec §11 末段）。
(c) friends.tsx：64/255/315 三处"星屿"→ 组件内 `const { config } = useCurrentCharacter();` 插值（import 已有 CharacterVisual 路径，补 useCurrentCharacter；64 行若是模板串在组件外，移入组件内构造）。
(d) security.ts:86 注释 `// main→pet 推送` → `// main→pet/panel 推送`；preload/index.ts:131 同步（找到 pet:profile-changed 相关注释行）。

- [ ] **Step 4:** `npx vitest run apps/desktop/src/pet apps/desktop/src/app` 全绿；typecheck/lint/format 干净。

- [ ] **Step 5: 提交** `git commit -m "fix(desktop): 二层降级兜底/未知角色诊断/文案与注释对齐（形象协议阶段 D）"`。

---

### Task 5: 缩放等价命中组件测试（§14.3）

**Files:**

- Modify: `apps/desktop/src/pet/pet-experience.test.tsx`

- [ ] **Step 1: 追加用例**（先写先跑，红不了属预期——锁定型；但先跑一遍确认三档确实全过，有红说明换算有比例 bug）：

```tsx
it('命中区在 0.5×/1×/2× 缩放下等价解析（同一逻辑点 → 同一交互，§6.4）', () => {
  const cases = [
    { scale: 0.5, rect: { x: 0, y: 0, width: 120, height: 130 } },
    { scale: 1, rect: { x: 0, y: 0, width: 240, height: 260 } },
    { scale: 2, rect: { x: 0, y: 0, width: 480, height: 520 } },
  ];
  for (const { rect } of cases) {
    cleanup();
    installFakePet();
    render(<PetExperience />);
    const canvas = document.querySelector('.pet-canvas') as HTMLElement;
    canvas.getBoundingClientRect = () =>
      ({
        ...rect,
        top: rect.y,
        left: rect.x,
        right: rect.x + rect.width,
        bottom: rect.y + rect.height,
        toJSON: () => ({}),
      }) as DOMRect;
    // 逻辑点 (124, 214)（primary 中心附近）→ client = 逻辑 × scale
    const sx = rect.x + (124 * rect.width) / 240;
    const sy = rect.y + (214 * rect.height) / 260;
    firePointer(canvas, 'down', { screenX: sx, screenY: sy, clientX: sx, clientY: sy } as never);
    firePointer(canvas, 'up', { screenX: sx, screenY: sy, clientX: sx, clientY: sy } as never);
    expect(pet.petRuntime.interaction).toHaveBeenCalledWith({ kind: 'body_touch' });
    expect(pet.petRuntime.interaction).toHaveBeenCalledTimes(1);
  }
  cleanup();
});
```

（`firePointer` 的 init 若无 clientX 字段则扩展其签名：`init: { screenX: number; screenY: number; button?: number; clientX?: number; clientY?: number }`，PointerEvent init 里 `clientX: init.clientX ?? init.screenX`。`cleanup/installFakePet` 从 testing-library/vitest 已有导入补齐。）

- [ ] **Step 2:** 跑 → 三档全过（若有档失败即换算 bug，修实现不修测试）。`pnpm --filter @pet/desktop typecheck`。

- [ ] **Step 3: 提交** `git commit -m "test(desktop): 命中区缩放等价组件测试（形象协议阶段 D）"`。

---

### Task 6: 每角色 E2E smoke（§14.4）

**Files:**

- Create: `e2e/character-skins.spec.ts`

- [ ] **Step 1: 编写** —— 参照 star-isle.spec.ts 的既有换肤模式（panel → 角色页 → radio 点击 → 等新窗）：

```ts
import { expect, test } from '@playwright/test';

import { ElectronApp } from './helpers/electron-app.js';

test.describe('角色皮肤 smoke（形象协议阶段 D）', () => {
  test('CodeNoNo：切换 → 视觉可见 → 几何命中互动 → 恢复星屿', async () => {
    const app = new ElectronApp();
    await app.launch();
    const panel = await app.openPanel('character');
    await expect(panel.locator('.character-select')).toBeVisible({ timeout: 15_000 });

    await panel.getByRole('radio', { name: /CodeNoNo/ }).click();
    const pet = await app.petWindow();
    await expect(pet.locator('.spritesheet-pet')).toBeVisible({ timeout: 15_000 });

    // 几何命中：primary(34,73,173,187) 中心 (120,166)（窗内容区即 240×260 逻辑画布 @scale1）
    await pet.mouse.click(120, 166);
    await expect(pet.locator('.spritesheet-pet')).toHaveAttribute('data-motion', 'touch', {
      timeout: 5_000,
    });

    await panel.getByRole('radio', { name: /星屿/ }).click();
    const restored = await app.petWindow();
    await expect(restored.getByRole('img', { name: '星尾狐猫星屿' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('奶盖：切换 → 视觉可见 → 恢复星屿', async () => {
    const app = new ElectronApp();
    await app.launch();
    const panel = await app.openPanel('character');
    await expect(panel.locator('.character-select')).toBeVisible({ timeout: 15_000 });

    await panel.getByRole('radio', { name: /奶盖/ }).click();
    const pet = await app.petWindow();
    await expect(pet.locator('.image-pet')).toBeVisible({ timeout: 15_000 });

    await panel.getByRole('radio', { name: /星屿/ }).click();
    const restored = await app.petWindow();
    await expect(restored.getByRole('img', { name: '星尾狐猫星屿' })).toBeVisible({
      timeout: 15_000,
    });
  });
});
```

**注意**：先读 `e2e/helpers/electron-app.ts` 与 star-isle.spec.ts 的既有换肤用例，对齐真实的 app 启动/面板打开/角色 radio 定位写法（上面是形态参考；以 helper 真实 API 为准调整，如 `app.launch()` 是否存在、radio 的 accessible name 是否含角色名——用既有用例里已验证的选择器）。data-motion='touch' 断言：codenono touch→row3，组件 data-motion 属性直接反映 motion ✓。若点击未触发（比如窗口 scale≠1），用 `app.windowState('pet')` 读 bounds 校准坐标并注释推导。

- [ ] **Step 2:** 跑 `pnpm --filter @pet/desktop build && npx playwright test --config e2e/playwright.config.ts character-skins.spec.ts` → 2/2 过。若 codenono 点击后 motion 未到 touch（审批冷却/坐标偏差），先查 windowState bounds 与快照，修正坐标而非放松断言。

- [ ] **Step 3: 提交** `git commit -m "test(e2e): 每角色几何命中 smoke（形象协议阶段 D）"`。

---

### Task 7: CI 接线 + 全量验证 + 文档收尾

- [ ] **Step 1: ci.yml** quality job（`- run: pnpm test` 之前）加一行：

```yaml
- run: pnpm preflight:characters
```

（tsx 在 CI 可用性：server devDeps 含 tsx，quality job 全量 install；若 pnpm exec 解析失败，改为 `pnpm --filter @pet/server exec tsx ../../tools/character-preflight-cli.ts` 并报告。）

- [ ] **Step 2: 全量验证** —— `pnpm test`（预期 976 + 新增 ≈ 12）；`pnpm typecheck && pnpm --filter @pet/desktop typecheck && pnpm lint && pnpm format`；`pnpm --filter @pet/desktop build && npx playwright test --config e2e/playwright.config.ts star-isle.spec.ts character-skins.spec.ts` → 与基线一致或更好（基线 11 过/1 失败）。

- [ ] **Step 3: 文档** —— spec 状态行改 `已批准；阶段 A+B+C+D 已落地（含资源预检与 CI 门禁），协议进入维护态`；AGENTS.md 落点表"新增/适配桌宠形象"行的落点加 `character-preflight.ts`（预检）；本 plan 追加"执行结果"节（提交清单 + 遗留项：奶盖帧画布统一化与独立眨眼帧属资源再制工作、tail_touch 语义收敛待产品决策、面板星屿闪烁打磨）。

- [ ] **Step 4: 提交** `git commit -m "chore(ci): 角色预检进 CI；形象协议阶段 D 收尾文档"`。

---

## Self-Review 记录

- **Spec 覆盖**：§14.1 预检 CLI → Task 3；§14.2 覆盖矩阵 → A+B 已落（schema 显式键 + followChain 测试），Task 1 补 schema 级环检测纵深；§14.3 缩放/命中组件测试 → Task 5（DPI/截图全档自动化超出本轮，窗口缩放等价已锁；菜单/气泡/reduced-motion 组件测试在菜单与视觉既有套件中覆盖）；§14.4 每角色 E2E + 角色选择回归 → Task 6（选择页回归由既有角色页用例 + 本 spec 双角色切换覆盖）；§14.5 CI 阻止 → Task 3 vitest 包装 + Task 7 CI 行。backlog：A+B#4→T1、#5→T2、#6→T2、#7（眨眼帧资源再制，非代码，记录）；C#1→T4、#2→T4、#4→T4、#5（打磨，记录）；C#3（语义收敛，产品决策，记录）。
- **占位符扫描**：Task 3/5/6 代码完整可粘贴；Task 6 明示"以 helper 真实 API 为准对齐"并给出对齐来源；Task 2 的包络数值给了基准值与实测修正规则。
- **类型一致性**：`runCharacterPreflight(): PreflightResult`、`PreflightFinding{id,characterId,message}` 在核心/CLI/测试三处一致；TIER_ORDER 与 manifest.release 枚举一致。

## 执行结果（2026-08-20）

阶段 D 已在 `feat/character-protocol-stage-d` 完成：8 个提交（e9110d3…）。每任务经"实现→规范审查→质量审查→修复→复审"闭环。审查修复的实质问题：预检对不可解析资产 fail-open（含缺失文件 ENOENT 崩溃隐患）、codenono 检查硬编码（改为显式 id 键 + 动态目录枚举）、奶盖包络顶缘漏算 scaleY 同时位移极值。实现者抓到计划三处错误：WebP 分派三字符前缀误匹配 VP8L、e2e motion 断言与运行时映射不符（body_touch→cheer→happy）、三角形几何断言（阶段 C 已修）。

### 关键产出

- `character-preflight.ts` + `pnpm preflight:characters`：分层门禁（硬检查全层级/license bundled+/帧一致与 preview 仅 release），当前数据 0 error / 5 warning（奶盖帧画布 8 种尺寸不一致为最大债务）；CI quality job 已接线
- schema 级 fallback 环检测；奶盖包络动画极值校正（{12,11,216,239}）
- 二层降级 boundary；未知 PetId console.warn 诊断；friends 文案/注释对齐
- `e2e/character-skins.spec.ts`：两角色几何命中 smoke（含实测 bounds 缩放）

### 遗留（阶段 D 之后的 backlog）

1. **产品修复**：面板启动竞态——`panel:navigate` 在 renderer 订阅前投递 + `session.init()` 完成后 signed_out 覆盖本地模式（star-isle.spec 两个用例受害；修法参考 deeplink:consume-pending 拉取模式）；修复后移除 character-skins.spec 的规避与 TODO
2. **资源再制**：奶盖帧画布统一化（8 种尺寸→统一透明画布+脚底锚定，`align_frames` 工具化）与独立眨眼帧（blink≡idle）；完成后预检 warning 清零、可评估 bundled
3. **CodeNoNo 许可**：上游书面确认后 dev-only→bundled
4. **打磨**：预检三处扩展名列表统一常量；面板非星屿角色打开瞬间星屿闪烁；tail_touch 语义收敛（产品决策）
