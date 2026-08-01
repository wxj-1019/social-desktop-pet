# 窗口能力 PoC 记录（第 1–2 周门禁 · 第 2/3 项）

> 对应设计稿 16 章 PoC 验收清单第 2/3 项 + D-7（逐像素穿透折损实测）
> 平台：Windows 10/11 x64（D-2，macOS Beta 后）
> 启动方式：`pnpm --filter @pet/desktop dev` 后访问 `http://localhost:5173/?poc`（electron-vite dev 注入 URL；也可在生产构建后 `?poc`）

## 验证清单

### 1. 透明 WebGL（验收第 2 项）

- [ ] 窗口无黑底（`transparent: true` + 无背景 CSS）
- [ ] 边缘无异常（无白边/残影）
- [ ] 高 DPI（150%/200%）下无模糊
- [ ] 睡眠唤醒后 Context 恢复（无黑屏）
- [ ] 二次创建窗口正常

### 2. 鼠标穿透（验收第 3 项 + D-7 折损实测）

- [ ] 交互模式：点击/拖动正常
- [ ] 穿透模式：`setIgnoreMouseEvents(true,{forward:true})` 后点击穿透到下层窗口
- [ ] 穿透中鼠标移动到宠物上方 → alpha 探测切回（第 3 周实现，当前为手动切换）
- [ ] 托盘/快捷键恢复穿透（第 3 周接 TrayController）
- [ ] **D-7 实测记录**：边缘反复进出是否抖动？拖拽经过宠物是否误判？点击身后窗口是否需先移开？——记录真实体验，决定 MVP 卖点承诺措辞

### 3. 多显示器（验收第 3 项 + 8.5）

- [ ] 跨屏拖拽到副屏
- [ ] 副屏负坐标（主屏右侧时）
- [ ] 不同 DPI 缩放（100% + 150% 混接）
- [ ] 显示器热插拔后回到主屏并夹在可见区域内（8.5）

### 4. 性能基线（验收第 4 项，8.7 门槛）

- [ ] 冷启动到角色可见 P95 ≤ 4s
- [ ] 空闲 CPU（P50 ≤ 2%）、RSS（P50 ≤ 300MB）——**Electron 持续渲染动画下记录实测值**
- [ ] 8 小时无持续正向内存趋势（放长测）

## 实测结果记录

| 项              | 结果 | 备注 |
| --------------- | ---- | ---- |
| 透明            |      |      |
| 穿透切换        |      |      |
| 边缘抖动（D-7） |      |      |
| 多屏            |      |      |
| DPI             |      |      |
| 冷启动          |      |      |
| 空闲 CPU/RSS    |      |      |

## 退出标准

全部勾选 + 实测记录完成 → 门禁通过 → 进入第 3 周单人桌宠 Alpha。

> 遗留：Live2D 真实模型渲染的透明 WebGL 需 V-1 许可确认 + 模型交付后补测（占位 canvas 先验证窗口链路）。

### 资源基线实测解读（2026-08-01）

- **CPU P50 = 0%（8.7 门槛 ✅ 通过）**：空闲进程树几乎零占用；P95 = 0.31%，远低于 2% 门槛。
- **RSS P50 = 325.4MB（8.7 门槛 ❌ 超 25MB）**：4 个进程（main/renderer/gpu/utility）。**注意这是骨架状态——无 Live2D 模型、无动画循环、无渲染**，真实负载只会更高。印证第二轮调研结论："带 WebGL 持续动画的 Electron 桌宠，300MB P50 偏乐观"（见 [调研发现 §2.5](./superpowers/specs/2026-08-01-research-findings.md)）。
- **结论**：MVP 阶段维持 P50 门槛口径，但需在**模型接入后重测**；若持续动画下仍超 300MB，按 8.7 评估是壳层根因还是模型根因，并考虑放宽门槛（P50 → P95 观测口径已在设计稿 8.7 修订过）。
- **验证完整性**：本次为 60s 短测（链路验证）；正式验收需下限设备 + 30 分钟预热 + 8 小时长测（`pnpm bench:resources --duration 28800`）。

### 资源基线实测（2026-08-01T11:17:45.568Z，--duration 60s）

```json
{
  "measuredAt": "2026-08-01T11:17:45.051Z",
  "durationSec": 60,
  "intervalSec": 5,
  "processCount": 4,
  "rssMB": {
    "p50": 325.4,
    "p95": 325.4,
    "min": 325.4,
    "max": 325.4
  },
  "cpuPct": {
    "p50": 0,
    "p95": 0.31
  },
  "gates": {
    "rssP50Le300MB": false,
    "cpuP50Le2Pct": true
  }
}
```

### V-10 自建 WS 并发压测（2026-08-01T13:48:04.276Z）

```json
{
  "measuredAt": "2026-08-01T13:48:04.274Z",
  "url": "ws://127.0.0.1:8787/realtime",
  "params": {
    "clients": 30,
    "duration": 15,
    "heartbeatMs": 10000
  },
  "results": {
    "connectedClients": 30,
    "failedClients": 0,
    "rttP50Ms": 0,
    "rttP95Ms": 1,
    "heartbeatsPerSec": 4
  },
  "projection": {
    "scenario": "1000 MAU、40% 并发（400 连接）、10s 心跳",
    "monthlyWsTrafficMB": 19775.4,
    "note": "VPS 档位匹配（2C4G 带宽 1–5Mbps）须结合 CPU/内存采样；大流量租户可升级带宽"
  }
}
```
