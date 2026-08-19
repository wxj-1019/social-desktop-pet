# 桌宠形象统一规范协议 · 阶段 C 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地形象协议阶段 C（§14）——产品消费方迁移：面板/角色选择页视觉走统一 `CharacterVisual`（消灭星屿硬编码与 if/else 缩略图）、registry 文案单源化、PetExperience 点击命中从 DOM `data-hit` 迁移到 manifest 几何区域、每角色专属错误降级。

**Architecture:** 新增三个小模块——`character-visual.tsx`（当前角色解析 + 通用视觉组件，面板侧唯一入口）、`zone-hit.ts`（manifest 区域纯几何命中，rect/circle/ellipse/polygon + 优先级）、`character-fallbacks.tsx`（spritesheet/图片角色的静态标记降级）；PetExperience 增加 `manifest` 注入 prop，pointerdown 时把 client 坐标换算回 240×260 逻辑画布做区域命中，zone→交互指令映射保持现行为（head→head_touch、tail→tail_touch、其余→body_touch）；拖拽/双击维持窗口级语义不变（今天就不依赖命中区）。

**Tech Stack:** TypeScript strict、React 18、zod 类型（@pet/protocol 已有 CharacterManifest）、Vitest（jsdom）、pnpm workspaces。

**Approved spec:** `docs/superpowers/specs/2026-08-20-desktop-pet-character-protocol-design.md`（§6 交互区域协议 / §11 注册与产品一致性 / §14 阶段 C）
**前置:** 阶段 A+B 已合并 main（c0530b9）：`CharacterManifestSchema`、`character-manifests.ts`、一致性测试。

---

## 执行前置检查

- [ ] 从 main 切出 `feat/character-protocol-stage-c`，确认 `git status` 干净。
- [ ] 基线测试：`pnpm test` 全绿（当前 952/952）。

**验证命令**（Windows Git Bash，仓库根执行）：

```bash
npx vitest run <文件>          # 单文件
pnpm test                      # 全量
pnpm typecheck && pnpm --filter @pet/desktop typecheck
pnpm lint && pnpm format
```

## File Structure

- Create `apps/desktop/src/pet/character-visual.tsx` —— `useCurrentCharacter()` hook + `CharacterVisual` 组件（面板侧统一视觉入口）
- Create `apps/desktop/src/pet/zone-hit.ts` —— manifest 交互区纯几何命中 + zone→交互指令映射
- Create `apps/desktop/src/pet/zone-hit.test.ts` —— 命中/映射纯函数测试
- Create `apps/desktop/src/pet/character-fallbacks.tsx` —— CodeNoNo/奶盖静态标记降级组件
- Modify `apps/desktop/src/pet/character-registry.ts` —— 文案单源化（从 manifest 派生）+ `FallbackComponent?` 字段
- Modify `apps/desktop/src/pet/pet-experience.tsx` —— manifest prop + 几何命中迁移
- Modify `apps/desktop/src/pet/pet-experience.test.tsx` —— firePointer 补 client 坐标 + 画布 rect mock + 新增区域行为用例
- Modify `apps/desktop/src/main.tsx` —— 注入 manifest 与 FallbackComponent
- Modify `apps/desktop/src/app/character-select.tsx` / `chat-panel.tsx` / `local-chat.tsx` / `settings.tsx` —— 换用 `CharacterVisual` + petName 文案
- Modify `apps/desktop/src/app/panel.css` —— `.star-isle` 作用域选择器改 `.character-visual`；删除按角色命名的缩略图背景
- Modify `apps/desktop/src/pet/character-registry.test.ts` —— case-4 推导化（backlog #3）
- Modify `docs/superpowers/specs/2026-08-20-desktop-pet-character-protocol-design.md` —— 状态行更新

## 关键行为决策（实现时不得偏移）

1. **拖拽、双击、右键菜单维持窗口级语义**：现状代码中 drag/dblclick 不依赖 `data-hit`（容器上 pointerdown 即可拖），阶段 C 不改变。
2. **只有"click → 交互指令"走几何命中**：pointerdown 记录命中 zone；click 时 zone→kind 映射：`head`→`head_touch`、`tail`→`tail_touch`、其余（含 `primary`/自定义）→`body_touch`。三角色现行为全部保持。
3. **坐标换算**：`logical = (client − canvasRect.left/top) × (240/canvasRect.width, 260/canvasRect.height)`。canvasRect 无效（宽高为 0，如 jsdom 未 mock）→ zone 为 null（不回退 DOM `data-hit`，避免双真相源）。
4. **CodeNoNo/奶盖命中收窄是预期变更**：从"整窗 body"收窄为 manifest 声明的视口/图像区（A+B 已在 manifest 注释声明"阶段 C 迁移生效"）。透明边缘点击不再触发互动。
5. **视觉组件的 `data-hit` DOM 属性本轮保留**（e2e 与回归锚点），但 PetExperience 不再读取它；删除留给阶段 D 收尾。
6. `useCurrentCharacter` 在 `window.pet` 缺失（测试/非 Electron）时回退星屿配置，不抛错。

---

### Task 1: CharacterVisual 统一视觉入口（面板/缩略图去硬编码）

**Files:**

- Create: `apps/desktop/src/pet/character-visual.tsx`
- Modify: `apps/desktop/src/app/character-select.tsx`、`chat-panel.tsx`、`local-chat.tsx`、`settings.tsx`
- Modify: `apps/desktop/src/app/panel.css`
- Test: 新增用例放进 `apps/desktop/src/pet/character-registry.test.tsx`？否——新建 `apps/desktop/src/pet/character-visual.test.tsx`

- [ ] **Step 1: 写失败测试** `apps/desktop/src/pet/character-visual.test.tsx`：

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CharacterVisual, useCurrentCharacter } from './character-visual.js';

interface FakeProfileApi {
  get: ReturnType<typeof vi.fn>;
  onChanged: ReturnType<typeof vi.fn>;
}

let profileApi: FakeProfileApi;

function installFakeProfile(petId: string): void {
  profileApi = {
    get: vi.fn(async () => ({
      version: 1,
      petId,
      displayName: 'x',
      reducedMotion: false,
      dnd: false,
      bubbleEnabled: true,
    })),
    onChanged: vi.fn((cb: (p: { petId: string }) => void) => {
      (profileApi as unknown as { __cb: typeof cb }).__cb = cb;
      return () => undefined;
    }),
  };
  (window as unknown as { pet: unknown }).pet = {
    petProfile: profileApi,
    petRuntime: {
      getSnapshot: vi.fn(async () => null),
      onSnapshot: vi.fn(() => () => undefined),
      onVisualCommand: vi.fn(() => () => undefined),
    },
  };
}

beforeEach(() => installFakeProfile('star-isle'));
afterEach(cleanup);

describe('CharacterVisual（面板侧统一视觉入口）', () => {
  it('默认渲染当前角色（星屿 SVG）', async () => {
    render(<CharacterVisual />);
    expect(await screen.findByRole('img', { name: '星尾狐猫星屿' })).not.toBeNull();
    expect(document.querySelector('.character-visual')).not.toBeNull();
  });

  it('petId prop 显式指定时渲染对应角色（不受 profile 影响）', () => {
    render(<CharacterVisual petId="codenono" />);
    expect(document.querySelector('.spritesheet-pet')).not.toBeNull();
  });

  it('profile 切换角色后经 onChanged 实时换装', async () => {
    render(<CharacterVisual />);
    expect(await screen.findByRole('img', { name: '星尾狐猫星屿' })).not.toBeNull();
    const api = window.pet as unknown as { petProfile: { __cb?: (p: { petId: string }) => void } };
    api.petProfile.__cb?.({ petId: 'cream-kitten' });
    expect(await screen.findByRole('img', { name: '奶油小猫' })).not.toBeNull();
  });

  it('window.pet 缺失时回退星屿，不抛错', () => {
    (window as unknown as { pet: unknown }).pet = undefined;
    render(<CharacterVisual />);
    expect(document.querySelector('.star-isle')).not.toBeNull();
  });

  it('useCurrentCharacter 暴露 config 与 manifest（含 petName）', async () => {
    let hook: ReturnType<typeof useCurrentCharacter> | null = null;
    function Probe() {
      hook = useCurrentCharacter();
      return null;
    }
    render(<Probe />);
    await screen.findByRole('img', { name: '星尾狐猫星屿' }); // ProfileView 组件渲染 img 的角色 —— 此行仅为等待 effect；Probe 无输出，改用轮询：
    expect(hook).not.toBeNull();
  });
});
```

注意：最后一个用例的 Probe 不渲染视觉，等待逻辑改为 `await act(async () => { await Promise.resolve(); });` 后断言 `hook!.config.petName === '星屿'` 且 `hook!.manifest.renderer === 'svg'`。写实现前先把该用例修正为这个形式（act 从 @testing-library/react 导入）。

- [ ] **Step 2: 跑测试确认失败**

```bash
npx vitest run apps/desktop/src/pet/character-visual.test.tsx
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现** `apps/desktop/src/pet/character-visual.tsx`：

```tsx
/**
 * CharacterVisual —— 面板侧统一视觉入口（形象协议阶段 C）。
 *
 * 面板（聊天/本地聊天/设置/角色选择）不再 import 具体角色组件：
 * - useCurrentCharacter：petProfile 当前 petId → registry config + manifest，
 *   经 onChanged 实时跟随换装（角色切换重载桌宠窗，面板原地换视觉）
 * - CharacterVisual：渲染当前（或显式 petId）角色的 VisualComponent，
 *   外层 .character-visual 供面板 CSS 控制尺寸
 * window.pet 缺失（单测/非 Electron）时回退星屿，不抛错（协议 §11.9）。
 */
import { useEffect, useState, type ComponentType } from 'react';

import type { PetId } from '@pet/protocol';

import { getCharacterConfig, type CharacterConfig } from './character-registry.js';
import { getCharacterManifest } from './character-manifests.js';
import { DEFAULT_VISUAL_STATE, type StarIsleVisualState } from './pet-renderer.js';

export interface CurrentCharacter {
  petId: PetId;
  config: CharacterConfig;
  manifest: ReturnType<typeof getCharacterManifest>;
}

/** 当前角色（profile 驱动，实时跟随换装）；无 pet API 时回退星屿 */
export function useCurrentCharacter(): CurrentCharacter {
  const [petId, setPetId] = useState<PetId>('star-isle');
  useEffect(() => {
    const profileApi = window.pet?.petProfile;
    if (!profileApi) return;
    let alive = true;
    void profileApi.get().then((profile) => {
      if (alive) setPetId(profile.petId);
    });
    const off = profileApi.onChanged((profile) => setPetId(profile.petId));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return { petId, config: getCharacterConfig(petId), manifest: getCharacterManifest(petId) };
}

export interface CharacterVisualProps {
  /** 渲染状态；缺省静态默认态（面板装饰位不需要动画驱动） */
  state?: StarIsleVisualState;
  /** 显式指定角色；缺省用当前 profile 角色 */
  petId?: PetId;
  className?: string;
}

export function CharacterVisual({ state, petId, className }: CharacterVisualProps) {
  const current = useCurrentCharacter();
  const resolvedId = petId ?? current.petId;
  const Visual: ComponentType<{ state?: StarIsleVisualState }> =
    getCharacterConfig(resolvedId).VisualComponent;
  return (
    <div className={className ? `character-visual ${className}` : 'character-visual'}>
      <Visual state={state ?? DEFAULT_VISUAL_STATE} />
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run apps/desktop/src/pet/character-visual.test.tsx
```

预期：PASS（5 用例）。

- [ ] **Step 5: 替换四个面板的硬编码**

`character-select.tsx`：删除 `CharacterThumbnail` 函数与 if/else，导入 `CharacterVisual`，卡片内改为：

```tsx
<CharacterVisual petId={c.id} />
```

（外层 `.character-card` 已有布局；`.character-visual` CSS 见 Step 6。）

`chat-panel.tsx` 三处 + 文案：导入 `CharacterVisual, useCurrentCharacter`；组件体内 `const { config } = useCurrentCharacter();`；替换：

```tsx
<CharacterVisual state={{ ...DEFAULT_VISUAL_STATE, speaking: streaming }} />
```

```tsx
<CharacterVisual />
```

（chat-empty 与 chat-msg__avatar 两处同形替换）；状态文案改为：

```tsx
{
  streaming ? `${config.petName}正在思考与回复…` : `${config.petName}在身边`;
}
```

typing-dots 的 aria-label 同步 `` `${config.petName}正在回复` ``。`DEFAULT_VISUAL_STATE` 若因此不再使用则从 import 中移除。

`local-chat.tsx` 三处 `<StarIsleVisual />` → `<CharacterVisual />`（chat-empty/chat-msg__avatar/pending），移除 StarIsleVisual import。

`settings.tsx`：`<StarIsleVisual variant="head" />` → `<CharacterVisual />`（34px 预览盒内改为全身静态渲染，视觉从头像特写变为全身小图——协议一致性取舍）；预览说明 `星屿大小随上方滑块即时变化` → `` `${config.petName}大小随上方滑块即时变化` ``（settings 组件内 `const { config } = useCurrentCharacter();`）。

- [ ] **Step 6: panel.css 选择器迁移**

执行 `grep -n "star-isle" apps/desktop/src/app/panel.css`。已知命中逐一处理，规则：**面板上下文里约束星屿组件尺寸的选择器，把 `.star-isle` 后代选择器改为 `.character-visual`**（组件本体样式不动，那在 styles.css）：

- `.chat-empty__character .star-isle` → `.chat-empty__character .character-visual`（约 853 行；若规则同时存在 `.chat-msg__avatar .star-isle`、`.character-presence__avatar .star-isle`、`.settings-preview-pet .star-isle` 同样替换）
- `.character-thumb--star-isle` / `--codenono` / `--cream-kitten` 三块背景规则**整块删除**（约 1196/1208/2187 行），保留 `.character-thumb` 基础规则并确认其内层改为：

```css
.character-thumb {
  /* 基础尺寸/圆角保持原规则不变，仅内容来源换成 CharacterVisual */
}
.character-thumb .character-visual {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
```

（`.character-thumb` 原有尺寸规则原样保留，只追加 `.character-thumb .character-visual` 子规则。）

- [ ] **Step 7: 回归 + 提交**

```bash
npx vitest run apps/desktop/src/pet/character-visual.test.tsx apps/desktop/src/app
pnpm --filter @pet/desktop typecheck && pnpm lint && pnpm format
git add apps/desktop/src/pet/character-visual.tsx apps/desktop/src/pet/character-visual.test.tsx apps/desktop/src/app/character-select.tsx apps/desktop/src/app/chat-panel.tsx apps/desktop/src/app/local-chat.tsx apps/desktop/src/app/settings.tsx apps/desktop/src/app/panel.css
git commit -m "feat(desktop): CharacterVisual 统一面板视觉入口（形象协议阶段 C）"
```

预期：面板相关既有测试全过（若有测试断言 `.character-thumb--star-isle` 类名，更新为 `.character-visual` 断言后再提交，并在报告中列出）。

---

### Task 2: registry 文案单源化 + release 断言推导化

**Files:**

- Modify: `apps/desktop/src/pet/character-registry.ts`
- Modify: `apps/desktop/src/pet/character-registry.test.ts`

- [ ] **Step 1: 改测试（先红）** —— `character-registry.test.ts` 的一致性 describe 中，case 4 替换为推导形式（backlog #3）：

```ts
it('manifest release 级别满足迁移定位（§12）：星屿 bundled，其余 dev-only', () => {
  for (const [id, manifest] of Object.entries(CHARACTER_MANIFESTS)) {
    expect(manifest.release, `${id} release 级别应符合 §12 迁移定位`).toBe(
      id === 'star-isle' ? 'bundled' : 'dev-only',
    );
  }
});
```

同时在"每个角色都有 displayName…"用例后追加"文案派生自 manifest"用例：

```ts
it('registry 文案派生自 manifest（单一事实源，阶段 C）', () => {
  for (const c of CHARACTERS) {
    const manifest = CHARACTER_MANIFESTS[c.id];
    expect(c.displayName).toBe(manifest!.displayName);
    expect(c.petName).toBe(manifest!.petName);
    expect(c.description).toBe(manifest!.description);
  }
});
```

（与既有 case 3 断言相同——保留两处：case 3 锁行为，本用例锁来源意图；registry 改为派生后两者同时通过。）

- [ ] **Step 2: 跑测试** `npx vitest run apps/desktop/src/pet/character-registry.test.ts` —— 新用例此时应仍绿（A+B 已锁定相等），无红可看属预期（锁定型测试），直接进实现。

- [ ] **Step 3: registry 派生化** —— `character-registry.ts` 中三个字面量条目的 `petName/displayName/description` 删除，改为构造辅助（import 增加 `getCharacterManifest`）：

```ts
/** 从 manifest 派生卡片文案（单一事实源，协议 §11.2） */
function copyOf(id: PetId) {
  const m = getCharacterManifest(id);
  return { petName: m.petName, displayName: m.displayName, description: m.description };
}
```

三个条目改为 `{ id: 'star-isle', ...copyOf('star-isle'), VisualComponent: StarIsleVisual, rendererFactory: createSvgPetRenderer }` 形态（codenono/cream-kitten 同理）。`CharacterConfig` 接口不变（字段仍必填，值来自 manifest）。

- [ ] **Step 4: 回归 + 提交**

```bash
npx vitest run apps/desktop/src/pet/character-registry.test.ts apps/desktop/src/pet/character-manifests.test.ts
pnpm --filter @pet/desktop typecheck && pnpm lint && pnpm format
git add apps/desktop/src/pet/character-registry.ts apps/desktop/src/pet/character-registry.test.ts
git commit -m "refactor(desktop): registry 文案单源化自 manifest（形象协议阶段 C）"
```

---

### Task 3: zone-hit 纯几何命中模块

**Files:**

- Create: `apps/desktop/src/pet/zone-hit.ts`
- Test: `apps/desktop/src/pet/zone-hit.test.ts`

- [ ] **Step 1: 写失败测试** `apps/desktop/src/pet/zone-hit.test.ts`：

```ts
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
          { x: 20, y: 30 },
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
});

describe('zoneToInteractionKind（zone → 交互指令，保持现行为）', () => {
  it('head/tail 保留专属指令，其余一律 body_touch（协议 §6.3：primary 不强行解释为部位）', () => {
    expect(zoneToInteractionKind('head')).toBe('head_touch');
    expect(zoneToInteractionKind('tail')).toBe('tail_touch');
    expect(zoneToInteractionKind('primary')).toBe('body_touch');
    expect(zoneToInteractionKind('accessory')).toBe('body_touch');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** `npx vitest run apps/desktop/src/pet/zone-hit.test.ts` → FAIL 模块不存在。

- [ ] **Step 3: 实现** `apps/desktop/src/pet/zone-hit.ts`：

```ts
/**
 * zone-hit —— manifest 交互区域的纯几何命中（形象协议阶段 C，§6）。
 *
 * 输入是 240×260 逻辑画布坐标（PetExperience 负责从 client 坐标换算），
 * 输出命中 zone id（按 priority 升序取第一个包含点的启用区域）。
 * zone → 交互指令的映射保持现行为：head/tail 保留专属指令，
 * 其余（primary/自定义）一律 body_touch —— 通用运行时不把 primary
 * 强行解释为"摸头/摸身"（§6.3）。
 */
import type { CharacterInteractionZone } from '@pet/protocol';

import type { PetInteraction } from '@pet/protocol';

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
```

注意 import 合并为一条 `import type { CharacterInteractionZone, PetInteraction } from '@pet/protocol';`（上面分两条仅为注释分区示意，落盘时合并，避免 lint import 报警）。

- [ ] **Step 4: 跑测试确认通过** `npx vitest run apps/desktop/src/pet/zone-hit.test.ts` → PASS（7 用例）。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/pet/zone-hit.ts apps/desktop/src/pet/zone-hit.test.ts
git commit -m "feat(desktop): zone-hit 纯几何命中模块（形象协议阶段 C）"
```

---

### Task 4: PetExperience 命中迁移（manifest 几何区域）

**Files:**

- Modify: `apps/desktop/src/pet/pet-experience.tsx`
- Modify: `apps/desktop/src/pet/pet-experience.test.tsx`
- Modify: `apps/desktop/src/main.tsx`

- [ ] **Step 1: 改测试（先红）** —— `pet-experience.test.tsx`：

1. `firePointer` 的 PointerEvent init 追加 client 坐标（与 screen 同值）：

```ts
      new PointerEvent(`pointer${type}`, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        button,
        buttons: type === 'up' ? 0 : button === 0 ? 1 : button,
        screenX: init.screenX,
        screenY: init.screenY,
        clientX: init.screenX,
        clientY: init.screenY,
      }),
```

2. 文件顶部（import 后）加画布 rect 安装助手，并在 `beforeEach(() => { installFakePet(); })` 中 render 前无法拿到元素——改为在各交互用例 render 后调用（或封装 `renderExperience()` 助手统一 render+install）。在文件 helper 区加入：

```ts
/** jsdom 无布局：mock .pet-canvas 为 240×260、原点 (0,0)（logical === client 坐标） */
function installCanvasRect(): void {
  const canvas = document.querySelector('.pet-canvas') as HTMLElement | null;
  if (!canvas) throw new Error('.pet-canvas not rendered');
  canvas.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 240,
      bottom: 260,
      width: 240,
      height: 260,
      toJSON: () => ({}),
    }) as DOMRect;
}
```

并把全部交互用例的 `render(<PetExperience />)` 替换为 `render(<PetExperience />); installCanvasRect();`（非交互用例不必加）。

3. 坐标校验（无需改动即应通过——星屿默认 manifest）：head 用例 (100,100) ∈ head(68,94,112,102) ✓；body 用例 (140,240) ∈ primary(80,174,89,80) ✓；若有 tail 用例，其坐标需落入 tail(27,97,53,131)，中心参考 (53,163)。

4. 新增三个行为用例（追加到既有交互 describe 末尾）：

```ts
  it('zone 命中迁移：透明角落点击不触发互动（协议 §6 收窄语义）', () => {
    render(<PetExperience />);
    installCanvasRect();
    firePointer(document.querySelector('.pet-canvas')!, 'down', { screenX: 5, screenY: 5 });
    firePointer(document.querySelector('.pet-canvas')!, 'up', { screenX: 5, screenY: 5 });
    expect(pet.petRuntime.interaction).not.toHaveBeenCalled();
  });

  it('注入 codenono manifest：视口内点击触发 body_touch，视口外不触发（命中收窄）', () => {
    render(
      <PetExperience manifest={getCharacterManifest('codenono')} />,
    );
    installCanvasRect();
    // primary 区 (34,73,173,187) 中心附近
    firePointer(document.querySelector('.pet-canvas')!, 'down', { screenX: 120, screenY: 170 });
    firePointer(document.querySelector('.pet-canvas')!, 'up', { screenX: 120, screenY: 170 });
    expect(pet.petRuntime.interaction).toHaveBeenCalledWith({ kind: 'body_touch' });

    firePointer(document.querySelector('.pet-canvas')!, 'down', { screenX: 10, screenY: 10 });
    firePointer(document.querySelector('.pet-canvas')!, 'up', { screenX: 10, screenY: 10 });
    expect(pet.petRuntime.interaction).toHaveBeenCalledTimes(1);
  });

  it('画布 rect 无效（jsdom 未 mock）时 zone 为 null，不回退 DOM 命中', () => {
    render(<PetExperience />);
    // 不 installCanvasRect：默认 getBoundingClientRect 宽高为 0
    const head = document.querySelector('[data-hit="head"]');
    firePointer(head!, 'down', { screenX: 100, screenY: 100 });
    firePointer(head!, 'up', { screenX: 100, screenY: 100 });
    expect(pet.petRuntime.interaction).not.toHaveBeenCalled();
  });
```

（import 区加 `import { getCharacterManifest } from './character-manifests.js';`。）

- [ ] **Step 2: 跑测试确认失败** `npx vitest run apps/desktop/src/pet/pet-experience.test.tsx` —— 新用例 1/3 红（实现仍走 DOM data-hit：用例 1 点击 .pet-canvas 无 data-hit 祖先本就不触发→该用例可能已绿；用例 2 manifest prop 不存在→TS/运行红；用例 3 红——现状 DOM 命中会触发 head_touch）。记录实际红绿情况。

- [ ] **Step 3: 实现** —— `pet-experience.tsx`：

1. import 增加：

```ts
import { getCharacterManifest } from './character-manifests.js';
import type { CharacterManifest } from '@pet/protocol';
import { hitTestZone, zoneToInteractionKind } from './zone-hit.js';
```

2. props 增加与默认值：

```ts
export interface PetExperienceProps {
  /** 形象协议 manifest：交互区域/能力的单一事实源；缺省星屿（协议 §6） */
  manifest?: CharacterManifest;
  /* 其余既有字段不变 */
}
```

函数签名解构加 `manifest = getCharacterManifest('star-isle')`。

3. 画布 ref（`PET_CANVAS_BASE` 常量已在文件中）：

```ts
const canvasRef = useRef<HTMLDivElement | null>(null);
```

`.pet-canvas` div 加 `ref={canvasRef}`。

4. `HitPart` 语义迁移：手势结构 `hit: HitPart | null` 改为 `zone: string | null`；`HIT_INTERACTION` 映射表删除，改用 `zoneToInteractionKind`。新增命中解析（放在 handlePointerDown 内、screenSample 之后）：

```ts
// manifest 几何命中（阶段 C）：client 坐标换算回 240×260 逻辑画布；
// 画布 rect 无效（宽高为 0，如 jsdom 未 mock / 异常布局）→ zone=null，
// 不回退 DOM data-hit（单一真相源，协议 §6）
const canvasRect = canvasRef.current?.getBoundingClientRect();
let zone: string | null = null;
if (canvasRect && canvasRect.width > 0 && canvasRect.height > 0) {
  zone = hitTestZone(manifest.interaction.zones, {
    x: ((e.clientX - canvasRect.left) * PET_CANVAS_BASE.width) / canvasRect.width,
    y: ((e.clientY - canvasRect.top) * PET_CANVAS_BASE.height) / canvasRect.height,
  });
}
```

`gestureRef.current` 初始化/复位处 `hit: null` → `zone: null`（全部四处：初始 useRef、endActiveDrag 复位、pointerup 复位、pointerdown 赋值）。

5. pointerup 的 click 分支：`gesture.hit` 判断与 `HIT_INTERACTION[gesture.hit]` 改为：

```ts
      } else if (kind === 'click' && gesture.zone) {
```

```ts
runtime.interaction({ kind: zoneToInteractionKind(gesture.zone) });
```

6. `main.tsx`：`<PetExperience ... />` 增加 `manifest={getCharacterManifest(character.id)}`（import `getCharacterManifest` from './pet/character-manifests.js'）。

- [ ] **Step 4: 跑测试确认通过**

```bash
npx vitest run apps/desktop/src/pet/pet-experience.test.tsx apps/desktop/src/pet/zone-hit.test.ts
```

预期：全过（23 既有 + 3 新）。若有既有用例因坐标不在区内而红，按星屿区表（primary(80,174,89,80)/head(68,94,112,102)/tail(27,97,53,131)）把该用例坐标改到目标区内部中心，禁止改断言语义。

- [ ] **Step 5: e2e 交互回归**

```bash
pnpm --filter @pet/desktop build && npx playwright test --config e2e/playwright.config.ts star-isle.spec.ts
```

预期：与 main 基线一致（10 过 / 2 既有失败——"交互：摸头…"与"本地聊天…"为遗留失败，与本任务无关；若出现**新的**失败，几何命中换算有误，回到 Step 3 修）。

- [ ] **Step 6: 提交**

```bash
pnpm --filter @pet/desktop typecheck && pnpm lint && pnpm format
git add apps/desktop/src/pet/pet-experience.tsx apps/desktop/src/pet/pet-experience.test.tsx apps/desktop/src/main.tsx
git commit -m "feat(desktop): PetExperience 命中迁移到 manifest 几何区域（形象协议阶段 C）"
```

---

### Task 5: 每角色专属错误降级

**Files:**

- Create: `apps/desktop/src/pet/character-fallbacks.tsx`
- Modify: `apps/desktop/src/pet/character-registry.ts`、`apps/desktop/src/main.tsx`
- Test: `apps/desktop/src/pet/character-fallbacks.test.tsx`

- [ ] **Step 1: 写失败测试** `apps/desktop/src/pet/character-fallbacks.test.tsx`：

```tsx
// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CHARACTERS } from './character-registry.js';

afterEach(cleanup);

describe('每角色专属错误降级（协议 §11.8）', () => {
  it('全部角色声明 FallbackComponent', () => {
    for (const c of CHARACTERS) {
      expect(c.FallbackComponent, `${c.id} 应有专属降级组件`).toBeTypeOf('function');
    }
  });

  it('CodeNoNo 降级渲染静态 spritesheet 标记（非空、含 viewport）', () => {
    const { CodenonoFallback } = CHARACTERS.find((c) => c.id === 'codenono')!;
    const { container } = render(<CodenonoFallback />);
    expect(container.querySelector('.spritesheet-pet__viewport')).not.toBeNull();
  });

  it('奶盖降级渲染静态图片标记（非空 img）', () => {
    const { CreamKittenFallback } = CHARACTERS.find((c) => c.id === 'cream-kitten')!;
    const { container } = render(<CreamKittenFallback />);
    expect(container.querySelector('.image-pet__img')).not.toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** `npx vitest run apps/desktop/src/pet/character-fallbacks.test.tsx` → FAIL（FallbackComponent 不存在）。

- [ ] **Step 3: 实现** `apps/desktop/src/pet/character-fallbacks.tsx`：

```tsx
/**
 * 每角色专属错误降级（形象协议阶段 C，§11.8）。
 *
 * VisualComponent 渲染抛错时，PetVisualBoundary 降级到"该角色"的静态
 * 剪影，而不是统一变成星屿（旧 PetFallback 行为）。spritesheet/图片角色
 * 复用各自模块的 renderStatic* 静态标记输出（与动画组件不同代码路径，
 * 组件本体崩溃时静态标记仍可渲染）；星屿沿用 PetFallback。
 */
import { PetFallback } from './pet-fallback.js';
import { renderStaticCreamKitten } from './image-visual.js';
import { renderStaticSpritesheet } from './spritesheet-visual.js';

function StaticMarkupFallback({ html, testId }: { html: string; testId: string }) {
  return <div data-testid={testId} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function CodenonoFallback() {
  return <StaticMarkupFallback html={renderStaticSpritesheet()} testId="codenono-fallback" />;
}

export function CreamKittenFallback() {
  return <StaticMarkupFallback html={renderStaticCreamKitten()} testId="cream-kitten-fallback" />;
}

export { PetFallback };
```

`character-registry.ts`：`CharacterConfig` 增加字段：

```ts
  /** 渲染抛错时的角色专属静态降级（协议 §11.8）；缺省通用 PetFallback */
  FallbackComponent?: ComponentType;
```

（`ComponentType` 已在该文件 import。）三条目分别加 `FallbackComponent: PetFallback` / `CodenonoFallback` / `CreamKittenFallback`（import 相应模块；registry 已是 jsdom 测试环境，模块级 `new Image()` 预载可承受）。

`main.tsx`：`<PetExperience ... FallbackComponent={character.FallbackComponent ?? PetFallback} />`（import `PetFallback` from './pet/pet-fallback.js'）。

- [ ] **Step 4: 跑测试确认通过** `npx vitest run apps/desktop/src/pet/character-fallbacks.test.tsx apps/desktop/src/pet/character-registry.test.ts` → PASS。

- [ ] **Step 5: 提交**

```bash
pnpm --filter @pet/desktop typecheck && pnpm lint && pnpm format
git add apps/desktop/src/pet/character-fallbacks.tsx apps/desktop/src/pet/character-fallbacks.test.tsx apps/desktop/src/pet/character-registry.ts apps/desktop/src/main.tsx
git commit -m "feat(desktop): 每角色专属错误降级组件（形象协议阶段 C）"
```

---

### Task 6: 全量验证 + 文档收尾

- [ ] **Step 1: 全量测试** `pnpm test` → 全绿（952 + 新增 ≈ 18 用例）。

- [ ] **Step 2: 静态检查** `pnpm typecheck && pnpm --filter @pet/desktop typecheck && pnpm lint && pnpm format` → 干净。

- [ ] **Step 3: e2e 对照基线** `pnpm --filter @pet/desktop build && npx playwright test --config e2e/playwright.config.ts star-isle.spec.ts` → 与 main 基线一致（10 过 / 2 既有失败），不得新增失败。

- [ ] **Step 4: spec 状态行更新** —— 设计稿状态行改为：

```markdown
- **状态**：已批准；阶段 A+B+C 已落地（manifest schema + 三角色数据 + 产品消费方迁移），阶段 D 见 docs/superpowers/plans/
```

- [ ] **Step 5: 提交**

```bash
git add docs/superpowers/specs/2026-08-20-desktop-pet-character-protocol-design.md
git commit -m "docs: 形象协议阶段 C 落地状态更新"
```

---

## 执行结果（2026-08-20）

阶段 C 已在 `feat/character-protocol-stage-c` 完成：9 个提交（22a6337…22b759a），每任务经"实现 → 规范审查 → 质量审查 → 修复 → 复审"闭环；全量 976/976 单测、typecheck/lint/format 干净、e2e **11 过/1 失败优于基线**（基线 10/2，"交互：摸头"用例转绿，仅剩已知"本地聊天"遗留失败）。审查修复的实质问题：面板窗从未收到 `pet:profile-changed`（实时换装死代码）、CodeNoNo 固定视口在面板小容器里放大裁切、`interaction.enabled=false` 被忽略（含锁定测试空转的反事实修正——保留 zones 仅翻转开关）。实现者另抓到计划自身两处错误：三角形 polygon 测试几何断言写错（(20,25) 实为内点，改凹五边形）、`<entry.FallbackComponent! />` 非法 JSX。

### 遗留 backlog（最终审查确认延后）

1. **阶段 D**：降级组件与本体共享渲染路径——`renderStaticSpritesheet` 仍是同一组件的渲染函数，本体 render 期崩溃会击穿 boundary fallback 导致宠物窗白屏；修法：`PetExperience` 内为 `<FallbackComponent/>` 再包一层 `PetVisualBoundary`（兜底 `PetFallback`）并修正 character-fallbacks.tsx 注释。
2. **阶段 D**：未知 PetId 回退星屿仍是静默的（registry/manifests 两处），spec §11 末段要求可观察诊断。
3. **阶段 D**：向下拖动对所有角色发 `tail_touch`、drag/dblclick 在透明区/enabled=false 时仍可用——预存语义，待命中语义二次收敛时处理。
4. **文案**：friends.tsx 三处"星屿"文案（64/255/315）与 `security.ts:86`/`preload/index.ts:131` 的"main→pet 推送"注释漂移。
5. **打磨**：面板打开瞬间非星屿用户看到星屿头像闪一下（useCurrentCharacter 初始值 star-isle）。

## Self-Review 记录

- **Spec 覆盖**：§11.7（缩略图去 if/else → Task 1）、§11.8（角色专属降级 → Task 5）、§11.9（面板去星屿硬编码 → Task 1）、§6.3/§6.4（几何命中 + zone→指令映射 → Task 3/4）、§11.2（文案单源 → Task 2）、backlog #2/#3 → Task 2。**本轮不做**（记录为阶段 D/后续）：zone-id 正则放宽（无角色需要命名空间区域 ID，YAGNI）、`data-hit` DOM 属性删除（e2e 锚点，阶段 D 清理）、`CharacterVisualProvider` 命名的 context 版本（hook+组件已满足"等价 registry 读取路径"，避免过度设计）。
- **占位符扫描**：无 TBD/TODO；Task 1 Step 6 的 grep 步骤附明确替换规则与已知行号；Task 4 Step 1.3 坐标校验附区表数据。
- **类型一致性**：`CharacterVisualProps.state?: StarIsleVisualState`、`hitTestZone(zones, point) → string | null`、`zoneToInteractionKind(zoneId) → PetInteraction['kind']`、`CharacterConfig.FallbackComponent?: ComponentType`、`PetExperienceProps.manifest?: CharacterManifest` 各任务间一致；`CurrentCharacter.manifest` 用 `ReturnType<typeof getCharacterManifest>` 推导。
