# 星屿动画深化（尾巴/耳朵节奏 + 走路循环）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `docs/superpowers/specs/2026-08-03-star-isle-animation-refine-design.md` 深化星屿动画：尾巴非对称摆 + 状态差异化、耳朵竖起/下垂情绪通道、走路四拍子循环（bob + 划动 + 后足），并打通 idle 随机溜达触发。

**Architecture:** 纯 CSS keyframes（`apps/desktop/src/styles.css`，只动 transform/opacity）驱动 SVG 部件（`apps/desktop/src/pet/star-isle-visual.tsx`）；后足从 body 组拆出为独立 data-part（仅拆分，不删既有部件）；溜达调度器加在 Main 进程 `PetRuntimeController`（`setTimeout` 已注入，测试用 `vi.useFakeTimers`）。pet-state 零改动（`IDLE ↔ WALKING`、白名单已就绪）。

**Tech Stack:** React SVG + CSS animations、vitest、Electron main 单测、Playwright e2e。

**规格文档:** `docs/superpowers/specs/2026-08-03-star-isle-animation-refine-design.md`（§4 尾巴 / §5 耳朵 / §6 走路 / §7 触发 / §8 测试）

---

### Task 1: 后足拆组（SVG 结构 + 测试先行）

**Files:**

- Modify: `apps/desktop/src/pet/star-isle-visual.test.tsx`（追加断言）
- Modify: `apps/desktop/src/pet/star-isle-visual.tsx:90-107`（后足拆组）

后足目前是 body 组内两个静态椭圆（`cx=98/182, cy=284`），走路循环需要它们独立动画。拆成两个独立 `<g data-part="foot-left" class="star-isle__foot star-isle__foot-left">` / `data-part="foot-right"`。命中区 rect 保留在 body 组（热区不变）。

- [ ] **Step 1: 写失败测试**——在 `star-isle-visual.test.tsx` 的 `adds depth layers` 测试后追加：

```tsx
it('splits hind feet into independent parts for walk animation', () => {
  const html = renderToStaticMarkup(<StarIsleVisual state={DEFAULT_VISUAL_STATE} />);
  expect(html).toContain('data-part="foot-left"');
  expect(html).toContain('data-part="foot-right"');
  expect(html).toContain('class="star-isle__foot star-isle__foot-left"');
  expect(html).toContain('class="star-isle__foot star-isle__foot-right"');
});
```

- [ ] **Step 2: 确认失败**

Run: `npx vitest run apps/desktop/src/pet/star-isle-visual.test.tsx`
Expected: FAIL——`data-part="foot-left"` 不存在。

- [ ] **Step 3: 实现拆组**——`star-isle-visual.tsx` 中，把 body 组内两个后足椭圆（`cx="98" cy="284"` 与 `cx="182" cy="284"` 两段 `<ellipse ... rx="16" ry="11" .../>`）移出到 body 组之后、前肢组之前，改为：

```tsx
      {/* 后足（独立组：走路循环对角步态动画；不参与 body 呼吸形变） */}
      <g data-part="foot-left" className="star-isle__foot star-isle__foot-left">
        <ellipse
          cx="98"
          cy="284"
          rx="16"
          ry="11"
          fill={COLORS.fur}
          stroke={STROKE.color}
          strokeWidth={STROKE.width}
        />
      </g>
      <g data-part="foot-right" className="star-isle__foot star-isle__foot-right">
        <ellipse
          cx="182"
          cy="284"
          rx="16"
          ry="11"
          fill={COLORS.fur}
          stroke={STROKE.color}
          strokeWidth={STROKE.width}
        />
      </g>
```

- [ ] **Step 4: 确认通过**

Run: `npx vitest run apps/desktop/src/pet/star-isle-visual.test.tsx`
Expected: PASS（既有 10 个 anatomy class 断言不受影响——只增不删）。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/pet/star-isle-visual.test.tsx apps/desktop/src/pet/star-isle-visual.tsx
git commit -m "feat(pet): split hind feet into independent parts for walk animation"
```

---

### Task 2: 尾巴节奏（非对称摆 + 尾星延迟 + 状态差异化）

**Files:**

- Modify: `apps/desktop/src/styles.css:512-520`（`star-isle-tail` keyframes）
- Modify: `apps/desktop/src/styles.css:372-383`（尾巴选择器区）
- Modify: `apps/desktop/src/styles.css:478-480`（`star-isle__tail-star` 常亮呼吸规则）

CSS 无单测，验证 = 全量单测不回归 + 目测（Step 4）。

- [ ] **Step 1: 改尾巴 keyframes（非对称摆：30% 到位、70% 回摆）**——把现有 `star-isle-tail` 替换，并在其后新增 `star-isle-tail-sad` 与 `star-isle-tail-star`：

```css
/* 尾巴非对称摆：快摆到位（30%）、慢速回摆（70% 占空比），尾部惯性感 */
@keyframes star-isle-tail {
  0%,
  100% {
    transform: rotate(0deg);
  }
  30% {
    transform: rotate(9deg);
  }
}
/* 难过：尾巴下垂慢摆（向下压后轻微回摆） */
@keyframes star-isle-tail-sad {
  0%,
  100% {
    transform: rotate(-4deg);
  }
  50% {
    transform: rotate(-1deg);
  }
}
/* 尾端星：同向摆动但延迟 0.15s（余韵感），幅度为尾巴的约 60% */
@keyframes star-isle-tail-star {
  0%,
  100% {
    transform: rotate(0deg);
  }
  30% {
    transform: rotate(5.5deg);
  }
}
```

- [ ] **Step 2: 改尾巴选择器区（拆分 idle/walk/sit 共用规则 + sad + 尾星延迟）**——把现有 372-383 行替换为：

```css
/* 尾巴摆动（非对称）：idle 慢摆、walk 随步伐、sit 保留轻摆 */
[data-motion='idle'] .star-isle__tail {
  animation: star-isle-tail 2.8s ease-in-out infinite;
}
[data-motion='walk'] .star-isle__tail {
  animation: star-isle-tail 0.7s ease-in-out infinite;
}
[data-motion='sit'] .star-isle__tail {
  animation: star-isle-tail 2.8s ease-in-out infinite;
}
[data-motion='happy'] .star-isle__tail {
  animation: star-isle-tail 1.2s ease-in-out infinite;
}
[data-motion='sad'] .star-isle__tail {
  animation: star-isle-tail-sad 5s ease-in-out infinite;
}
[data-motion='happy'] .star-isle__tail-star {
  animation: star-isle-glow 1.2s ease-in-out infinite;
}

/* 尾端星延迟跟随摆动（idle/walk/sit；特异性高于下方常亮呼吸规则） */
[data-motion='idle'] .star-isle__tail-star,
[data-motion='walk'] .star-isle__tail-star,
[data-motion='sit'] .star-isle__tail-star {
  animation: star-isle-tail-star 2.8s ease-in-out infinite 0.15s;
}
```

- [ ] **Step 3: 保留 sleep 尾巴与常亮呼吸**——sleep 尾巴规则（`[data-motion='sleep'] .star-isle__tail { animation: star-isle-tail 4.5s ... }`，386-391 行）不变（旧 `star-isle-tail` 已改为非对称，sleep 直接继承新形状，4.5s 周期不变）；文件尾部 `.star-isle__tail-star { animation: star-isle-glow 2.8s ... }`（478-480 行）保留（sleep 等无 motion 规则覆盖的场合仍呼吸）。

- [ ] **Step 4: 验证不回归 + 目测**

Run: `npx vitest run apps/desktop/src/pet/star-isle-visual.test.tsx`
Expected: PASS
目测：`pnpm dev` → idle 尾巴"快摆慢回"、尾星 0.15s 延迟跟随；`data-motion` 切到 sad（本地聊天触发 sad 输出）观察垂尾。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/styles.css
git commit -m "feat(pet): asymmetric tail swing with state rhythm and star lag"
```

---

### Task 3: 耳朵节奏（好奇竖起 + 放松下垂，左右正负角拆分）

**Files:**

- Modify: `apps/desktop/src/styles.css:603-615`（`star-isle-ear-tip` → 左右 perk keyframes + drop keyframes）
- Modify: `apps/desktop/src/styles.css:418-424`（idle 耳朵选择器）
- Modify: `apps/desktop/src/styles.css:407-416`（touch 耳朵——加 transform-origin 上下文）

- [ ] **Step 1: 替换耳朵 keyframes**——把现有 `star-isle-ear-tip`（603-615 行）整体替换为：

```css
/* 耳尖微动：偶发"好奇竖起"——对称外展（左右正负角拆分），回弹微过冲 */
@keyframes star-isle-ear-perk-left {
  0%,
  84%,
  100% {
    transform: rotate(0deg);
  }
  90% {
    transform: rotate(-9deg);
  }
  95% {
    transform: rotate(2deg);
  }
}
@keyframes star-isle-ear-perk-right {
  0%,
  84%,
  100% {
    transform: rotate(0deg);
  }
  90% {
    transform: rotate(9deg);
  }
  95% {
    transform: rotate(-2deg);
  }
}
/* 放松下垂（sad/sleep）：对称下压 + 缓慢微喘 */
@keyframes star-isle-ear-drop-left {
  0%,
  100% {
    transform: rotate(-8deg);
  }
  50% {
    transform: rotate(-6deg);
  }
}
@keyframes star-isle-ear-drop-right {
  0%,
  100% {
    transform: rotate(8deg);
  }
  50% {
    transform: rotate(6deg);
  }
}
```

- [ ] **Step 2: 改耳朵选择器（idle 竖起、sad/sleep 下垂）+ 耳根原点**——把 407-424 行区域替换为：

```css
/* 耳朵绕根部旋转（默认 transform-origin 是部件包围盒中心） */
.star-isle__ear-left,
.star-isle__ear-right {
  transform-origin: 50% 92%;
}

/* 触摸：低头，耳朵向外放松下垂（保留；rotate 方向沿用现状） */
[data-motion='touch'] .star-isle__head {
  animation: star-isle-touch 1.3s ease-in-out infinite;
}
[data-motion='touch'] .star-isle__ear-left {
  transform: rotate(9deg);
}
[data-motion='touch'] .star-isle__ear-right {
  transform: rotate(-9deg);
}

/* 待机：偶发好奇竖起（左右异步：左 0s / 右 0.7s） */
[data-motion='idle'] .star-isle__ear-left {
  animation: star-isle-ear-perk-left 5.5s ease-in-out infinite;
}
[data-motion='idle'] .star-isle__ear-right {
  animation: star-isle-ear-perk-right 5.5s ease-in-out infinite 0.7s;
}

/* 难过/睡眠：双耳缓慢下垂（与垂尾同节奏） */
[data-motion='sad'] .star-isle__ear-left,
[data-motion='sleep'] .star-isle__ear-left {
  animation: star-isle-ear-drop-left 5s ease-in-out infinite;
}
[data-motion='sad'] .star-isle__ear-right,
[data-motion='sleep'] .star-isle__ear-right {
  animation: star-isle-ear-drop-right 5s ease-in-out infinite;
}
```

- [ ] **Step 3: 验证 + 目测**

Run: `npx vitest run apps/desktop/src/pet/star-isle-visual.test.tsx`
Expected: PASS（anatomy class 断言含 `star-isle__ear`，不受影响）
目测：`pnpm dev` → idle 偶发双耳对称竖起；sad/sleep 时双耳下垂。

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/styles.css
git commit -m "feat(pet): ear perk and droop channels with symmetric left/right keyframes"
```

---

### Task 4: 走路循环（垂直 bob + 前肢划动 + 后足对角步态）

**Files:**

- Modify: `apps/desktop/src/styles.css:542-569`（walk 三组 keyframes → 新相位组）
- Modify: `apps/desktop/src/styles.css:341-353`（walk 选择器区）

**规格 §6 相位表执行修正**：规格示意 `75% translateY(+1.5px)`（落地轻压）与右前肢 75% 划动相位冲突（抬脚应上浮），改为对称双 bob（`25% -3px` / `75% -3px`）——每 0.35s 一步一抬一落，左右步态对称，符合规格 §3"相位协调"硬性要求。

- [ ] **Step 1: 替换 walk keyframes**——把 `star-isle-walk-body` / `star-isle-walk-head` / `star-isle-paw-step`（542-569 行）整体替换为：

```css
/* 行走（0.7s 两步循环）：身体 bob + 轻摆合并进同一关键帧 transform */
@keyframes star-isle-walk-body {
  0%,
  100% {
    transform: rotate(-2.5deg) translateY(0);
  }
  25% {
    transform: rotate(0deg) translateY(-3px);
  }
  50% {
    transform: rotate(2.5deg) translateY(0);
  }
  75% {
    transform: rotate(0deg) translateY(-3px);
  }
}
/* 头：反向微晃 + 轻微点头 */
@keyframes star-isle-walk-head {
  0%,
  100% {
    transform: rotate(2deg) translateY(0);
  }
  50% {
    transform: rotate(-2deg) translateY(1px);
  }
}
/* 前肢交替划动（左右正负角拆分）：前划 + 微抬 */
@keyframes star-isle-paw-step-left {
  0%,
  100% {
    transform: rotate(0deg) translateY(0);
  }
  50% {
    transform: rotate(-8deg) translateY(3px);
  }
}
@keyframes star-isle-paw-step-right {
  0%,
  100% {
    transform: rotate(0deg) translateY(0);
  }
  50% {
    transform: rotate(8deg) translateY(3px);
  }
}
/* 后足对角步态：与对侧前肢同相（左后足随右前肢，右后足随左前肢） */
@keyframes star-isle-foot-step-left {
  0%,
  100% {
    transform: rotate(0deg);
  }
  50% {
    transform: rotate(-5deg);
  }
}
@keyframes star-isle-foot-step-right {
  0%,
  100% {
    transform: rotate(0deg);
  }
  50% {
    transform: rotate(5deg);
  }
}
```

- [ ] **Step 2: 改 walk 选择器区**——把 341-353 行替换为：

```css
/* 行走：身体 bob + 前肢交替划动 + 后足对角步态 + 尾巴随步（尾巴规则见尾巴区） */
[data-motion='walk'] .star-isle__body {
  animation: star-isle-walk-body 0.7s ease-in-out infinite;
}
[data-motion='walk'] .star-isle__head {
  animation: star-isle-walk-head 0.7s ease-in-out infinite;
}
[data-motion='walk'] .star-isle__paw-left {
  animation: star-isle-paw-step-left 0.7s ease-in-out infinite;
}
[data-motion='walk'] .star-isle__paw-right {
  animation: star-isle-paw-step-right 0.7s ease-in-out infinite 0.35s;
}
[data-motion='walk'] .star-isle__foot-left {
  animation: star-isle-foot-step-left 0.7s ease-in-out infinite 0.35s;
}
[data-motion='walk'] .star-isle__foot-right {
  animation: star-isle-foot-step-right 0.7s ease-in-out infinite;
}
```

注意后足左右延迟与前肢**相反**：右前肢延迟 0.35s（与左前肢交替）→ 左后足（随右前肢）延迟 0.35s；右后足（随左前肢）延迟 0s。

- [ ] **Step 3: 验证 + 目测**

Run: `npx vitest run apps/desktop/src/pet/star-isle-visual.test.tsx apps/desktop/electron/main/pet-runtime-controller.test.ts`
Expected: PASS（此阶段 walk 仍无触发，仅确认 CSS 改动不破坏结构测试）
目测（临时验证方式）：`pnpm dev` 后临时把 Task 5 的 `WANDER_MIN_DELAY_MS` 设小，或临时在 DevTools 里给 SVG 根加 `data-motion="walk"`，观察 bob/划动/后足对角步态/尾巴随步。

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/styles.css
git commit -m "feat(pet): natural walk loop with bob, paw stroke and diagonal foot gait"
```

---

### Task 5: 溜达调度器（idle 随机溜达 → WALKING 3–5s）

**Files:**

- Modify: `apps/desktop/electron/main/pet-runtime-controller.test.ts:33-41`（既有 `getTimerCount` 断言 1→2）并追加新测试
- Modify: `apps/desktop/electron/main/pet-runtime-controller.ts`（调度器）

- [ ] **Step 1: 改既有断言**——`pet-runtime-controller.test.ts` 中 `stops all timers while hidden...` 测试的 `expect(vi.getTimerCount()).toBe(1)`（约 53 行）改为：

```ts
// tick + wander 两个定时器
expect(vi.getTimerCount()).toBe(2);
```

- [ ] **Step 2: 写失败测试**——在 `pet-runtime-controller.test.ts` 的 `approves local offline actions...` 测试后追加：

```ts
it('wanders: random 30-90s enters WALKING, then returns to IDLE after 3-5s', () => {
  vi.useFakeTimers();
  const snapshots: PetRuntimeSnapshot[] = [];
  const visuals: PetVisualCommand[] = [];
  const runtime = makeRuntime(visuals, snapshots);
  runtime.start();

  // 90s 推进必触发溜达（随机上限）；期间 tick 不降级（180s 才 SITTING）
  vi.advanceTimersByTime(90_000);
  expect(snapshots.at(-1)?.state).toBe('WALKING');
  expect(visuals).toContainEqual({ type: 'motion', motion: 'walk', intensity: 1 });

  // 3-5s 后回 IDLE（游荡结束定时器上限 5s）
  vi.advanceTimersByTime(5_000);
  expect(snapshots.at(-1)?.state).toBe('IDLE');

  runtime.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not wander while QUIET (rearms instead of entering WALKING)', () => {
  vi.useFakeTimers();
  const snapshots: PetRuntimeSnapshot[] = [];
  const visuals: PetVisualCommand[] = [];
  const runtime = makeRuntime(visuals, snapshots);
  runtime.start();
  runtime.setDnd(true);

  vi.advanceTimersByTime(90_000);
  expect(runtime.snapshot.state).toBe('QUIET');
  expect(snapshots.every((s) => s.state !== 'WALKING')).toBe(true);

  runtime.stop();
  expect(vi.getTimerCount()).toBe(0);
});
```

- [ ] **Step 3: 确认失败**

Run: `npx vitest run apps/desktop/electron/main/pet-runtime-controller.test.ts`
Expected: FAIL——`wanders...` 测试中 `snapshots.at(-1)?.state` 为 `SITTING` 或 `IDLE`（推进 90s 后无溜达逻辑，`180s - 90s` 未降级，实际为 IDLE；断言 `WALKING` 失败）。

- [ ] **Step 4: 实现调度器**——`pet-runtime-controller.ts`：

a) 常量区（`BOOT_STRETCH_MS` 后）追加：

```ts
/** 溜达调度（7.2 idle 随机溜达）：开始延迟 30-90s、持续 3-5s */
const WANDER_MIN_DELAY_MS = 30_000;
const WANDER_MAX_DELAY_MS = 90_000;
const WANDER_DURATION_MIN_MS = 3_000;
const WANDER_DURATION_MAX_MS = 5_000;
```

b) 字段区（`bootTimeout` 后）追加：

```ts
  private wanderTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private wanderEndTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
```

c) `ensureTickTimer`（345-355 行）中，`this.interval === null` 分支后追加 `this.armWanderTimer();`（hidden 分支已由 `stopTimers` 清空，无需在此处理）：

```ts
if (this.interval === null) {
  this.interval = this.setIntervalFn(() => this.onTick(), TICK_MS);
}
this.armWanderTimer();
```

d) `stopTimers`（371-380 行）追加清理：

```ts
if (this.wanderTimer !== null) {
  this.clearTimeoutFn(this.wanderTimer);
  this.wanderTimer = null;
}
if (this.wanderEndTimer !== null) {
  this.clearTimeoutFn(this.wanderEndTimer);
  this.wanderEndTimer = null;
}
```

e) 新私有方法（`armBootTimeout` 前插入）：

```ts
  /** 挂起溜达开始定时器（30-90s 随机；已挂起/隐藏时不重复挂） */
  private armWanderTimer(): void {
    if (this.stopped || this.hidden || this.wanderTimer !== null) return;
    const delay =
      WANDER_MIN_DELAY_MS +
      Math.floor(Math.random() * (WANDER_MAX_DELAY_MS - WANDER_MIN_DELAY_MS));
    this.wanderTimer = this.setTimeoutFn(() => {
      this.wanderTimer = null;
      this.startWander();
    }, delay);
  }

  /** 溜达开始：仅 IDLE 时进入 WALKING（QUIET/SLEEPING/OFFLINE 等重新挂起）；walk 经动作审批 */
  private startWander(): void {
    if (this.stopped) return;
    if (this.machine.current !== 'IDLE') {
      this.armWanderTimer();
      return;
    }
    this.machine.transition('WALKING', 'wander_start');
    const decision = this.requestAction({ intent: 'walk', source: 'system' });
    if (!decision.approved) {
      // 理论不达（WALKING 白名单含 walk）；防御性回退
      this.machine.transition('IDLE', 'wander_abort');
    }
    this.emitSnapshot();
    this.wanderEndTimer = this.setTimeoutFn(() => {
      this.wanderEndTimer = null;
      this.endWander();
    }, WANDER_DURATION_MIN_MS + Math.floor(Math.random() * (WANDER_DURATION_MAX_MS - WANDER_DURATION_MIN_MS)));
  }

  /** 溜达结束：仍在 WALKING 才回 IDLE；随后重新挂起下一轮 */
  private endWander(): void {
    if (this.stopped) return;
    if (this.machine.current === 'WALKING') {
      this.machine.transition('IDLE', 'wander_done');
      this.emitSnapshot();
      this.emitVisual({
        type: 'motion',
        motion: stateToMotion(this.machine.current),
        intensity: 1,
      });
    }
    this.armWanderTimer();
  }
```

说明：`transition('WALKING')` 先于 `requestAction`——WALKING 白名单含 `walk`，审批必过；`requestAction`（public，215 行）approved 时已 emit `motion: 'walk'`，无需重复广播；`transition` 失败（非 IDLE 竞态）时 `machine.transition` 返回 false 但会吞掉——`startWander` 已先判 `current === 'IDLE'`，无竞态入口（单线程 Main）。

**实现期修订（活动窗口，防降级不可达）**：溜达循环使 IDLE 连续时长永远 < 180s，空闲降级（SITTING/SLEEPING）在 Controller 层不可达。修订：

- 常量 `WANDER_STOP_IDLE_MS = 150_000`（< 180s 降级阈值）；
- 字段 `lastActivityAt`；`nowMs()` 私有方法（`options.now?.() ?? Date.now()`）；
- `start()` 与 `handleInteraction` / `handleChat` / `handleSocialEvent` 开头刷新 `lastActivityAt`；
- `armWanderTimer` 检查 `nowMs() - lastActivityAt > WANDER_STOP_IDLE_MS` 则不再挂起——久置无活动后溜达停止，降级自然发生；
- 测试：首个测试降级断言改为 `advanceTimersByTime(500_000 - 1_200)` 后断言 SITTING（最坏末轮溜达结束 ≤245s，+180s → SITTING；500s 内不到 SLEEPING）；新增"交互刷新活动窗口"测试（130s 时触摸，再 90s 仍见 WALKING）；
- 提交：`fix(pet): stop wander beyond activity window so idle degrade to SITTING stays reachable`（在 Task 5 主提交之后、独立提交）。

- [ ] **Step 5: 确认通过**

Run: `npx vitest run apps/desktop/electron/main/pet-runtime-controller.test.ts`
Expected: PASS（15 个既有 + 2 个新测试，共 17）。

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/electron/main/pet-runtime-controller.test.ts apps/desktop/electron/main/pet-runtime-controller.ts
git commit -m "feat(pet): idle wander scheduler enters WALKING 30-90s and returns after 3-5s"
```

---

### Task 6: e2e 弱断言 + 全量验证

**Files:**

- Modify: `e2e/star-isle.spec.ts`（末尾追加溜达弱断言）

- [ ] **Step 1: 追加 e2e 弱断言**——`e2e/star-isle.spec.ts` 末尾（`reduced-motion` 测试后）追加：

```ts
test('溜达：90s 内出现过 walk 动作（弱断言，随机性未观察到则跳过）', async () => {
  const pet = await app.petWindow();
  const isle = pet.getByRole('img', { name: '星尾狐猫星屿' });
  const seenWalk = await isle.evaluate(
    (el) =>
      new Promise<boolean>((resolve) => {
        const deadline = Date.now() + 90_000;
        const timer = setInterval(() => {
          if (el.getAttribute('data-motion') === 'walk') {
            clearInterval(timer);
            resolve(true);
          } else if (Date.now() > deadline) {
            clearInterval(timer);
            resolve(false);
          }
        }, 500);
      }),
  );
  test.skip(!seenWalk, '90s 内未观察到溜达（随机性，跳过）');
});
```

（若执行时该用例频繁超时跳过或干扰其他用例，可删除——单测已覆盖调度逻辑，规格 §8 允许。）

- [ ] **Step 2: 全量验证**

Run: `npx vitest run`
Expected: 53 个测试文件全部 PASS（466 + 新增）。

Run: `pnpm typecheck`
Expected: 无错误输出。

Run: `pnpm lint`
Expected: 无 error。

Run: `npx prettier --check apps/desktop/src/styles.css apps/desktop/src/pet/star-isle-visual.tsx apps/desktop/src/pet/star-isle-visual.test.tsx apps/desktop/electron/main/pet-runtime-controller.ts apps/desktop/electron/main/pet-runtime-controller.test.ts e2e/star-isle.spec.ts`
Expected: All matched files use Prettier code style!

Run: `pnpm test:e2e:star-isle`（需先 `pnpm --filter @pet/desktop build`；后端不可达时跳过依赖后端的用例）
Expected: 既有用例全绿 + 新溜达用例（或按随机性跳过）。

- [ ] **Step 3: 最终目测**——`pnpm dev` 检查清单：
  1. idle：尾巴快摆慢回（2.8s 非对称）、尾星 0.15s 延迟、双耳偶发对称竖起（左右异步）；
  2. 溜达：30-90s 内星屿走几步（bob + 前肢交替划动 + 后足对角 + 尾巴随步）后回 idle；
  3. sad（本地聊天触发 sad 输出）：垂尾 + 垂耳；
  4. 触摸/聊天/happy 不受影响（动作审批路径未改）；
  5. 拖动窗口、reduced-motion 开关后动画整体禁用仍生效。

- [ ] **Step 4: 提交**

```bash
git add e2e/star-isle.spec.ts
git commit -m "test(e2e): weak assert for idle wander walk motion"
```

---

## Self-Review 记录（计划作者自查）

- **规格覆盖**：§4 尾巴（Task 2）✓；§5 耳朵（Task 3）✓；§6 走路（Task 4，后足拆组 Task 1）✓；§7 溜达触发（Task 5）✓；§8 测试矩阵（Task 1/5 单测 + Task 6 e2e）✓；§10.5 定时器清理（Task 5 stopTimers）✓；§10.1 选择器拆分（Task 2）✓。
- **执行修正已标注**：bob 相位 `75% +1.5px` → `75% -3px`（对称双 bob，避免左右步态不对称），Task 4 开头注明。
- **既有测试联动**：`getTimerCount` 断言 1→2（Task 5 Step 1）——不加此步 Task 5 Step 5 会红。
- **类型一致性**：`wanderTimer/wanderEndTimer` 命名全程一致；`requestAction({intent:'walk', source:'system'})` 与既有 `PetActionRequest` 契约一致（`source` 含 `'system'`）。
