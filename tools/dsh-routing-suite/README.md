# dsh-routing-suite 工具集

针对 DeepSeek Harness（DSH）`dsh-routing-suite`（[dragonbaba/dsh-routing-suite](https://github.com/dragonbaba/dsh-routing-suite)，MIT）的安装、校验与 A/B 对比脚本。仅作为团队内部工具存放，不参与 `packages/*` 构建。

## 文件

| 文件                              | 作用                                                                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `install.ps1`                     | 安装到 DSH web profile：`dsh plugin --profile web add dsh-routing-suite` + 物化 `preset/routing-suite` → `$DSH_HOME/.agent-presets/routing-suite`（幂等） |
| `selftest.ps1`                    | 校验安装：包已装入 / preset 已物化 / 组合配置含 routing-suite（退出码 0=全过）                                                                            |
| `profile.inspect-first.patch.yml` | 把策略固定为 `inspect-first` 的独立补丁（`dsh --profile web --patch ...`）                                                                                |
| `compare-routing.ps1`             | 完整 A/B：基线 leg 走 headless 自动跑；路由 leg 起 web UI 由人工跑同任务，回复存入 `compare/routed.txt` 后自动对比                                        |
| `finish-compare.ps1`              | 只跑对比 leg [3/3]（web 已由外部启动时用），轮询等待 `compare/routed.txt`                                                                                 |
| `fast-ab.ps1`                     | **快速 A/B**（约 4 分钟全自动）：headless 同一任务跑两次——不加引导 vs 注入与插件逐字一致的 Routing guidance，判断引导是否改变行为                         |
| `compare/`                        | 已生成的对比产物（模型输出，只读任务产物）                                                                                                                |

## 环境依赖

- `dsh` CLI（DeepSeek Harness）≥ 0.1.0-rc.6，`DSH_HOME`（默认 `~/.dsh`）
- web profile 已 boot 过一次；脚本为纯 ASCII（避免 GBK 编码问题）

## 快速使用

```powershell
# 安装 + 自测
pwsh -File install.ps1        # 需要 DSH web profile 与 npm registry 网络
pwsh -File selftest.ps1

# 固定 inspect-first（已写入 web profile 的 cordis.patch.yml，重启生效）
dsh --profile web --dump-config | Select-String inspect-first

# 快速 A/B（只读任务，验证路由引导是否改变模型行为）
pwsh -File fast-ab.ps1 -Task "你的只读任务"

# 完整 A/B（路由 leg 需在浏览器 UI 人工跑，回复存 compare/routed.txt）
pwsh -File compare-routing.ps1
```

## 结论备忘（2026-08-19 实测）

- 机制层已验证：插件激活、`strategy=inspect-first` 运行时确认
- 快速 A/B（v4-flash + 审查类任务）：**路由引导无可观测收益**——模型本就在 inspect-first
- 引导只可能在**大型改码/重构任务 + 更强模型（v4-pro）**场景体现差异，复现社区 64→83 需按此口径重测
