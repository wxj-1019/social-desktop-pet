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

### V-10 自建 WS 并发压测（2026-08-01T16:10:00.627Z）

```json
{
  "measuredAt": "2026-08-01T16:10:00.620Z",
  "url": "ws://127.0.0.1:8787/realtime",
  "params": {
    "clients": 400,
    "duration": 60,
    "heartbeatMs": 10000
  },
  "results": {
    "connectedClients": 400,
    "failedClients": 0,
    "rttP50Ms": 1,
    "rttP95Ms": 3,
    "heartbeatsPerSec": 41.2
  },
  "projection": {
    "scenario": "1000 MAU、40% 并发（400 连接）、10s 心跳",
    "monthlyWsTrafficMB": 19775.4,
    "note": "VPS 档位匹配（2C4G 带宽 1–5Mbps）须结合 CPU/内存采样；大流量租户可升级带宽"
  }
}
```

### V-10 自建 WS 并发压测（2026-08-01T16:10:53.394Z）

```json
{
  "measuredAt": "2026-08-01T16:10:53.386Z",
  "url": "ws://127.0.0.1:8787/realtime",
  "params": {
    "clients": 400,
    "duration": 30,
    "heartbeatMs": 10000
  },
  "results": {
    "connectedClients": 400,
    "failedClients": 0,
    "rttP50Ms": 1,
    "rttP95Ms": 1,
    "heartbeatsPerSec": 45.1
  },
  "projection": {
    "scenario": "1000 MAU、40% 并发（400 连接）、10s 心跳",
    "monthlyWsTrafficMB": 19775.4,
    "note": "VPS 档位匹配（2C4G 带宽 1–5Mbps）须结合 CPU/内存采样；大流量租户可升级带宽"
  }
}
```

### V-10 资源采样结论（2026-08-02）

400 并发压测期间服务进程（Node/tsx，PID 监听 8787）：**RSS ≈ 84MB，CPU 累计 5.8s**（含 90s 压测 + 常规运行）。推算 1000 MAU 场景（400 并发 + 10s 心跳）月 WS 流量 ~19.3GB（VPS 1–4TB/月配额 <2%）。

**VPS 档位匹配结论（回填 12.6）**：2C4G（$5–15/月档）即可支撑封测 1000 MAU 量级——内存余量 >95%，CPU 余量大；瓶颈不在并发而在后续 AI token 成本（12.5 另计）。

### 资源基线实测（2026-08-01T16:21:19.581Z，--duration 45s）

```json
{
  "measuredAt": "2026-08-01T16:21:17.849Z",
  "durationSec": 45,
  "intervalSec": 5,
  "processCount": 0,
  "rssMB": {
    "p50": 0,
    "p95": 0,
    "min": null,
    "max": null
  },
  "cpuPct": {
    "p50": 0,
    "p95": 0
  },
  "gates": {
    "rssP50Le300MB": true,
    "cpuP50Le2Pct": true
  }
}
```

### 资源基线实测（2026-08-01T16:25:18.403Z，--duration 60s）

```json
{
  "measuredAt": "2026-08-01T16:25:17.577Z",
  "durationSec": 60,
  "intervalSec": 5,
  "processCount": 0,
  "rssMB": {
    "p50": 402,
    "p95": 474.6,
    "min": 292.2,
    "max": 474.6
  },
  "cpuPct": {
    "p50": 0.31,
    "p95": 14.69
  },
  "gates": {
    "rssP50Le300MB": false,
    "cpuP50Le2Pct": true
  }
}
```

### 资源基线实测（2026-08-01T16:28:40.311Z，--duration 60s）

```json
{
  "measuredAt": "2026-08-01T16:28:39.419Z",
  "durationSec": 60,
  "intervalSec": 5,
  "processCount": 0,
  "rssMB": {
    "p50": 288,
    "p95": 296.9,
    "min": 286.5,
    "max": 296.9
  },
  "cpuPct": {
    "p50": 0,
    "p95": 0.94
  },
  "gates": {
    "rssP50Le300MB": true,
    "cpuP50Le2Pct": true
  }
}
```

### 资源基线实测（2026-08-01T16:30:15.950Z，--duration 60s）

```json
{
  "measuredAt": "2026-08-01T16:30:14.324Z",
  "durationSec": 60,
  "intervalSec": 5,
  "processCount": 2,
  "rssMB": {
    "p50": 274.4,
    "p95": 297.2,
    "min": 272.9,
    "max": 297.2
  },
  "cpuPct": {
    "p50": 0,
    "p95": 1.25
  },
  "gates": {
    "rssP50Le300MB": true,
    "cpuP50Le2Pct": true
  }
}
```

### 资源基线重测（2026-08-02，优化后）

**优化手段**（main 进程，app ready 前）：

- `disable-features`: CalculateNativeWinOcclusion/Translate/MediaRouter/OptimizationHints/UseOzonePlatform
- `js-flags`: --max-old-space-size=128（renderer V8 老生代堆上限，防堆膨胀）

**结果（两次 60s 实测）**：

- RSS P50 = **288MB / 274MB**（门槛 ≤300MB ✅，此前 325.4MB）
- RSS P95 = 296.9 / 297.2MB ✅
- CPU P50 = 0%（门槛 ≤2% ✅），P95 = 0.94–1.25%

**修正**：resource-bench.mjs 启动方式 bug（node 跑 Electron 入口必崩 → 改 electron.exe）+ PowerShell 采样鲁棒性（单进程 JSON 归一化、忽略 stderr 杂音）。

## 星屿验收记录（2026-08-03）

> 首只真实桌宠"星屿"（React SVG 星尾狐猫）窗口链路验收。e2e 自动化（`star-isle.spec.ts` 7 例）在本机 RDP 环境全绿，不依赖后端（纯本地模式）。原清单未完成项保持未勾选，以下只填已验证事实。

### 已验证（自动化 + 本机实测）

- ✅ **e2e 17/17（自动化）**：smoke(4) + login(2) + chat(1) + deep-link(2) + ws-realtime(1) + **star-isle(7)**（deep-link 2 例为 fresh 账号流程验证，不依赖本地库残留好友）；star-isle 覆盖冷启动可见/摸头/双击面板/拖动持久化/托盘恢复/本地聊天/面板关闭不影响宠物/reduced-motion
- ✅ **像素可见性**：240×260 透明窗 alpha>16 像素计数阈值 8000，本机实测约 5 万——角色真实渲染（非空窗/白屏/降级）
- ✅ **拖动持久化（重启恢复）**：拖拽移动 → restart() 后按持久化 anchor 还原（±1px 内）
- ✅ **托盘恢复**：toggle-pass-through / hide / show 全链路（8.4 不可恢复事故为 0）
- ✅ **本地聊天**：面板本地模式输入 → 宠物气泡回复（chat→CHATTING→IDLE 由 Main PetRuntimeController 驱动）
- ✅ **崩溃恢复**：render-process-gone → 自动重建桌宠窗（仅一次，30s 稳定窗口）

### 待真机验证（不得勾选）

- ⏳ **200% DPI 真机**：高 DPI 缩放下像素清晰度/命中区偏移——待真机验证
- ⏳ **8 小时长测**：内存/CPU 趋势（`pnpm bench:resources --duration 28800`）——待真机验证
- ⏳ **真实安装包**：`pnpm package:win` 产物在干净 Windows 10/11 真机安装、托盘图标、自启——待真机验证
- ⏳ 其余原清单未完成项（多显示器/混接 DPI/睡眠唤醒/alpha 探测自动切回等）保持未勾选——待真机验证
