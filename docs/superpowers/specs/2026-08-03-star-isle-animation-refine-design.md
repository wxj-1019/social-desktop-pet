# 星屿动画深化设计（尾巴/耳朵节奏 + 走路循环）

> 日期：2026-08-03
> 状态：设计已确认，待用户审阅正式规格
> 范围：桌面端星屿 CSS 动画节奏深化 + 走路循环 + 走路触发路径
> 前置：`2026-08-01-star-isle-visible-pet-design.md`（4.2 分层部件 / 4.3 视觉语义）
> 前序打磨：`68175da`（连贯性：opacity 过渡替代 display 硬切、尾巴绕根部旋转）与 `80aa893`（动作丰富度：坐姿/开心/惊讶等）

## 1. 背景与目标

星屿的动画体系已完成两轮打磨（尺寸与连贯性），本轮继续深化三处节奏：

1. **尾巴动画节奏** —— 现状为匀速单摆，机械感强，状态间无差异化；
2. **耳朵动画节奏** —— 现状只有"偶发轻抖"，未实现设计稿 4.3 语义表的"好奇竖起 / 放松下垂 / 触摸反馈"；
3. **走路循环** —— 现状无垂直 bob、前肢不前后划动、后足是死椭圆，缺乏自然步态感。

**风格基调（已确认）**：自然灵动——小动物式真实感，延续上一轮"连贯性"方向。不使用大幅弹跳（遵守设计稿 4.3"星屿不使用大幅弹跳表达所有情绪"）。

**成功标准**：

- 尾巴：非对称摆（快摆慢回）+ 尾星延迟跟随 + 状态差异化节奏；
- 耳朵：好奇竖起、放松下垂两档情绪语义，左右异步；
- 走路：垂直 bob + 前肢前后划动 + 后足参与的四拍子循环；
- 走路动画真实可见（打通触发路径，见 §7）。

## 2. 现状分析

| 深化点                         | 现状关键帧                                                 | 周期                                       | 问题                                         |
| ------------------------------ | ---------------------------------------------------------- | ------------------------------------------ | -------------------------------------------- |
| 尾巴 `star-isle-tail`          | `rotate 0→9°→0` ease-in-out                                | idle/walk/sit 2.8s、happy 1.4s、sleep 4.5s | 匀速单摆机械感；尾星不参与；状态差异仅时长   |
| 耳朵 `star-isle-ear-tip`       | 0-86% 静止，90% `rotate 5°`，94% `rotate -2°`              | 5.5s（右耳偏移 0.9s）                      | 只有"抖"；无竖起/下垂语义                    |
| 走路 `walk-body/head/paw-step` | 身体 `±2.5°`、头反向 `±2°`、前肢仅 `translateY 3.5px` 交替 | 0.7s（前肢错开 0.35s）                     | 无垂直 bob；前肢不划动；后足静态；尾巴不随步 |
| 触发                           | `WALKING` 状态与转换已就绪（pet-state），**无任何触发源**  | —                                          | walk 动画实际不可见                          |

## 3. 设计总则

- **CSS 约束**：关键帧只动 `transform` / `opacity`，禁止布局属性（延续现有注释约定）；
- **transform-origin**：尾巴已绕根部（`22% 92%`）；新增耳朵/后足动画需各自设置合理原点（耳根部、足部）；
- **reduced-motion**：已有 `[data-reduced-motion='true']` 全局禁用无限动画，本轮无需改动；
- **SVG 结构**：仅允许"拆分已有部件"（后足出组），不允许删除/重命名既有 `data-part` 与解剖 class（测试与 CSS hook 兼容，见 §8）；
- **相位协调**：同频动画（走路 0.7s）必须在关键帧上对齐相位，避免各部件各动各的（本轮"连贯性"主题）。

## 4. 尾巴节奏

### 4.1 非对称摆（快摆慢回）

```css
@keyframes star-isle-tail {
  0%,
  100% {
    transform: rotate(0deg);
  }
  30% {
    transform: rotate(9deg);
  } /* 快摆到峰 */
  /* 30%→100% 缓回：尾部惯性感 */
}
```

`ease-in-out` 保留；惯性感来自"30% 到位、70% 时间回摆"的不对称占空比。

### 4.2 尾星延迟跟随

`star-isle__tail-star` 增加同向摆动关键帧，动画延迟 `0.15s`（摆动的余韵）：

```css
@keyframes star-isle-tail-star {
  /* rotate 幅度约为尾巴的 60%，延迟 0.15s */
  0%,
  100% {
    transform: rotate(0deg);
  }
  30% {
    transform: rotate(5.5deg);
  }
}
```

注意 `tail-star` 组内现有 `star-glow` 圆形光晕（happy 时 `star-isle-glow` opacity 脉冲）——两层动画属性不冲突（transform vs opacity），可并存。

### 4.3 状态差异化节奏

| 状态    | 周期 | 关键帧                              | 语义                                   |
| ------- | ---- | ----------------------------------- | -------------------------------------- |
| `idle`  | 2.8s | 4.1 非对称摆 0→9°                   | 安静但活着的轻摆                       |
| `happy` | 1.2s | 非对称小摆 0→7°（由现有 1.4s 收紧） | 高频喜悦                               |
| `sad`   | 5s   | `rotate -4°→-1°→-4°`                | 下垂慢摆，压抑感（语义表"暂停后轻摆"） |
| `walk`  | 0.7s | 与步伐同频轻摆 0→5°                 | 随步摆动（与 §6 同相位）               |
| `sleep` | 4.5s | 保留现有                            | 沉睡半垂                               |

`idle/walk/sit` 共用的 `[data-motion='walk'] .star-isle__tail` 规则拆分为按 motion 独立声明。

## 5. 耳朵节奏

### 5.1 好奇竖起（idle 主节奏）

把现有"偶发轻抖"升级为"竖起"——旋转上摆 + 微外展，绝大多数时间静止、偶发轻竖，周期保留 5.5s：

```css
/* 左右耳对称外展竖起：拆分正负角 keyframes（共用会变成歪头而非同向竖起） */
@keyframes star-isle-ear-perk-left {
  /* 左耳：绕耳根逆时针外展 */
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
  } /* 回弹微过冲 */
}
@keyframes star-isle-ear-perk-right {
  /* 右耳：绕耳根顺时针外展 */
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
```

左右耳异步错开：左 0s / 右 0.7s（现有 0.9s 微调，节奏更错落）。
transform-origin 设于耳根（`50% 92%` 左右，实施时以视觉为准）。
放松下垂（§5.2）同理拆左右正负角 keyframes。

### 5.2 放松下垂（sad / sleep）

```css
/* 左右耳对称下垂（正负角拆分，同 §5.1） */
@keyframes star-isle-ear-drop-left {
  0%,
  100% {
    transform: rotate(-8deg);
  } /* 左耳向下压 */
  50% {
    transform: rotate(-6deg);
  } /* 缓慢微喘 */
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

`[data-motion='sad']` 与 `[data-motion='sleep']` 下生效，周期分别 5s / 4.5s（与尾巴同节奏，相位协调）。

### 5.3 触摸反馈（保留微调）

现有 `[data-motion='touch'] .star-isle__ear-*` 动画保留，幅度微调（±2°），不改变结构。

### 5.4 本轮不做

"一高一低"（困惑/离线语义）——需要新增 expression 维度（如 `confused`），超出本轮范围，留待后续。

## 6. 走路循环

统一 0.7s 节奏，四拍子相位（以 0.7s 周期为 100%）：

| 部件           | 关键帧                                                       | 相位说明                     |
| -------------- | ------------------------------------------------------------ | ---------------------------- |
| 身体（含头组） | `translateY 0 → -3px(25%) → 0(50%) → +1.5px(75%) → 0`        | 垂直 bob：迈步抬起、落地轻压 |
| 头             | 保留反向 `rotate ±2°` + 微 `translateY 0 → 1px(50%)`         | 点头                         |
| 前肢左         | `rotate 0 → -8°(50%) → 0`（前划）+ `translateY 0 → 3px(50%)` | 与右肢错开 50%               |
| 前肢右         | 同上，动画延迟 0.35s                                         | 交替步态                     |
| 后足左         | `rotate 0 → 5°(50%) → 0`（后蹬）                             | 与右前肢同相                 |
| 后足右         | 同上，动画延迟 0.35s                                         | 与左前肢同相                 |
| 尾巴           | 0.7s 轻摆 0→5°                                               | 随步轻摆（§4.3）             |

- 身体现有 `rotate ±2.5°` 保留（叠加 bob：`translateY + rotate` 合并进同一关键帧 transform）；
- 现有 `star-isle-paw-step`（纯 Y 抬）替换为划动版；保留 `star-isle-paw` 等既有 class（测试兼容）；
- 后足需从 body 组内拆出为独立 `<g data-part="foot-left" class="star-isle__foot star-isle__foot-left">`（仅拆分，不删任何既有部件；`data-part="body"` 的命中区 rect 保持在 body 组，后足不含命中区，避免破坏现有点击热区）。

## 7. 走路触发 —— idle 随机溜达

`WALKING` 状态与转换在 `packages/pet-state` 已就绪但无触发源，walk 动画不可见。本轮打通：

```
IDLE ──(随机 30–90s)──▶ WALKING ──(3–5s)──▶ IDLE
```

- **实现位置**：`apps/desktop/electron/main/pet-runtime-controller.ts`，新增溜达调度器：
  - 定时器（随机 30–90s）到点且当前为 IDLE → `requestAction({ intent: 'walk' })`（WALKING 白名单含 walk，审批通过）；
  - 进入 WALKING 后设 3–5s 返回定时器 → 回 IDLE；
  - 调度器在 `QUIET/HIDDEN/SLEEPING/OFFLINE` 下不触发，已有状态已触发时跳过（避免打断礼物/聊天反应）；
  - **计时器依赖注入**（现 `TICK_MS` 已有构造注入先例），单测可用假定时器；
- **pet-state 零改动**：`IDLE ↔ WALKING` 转换、WALKING 白名单 `['idle','walk']` 均已就绪；
- **联动检查**：溜达中收到送礼（`handleSocialEvent`）→ cheer 不在 WALKING 白名单，动作被审批拒绝，但 happy 表情与送礼气泡仍正常播放——可接受（溜达为 3–5s 短时状态）；聊天进入 CHATTING 同理，状态机转换优先于溜达返回定时器（返回定时器触发时若已不在 WALKING 则忽略）。

## 8. 测试与验证

| 层   | 文件                                                        | 内容                                                                                                                                                          |
| ---- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单元 | `apps/desktop/src/pet/star-isle-visual.test.tsx`            | 新增后足 `data-part="foot-left"` / `data-part="foot-right"` 与 `star-isle__foot` class 断言；既有 10 个 anatomy class 断言保持通过（CSS hook 兼容，只增不减） |
| 单元 | `apps/desktop/electron/main/pet-runtime-controller.test.ts` | 溜达调度器：注入假定时器 → 到时进 WALKING → 3–5s 后回 IDLE；QUIET/HIDDEN/SLEEPING 不触发；溜达中送礼不崩且气泡正常                                            |
| CSS  | 无单测（纯样式）                                            | 遵守 transform/opacity 约束；reduced-motion 全局禁用无需改                                                                                                    |
| e2e  | `e2e/star-isle.spec.ts`                                     | 弱断言：等待 ≤90s 内 `data-motion` 出现过 `walk`（超时则跳过，避免 flaky）；若实施中不稳定则去掉，以单测覆盖为准                                              |

**验证方式**：本地 `pnpm dev` 目测——溜达出现频率与观感、尾巴非对称摆、耳朵竖起/下垂、走路 bob 与四足交替；自查时可将随机间隔临时缩短（实施环境变量或常量，不提交）。

## 9. 范围边界（本轮不做）

- "一高一低"困惑耳朵（需新增 expression 维度）；
- 真实位移动画（窗口位移联动行走）；
- 尾巴"抱尾/环抱身体"姿势（语义表安静态，需要结构性形变）；
- 瞳孔视线微跟随（4.2 语义表好奇态）；
- Live2D 版动作映射。

## 10. 实施注意事项

1. `styles.css` 中 `[data-motion='idle'] .star-isle__tail`、`[data-motion='walk'] .star-isle__tail`、`[data-motion='sit'] .star-isle__tail` 共用的选择器需拆分为按 motion 独立声明（§4.3）；
2. 尾巴 `sad` 下垂需要新的负角度关键帧；`happy` 由 1.4s 收紧至 1.2s 时注意与 `star-isle-bounce`（0.55s）节奏不打架；
3. 后足拆组后，`data-hit-rect`（身体命中区 rect）保持在 body 组不变，命中区不受影响；
4. 所有关键帧继续只动 transform/opacity；新 `transform-origin` 逐一确认（耳根/足部）；
5. 溜达调度器需在 `stop()` 时清理定时器（防泄漏，现有 TICK 定时器同款处理）。
