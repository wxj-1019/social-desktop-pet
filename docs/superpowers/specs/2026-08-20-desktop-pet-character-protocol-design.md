# 桌宠形象统一规范协议设计

- **状态**：设计稿，待审阅
- **日期**：2026-08-20
- **适用范围**：桌宠形象注册、视觉资源、渲染器、交互区域、动画动作、角色扩展能力、角色选择与发布准入
- **关联代码**：`apps/desktop/src/pet/*`、`packages/pet-state/src/*`、`packages/protocol/src/desktop/*`、`apps/desktop/electron/main/*`
- **关联文档**：
  - `AGENTS.md`
  - `docs/superpowers/specs/2026-08-01-ai-social-desktop-pet-design.md`
  - `docs/superpowers/specs/2026-08-01-star-isle-visible-pet-design.md`
  - `docs/superpowers/specs/2026-08-03-star-isle-animation-refine-design.md`
  - `docs/status-2026-08-03.md`

## 1. 摘要

当前桌宠系统同时存在 SVG、spritesheet 和逐帧图片三种形象实现，并计划在许可门禁通过后接入 Live2D。它们共享同一个运行时，但目前在以下方面存在隐含差异：

- 视觉画布、角色占位和脚底锚点没有形成统一的可校验协议。
- 交互区域曾按 `head/body/tail` 设计，但并非所有角色拥有这些身体部位。
- 部分形象只有 `body` 命中区，部分形象拥有更细的命中区，差异没有被角色能力声明明确表达。
- 核心动作有统一枚举，但不同渲染器对动作进行了语义复用，缺少显式的覆盖/回退声明。
- 图片角色拥有 `_image*` 私有状态，角色专属能力与共享运行时边界尚未正式定义。
- 角色选择缩略图、错误降级和部分面板视觉仍硬编码为星屿。
- 资源来源、许可证、帧画布、manifest、哈希和可复现验收不完整。
- 历史设计稿存在 `280×320` 与当前实现 `240×260` 的尺寸漂移。

本协议将形象定义为三部分的组合：

```text
角色包 = 统一核心契约 + 渲染适配器 + 能力声明/扩展命名空间
```

统一核心契约保证所有形象能够接入桌宠窗口、状态机、菜单、气泡、拖动和无障碍基础设施；渲染适配器负责 SVG、spritesheet、图片帧或 Live2D 的技术实现；能力声明和扩展命名空间允许角色保留独立动作、特效、交互区域和其他协议外能力，而不污染共享核心协议。

## 2. 设计目标

### 2.1 目标

1. 新形象只要完成一份角色 manifest、一个 `VisualComponent` 和一个 `PetRenderer` 适配器，就能接入现有桌宠运行时。
2. 任何形象在桌宠缩放 `0.5–2.0`、窗口扩展菜单、气泡显示和拖动时都保持稳定的视觉锚点。
3. 通用运行时不假设形象有头、尾、身体或其他具体器官，只消费角色声明的能力。
4. 核心动作、表情、朝向、播报、减少动效、生命周期和错误处理拥有稳定语义。
5. 角色可以拥有不属于核心协议的动作和效果，但必须使用角色私有命名空间，且通用运行时不能依赖这些扩展存在。
6. 资源许可、完整性、尺寸、透明边界、动作覆盖和测试结果能够被自动检查。
7. 现有角色可以分级迁移，不因规范发布立即阻塞当前开发；未达到发布级别的角色不得标记为 `release`。

### 2.2 非目标

1. 本协议不规定所有角色必须拥有相同的外观、物种、身体结构、配色或动作表现。
2. 本协议不把所有角色专属动作加入 `@pet/protocol` 的共享枚举。
3. 本协议不允许用户任意导入模型、脚本、动态库或角色插件。角色包仍由产品内置并经过审核。
4. 本协议第一版不强制规定具体美术软件、建模软件或导出工具；只规定可验证的交付结果。
5. 本协议不替代 Live2D 商业许可、第三方资产许可证或安全审核。

## 3. 已确认的规范决策

### 3.1 唯一画布基准

后续唯一逻辑画布为：

```text
CANVAS_BASE = 240 × 260 CSS px @ scale = 1
SCALE_RANGE = 0.5 .. 2.0
```

早期设计稿中的 `280×320` 只作为历史参考，不再作为新形象交付规格。任何新角色必须以 `240×260` 逻辑坐标交付或在适配器中明确转换到该坐标系。

窗口实际尺寸为：

```text
windowWidth  = round(240 × scale)
windowHeight = round(260 × scale)
```

当菜单展开且窗口小于基准画布时，Main 侧会临时扩展窗口至至少 `240×260`，以右下角为锚点向左/上扩展。角色视觉画布仍按照用户的 `scale` 固定在窗口右下角，菜单画布独立使用 `240×260` 基准坐标。

### 3.2 能力声明式交互

协议不强制 `head/body/tail`。形象必须声明自己的交互区域：

- 可交互形象至少提供一个 `primary` 区域。
- 角色可以提供任意数量的自定义区域，例如 `accessory`、`core`、`wing-left`、`petal` 或其他角色语义名称。
- `head/body/tail` 仅作为当前旧角色的兼容 ID，不是新形象的强制字段。
- 没有某个身体部位时，不得伪造该部位或静默创建误导性区域。
- 纯展示形象可以在特殊产品模式下声明 `interaction.enabled=false`，但不能被标记为完整可交互角色。

通用运行时只依赖 `primary` 和核心交互结果。自定义区域的具体动作由角色扩展能力处理。

### 3.3 核心能力与扩展能力分层

所有角色能力分为两层：

**核心能力（core capabilities）**：共享运行时可以依赖，必须遵守本协议的稳定语义。

- 基础视觉组件渲染
- `primary` 交互区域（可交互角色）
- 核心动作映射
- 核心表情映射
- 左右朝向
- 播报状态
- 强度档位
- reduced-motion
- renderer 生命周期和销毁
- 基础无障碍标签

**扩展能力（extensions）**：角色私有，可选，不能被共享运行时假设存在。

- 角色专属动作，如 `character:spin`、`character:open-book`
- 角色专属表情、粒子、姿态或音效
- 自定义交互区域及其反馈
- 角色专属自动行为
- 角色专属资源预加载或缓存策略
- 角色专属配置面板

扩展能力必须满足：

1. 使用稳定命名空间，不得伪装成共享 `PetMotion` 或 `PetExpression`。
2. 不得改变核心动作和核心交互的既有语义。
3. 扩展缺失或加载失败时，核心桌宠功能仍可运行。
4. 扩展只能由知道该角色能力的角色组件、适配器或专用 UI 消费。
5. 扩展不能直接绕过 Main 侧状态机、安全策略、IPC allowlist 或资源许可门禁。

推荐命名格式：

```text
<character-id>:<capability-name>

例如：
star-isle:tail-spark
codenono:compile-success
cream-kitten:stretch
```

## 4. 角色包结构

每个角色必须有一个可审计的角色包。角色包可以映射到仓库内多个资源文件，但必须有一个统一 manifest 作为事实入口。

推荐目录结构：

```text
apps/desktop/src/assets/characters/<character-id>/
├── character.manifest.json
├── preview.webp                 # 角色选择页缩略图
├── thumbnail.webp               # 可选的低分辨率缩略图
├── license/                     # 许可证、归属和来源存证
│   ├── LICENSE.txt
│   ├── NOTICE.md
│   └── source.json
├── visual/                      # SVG、图片、spritesheet 或 Live2D 资源
├── motions/                     # 可选的动作资源
├── expressions/                 # 可选的表情资源
└── tests/                       # 资源验收数据或快照基线
```

实际构建工具可以使用其他目录，但必须能生成等价的 manifest 和审计记录。

### 4.1 Manifest 最小字段

```json
{
  "schemaVersion": 1,
  "id": "example-pet",
  "version": "1.0.0",
  "displayName": "示例角色",
  "petName": "示例",
  "description": "角色选择页使用的一句话介绍。",
  "renderer": "svg",
  "release": "dev-only",
  "canvas": {
    "width": 240,
    "height": 260,
    "coordinateSpace": "logical-css-px",
    "scaleRange": [0.5, 2.0],
    "anchor": "bottom-right-ground"
  },
  "visualBounds": {
    "x": 24,
    "y": 34,
    "width": 166,
    "height": 190
  },
  "interaction": {
    "enabled": true,
    "zones": [
      {
        "id": "primary",
        "shape": "rect",
        "x": 48,
        "y": 92,
        "width": 126,
        "height": 120,
        "priority": 0,
        "label": "与示例角色互动"
      }
    ]
  },
  "menuExclusionBounds": [
    {
      "id": "radial-menu-left",
      "x": 0,
      "y": 0,
      "width": 128,
      "height": 260,
      "reason": "menu-overlay"
    }
  ],
  "capabilities": {
    "coreMotions": {
      "idle": "native",
      "walk": "native",
      "sit": "fallback:idle",
      "sleep": "native",
      "happy": "native",
      "sad": "native",
      "surprised": "fallback:happy",
      "wave": "fallback:happy",
      "touch": "native",
      "talk": "native",
      "dragged": "fallback:touch"
    },
    "expressions": {
      "neutral": "native",
      "warm": "native",
      "happy": "native",
      "sad": "native",
      "surprised": "fallback:neutral",
      "shy": "fallback:warm"
    },
    "interactionZones": ["primary"],
    "facing": true,
    "speaking": true,
    "reducedMotion": true,
    "staticFallback": true
  },
  "extensions": {
    "namespace": "example-pet",
    "actions": ["example-pet:spin"],
    "effects": ["example-pet:confetti"]
  },
  "assets": {
    "preview": "preview.webp",
    "files": [
      {
        "path": "visual/example.svg",
        "sha256": "..."
      }
    ]
  },
  "license": {
    "spdx": "MIT",
    "sourceUrl": "https://example.invalid/source",
    "commercialUse": true,
    "attributionRequired": true
  }
}
```

### 4.2 Manifest 字段规则

- `id` 必须符合 `PetIdSchema`，并与 `CHARACTERS` 注册表、角色资源目录、角色选择页和持久化 profile 一致。
- `version` 使用 SemVer。资源或动作映射变化至少递增 minor；破坏核心契约必须递增 major。
- `renderer` 只能是 `svg`、`spritesheet`、`image-sequence`、`live2d` 或未来经评审加入的类型。
- `release` 只能是 `dev-only`、`bundled`、`release`。许可不清、缺少自动验收或存在已知核心兼容缺陷的角色最多为 `dev-only`。
- `canvas` 必须使用逻辑 CSS 像素，不得把原始素材像素直接当作运行时坐标。
- `visualBounds` 描述所有可见主体、配件、粒子、动作最大外接矩形和允许的阴影边界。可见内容不得超出该区域。
- `interaction.zones` 只描述命中区，不描述可见内容。命中区可以比可见像素略大，但超出部分必须是透明 padding；菜单开启时输入优先级由菜单 overlay 接管。
- `menuExclusionBounds` 是一个区域数组，描述菜单展开时需要保留给菜单的输入和可读性区域。它不要求角色平时不能在该区域显示内容；角色可以声明多个区域，以覆盖 SAO 主菜单、Classic 菜单和二级面板的实际布局。
- `capabilities.coreMotions` 和 `expressions` 必须显式列出每一项核心能力是 `native`、`fallback:<target>` 还是 `unsupported`，禁止静默映射。
- `assets.files` 中的每个发布资源都必须有哈希。构建时应拒绝 manifest 列出的文件不存在或哈希不匹配。
- `license` 必须能证明来源、许可证和商业使用结论。许可证未知不得进入 `release`。

## 5. 画布、锚点和边界协议

### 5.1 逻辑坐标系

所有角色使用左上角为 `(0,0)` 的 `240×260` 逻辑坐标系，坐标单位为 CSS px。运行时缩放由外层画布统一完成，角色内部不得自行读取 Electron 窗口物理尺寸来重新改变逻辑构图。

渲染器必须保证：

```text
logicalWidth  = 240
logicalHeight = 260
screenScale   = profile.scale
```

SVG 的 `viewBox`、spritesheet 的单帧坐标、图片帧的透明画布、Live2D 的模型矩形都必须能映射到同一逻辑坐标系。

### 5.2 脚底锚点

角色必须声明一个 `bottom-right-ground` 锚点。锚点表示角色与桌面的接触参考点，不一定是角色几何中心。

要求：

1. 缩放时脚底锚点屏幕位置保持稳定，不能因为帧切换、动作切换或角色翻转发生跳变。
2. `idle`、`walk`、`sit`、`sleep`、`dragged` 等核心状态必须声明锚点偏移；若状态共享同一底部基线，manifest 可复用同一个值。
3. 左右朝向只能改变角色朝向，不得改变底部锚点的逻辑位置。
4. 角色的底部阴影、落地特效可以有视觉变化，但不能遮蔽命中区或造成窗口拖动误判。
5. 帧序列必须使用统一透明画布或等价的 anchor metadata，不能依靠每帧不同的 CSS 偏移补齐。

### 5.3 三种边界必须分离

#### `visualBounds`

包含角色所有稳定可见内容：

- 主体轮廓
- 可见配件
- 尾迹、粒子和动作特效
- 角色专属装饰
- 可见落地阴影的最大边界

任何可见内容越过 `visualBounds` 都属于资源构图错误，不得依赖父窗口裁切解决。

#### `interactionBounds`

由一个或多个交互区域组成。它可以为了易点击加入透明 padding，但必须：

- 使用 manifest 中声明的区域 ID。
- 具有确定的坐标系、形状和优先级。
- 不覆盖菜单 overlay、关闭按钮或二级面板。
- 不因为动作状态随机改变到不可预测的位置。
- 与缩放同步变换。

#### `menuExclusionBounds`

表示菜单展开、菜单画布扩展和二级面板所需的避让范围。角色可以在该区域平时显示可见内容；菜单打开后，菜单 overlay 获得输入优先级，角色交互区不得拦截菜单点击，关键角色内容也不得因菜单层级或窗口裁切而不可读。

### 5.4 视觉安全带

角色包必须为下列系统 UI 留出稳定空间：

- 头顶气泡和一次性提示。
- 底部落地阴影和拖拽反馈。
- 菜单展开时的独立菜单画布。
- 最小缩放下仍可辨识的主体轮廓。

安全带不是把角色强行裁成相同形状，而是要求角色交付时声明最大可见边界，并在 `0.5×`、`1×`、`2×` 下通过截图验收。

## 6. 交互区域协议

### 6.1 区域 ID

`interactionZoneId` 是角色能力 ID，不是身体部位枚举。推荐：

- `primary`：基础互动区域，所有可交互形象必须提供。
- `secondary`：第二个通用区域，可选。
- `accessory`：角色可见配件对应的交互区域，可选。
- 角色专属区域：使用 `<character-id>:<name>` 或 manifest 内的短 ID。

旧的 `head`、`body`、`tail` 可以保留为兼容映射，但新代码不得通过检查这些固定字符串来推断所有角色能力。

### 6.2 区域形状

第一版允许：

- `rect`
- `circle`
- `ellipse`
- `polygon`
- `path`（仅在渲染器能稳定提供 hit testing 时）

每个区域必须声明：

```text
id
shape
geometry
priority
label
enabled
interaction mapping
```

坐标必须在逻辑画布中定义。区域不能依赖浏览器运行时的自然图片尺寸，也不能使用未记录的 DOM 偏移。

### 6.3 交互语义

通用运行时将基础交互转换为平台级事件，例如：

```text
zone click       -> character interaction event(zoneId, kind=click)
primary drag    -> window drag session
primary double  -> open chat panel
context menu    -> radial menu
```

角色扩展可以订阅 `zoneId` 和基础交互事件，并在自己的命名空间内触发专属动作。通用运行时不得把 `primary` 强行解释为“头摸”或“身体摸”。

如果角色没有可交互区域：

- 必须声明 `interaction.enabled=false`。
- 不得在 UI 中显示“可摸/可拖”的角色提示。
- 右键菜单和托盘等窗口级能力仍可以工作。

### 6.4 命中区验收

- 在 `0.5×`、`1×`、`2×` 下，区域的相对位置一致。
- 区域点击不会被角色自身的动画 transform 随意甩出画布。
- 区域不覆盖菜单、气泡输入框或窗口关闭按钮。
- `primary` 的有效命中包围盒在逻辑画布中不得小于 `40×40` CSS px；允许通过透明 padding 达到该门槛。阈值以逻辑 CSS px 计算，不以原始素材像素计算。
- 角色没有头/尾/身体时，测试不得寻找这些固定 DOM 属性，而应通过 manifest 中的区域 ID 验证。

## 7. 核心运行时契约

### 7.1 视觉状态

所有核心视觉组件消费同一份 `StarIsleVisualState` 语义，当前共享字段为：

```ts
interface CoreVisualState {
  motion: PetMotion;
  expression: PetExpression;
  intensity: 1 | 2 | 3;
  speaking: boolean;
  reducedMotion: boolean;
  facing: 'left' | 'right';
}
```

实现层可以使用内部状态，但不得改变核心字段的含义。当前图片角色的 `_image*` 字段属于历史专用扩展；新角色不得复制这些字段名作为共享契约，必须使用角色内部状态或经过审阅的扩展命名空间。

### 7.2 核心动作

核心动作全集为：

```text
idle
walk
sit
sleep
happy
sad
surprised
wave
touch
talk
dragged
```

动作是语义，不是素材文件名。每个角色必须显式声明每个动作：

- `native`：拥有原生资源或原生动画。
- `fallback:<motion>`：使用明确记录的其他核心动作回退。
- `unsupported`：角色不支持该动作，运行时执行统一回退。

推荐统一回退优先级：

```text
walk      -> idle
sit       -> idle
sleep     -> idle
happy     -> idle
sad       -> idle
surprised -> happy -> idle
touch     -> happy -> idle
talk      -> idle + speaking=true
dragged   -> touch -> idle
wave      -> happy -> idle
```

角色可以提供更好的角色内回退，但必须在 manifest 中显式声明。不能把 `touch` 静默映射成任意不相关动作，也不能让通用状态机等待一个角色永远不会完成的动作。

### 7.3 核心表情

核心表情为：

```text
neutral
warm
happy
sad
surprised
shy
```

表情可以通过骨骼参数、SVG 属性、spritesheet 单帧、图片帧或 Live2D 参数实现。若技术路线不支持独立表情，必须声明回退关系，例如 `shy -> warm`。

### 7.4 动作完成和可打断

`PetRenderer.playMotion` 返回 Promise，但不同渲染器必须遵守同一生命周期语义：

1. 一次性动作完成时 resolve。
2. 循环动作在被新动作替换或 renderer 销毁时必须 resolve/安全终止，不能悬挂。
3. 高优先级动作可以打断低优先级动作；具体优先级由共享 `pet-state` 映射决定。
4. 角色扩展动作不得改变核心动作优先级。
5. `sleep` 被唤醒时，角色可以提供自己的过渡，但最终必须进入请求的核心动作或明确回退动作。

### 7.5 朝向、播报和强度

- `facing` 只表示左右朝向。实现可以使用镜像、独立帧或 Live2D 参数。
- `speaking=true` 表示当前有播报口型/说话视觉；不要求角色拥有嘴部，但必须提供可辨别的低成本反馈或显式声明静态回退。
- `intensity 1..3` 表示动画幅度/粒子/姿态强度，不得改变角色逻辑尺寸和锚点。
- 强度越高不得让可见内容越过 `visualBounds`；若动作会与菜单层重叠，菜单开启时必须保持菜单输入优先级。

### 7.6 reduced-motion、隐藏和穿透

`reducedMotion=true` 时：

- CSS 无限动画必须停止或降为静态。
- JS/rAF、粒子、帧循环和 Live2D 参数循环必须停止。
- 组件仍保留首帧或稳定静态内容。
- 动作切换仍可更新最终状态，但不得产生持续运动。

角色隐藏时必须停止不必要的渲染、计时器、网络或资源轮询。整窗穿透是窗口级能力，不得由角色自行改变窗口穿透策略。

## 8. 渲染适配器契约

### 8.1 React 视觉组件

`VisualComponent` 必须接受：

```ts
type CharacterVisualComponent = React.ComponentType<{
  state?: StarIsleVisualState;
}>;
```

要求：

- 在 state 缺失时渲染稳定默认状态，不抛异常。
- 根节点提供稳定的 `role="img"` 和角色 aria-label。
- 根节点提供当前核心状态的 `data-*` 调试属性。
- 根节点或声明的交互节点提供 manifest 中的 interaction zone 映射。
- 不依赖 `pet-experience` 外部 DOM 的具体层级。
- 不直接注册未 allowlist 的 IPC。
- 资源加载失败时仍显示最小可见 fallback，不能出现透明空窗。

### 8.2 PetRenderer

当前共享接口为：

```ts
interface PetRenderer {
  playMotion(motion: PetMotion, intensity?: 1 | 2 | 3): Promise<void>;
  setExpression(expression: PetExpression): void;
  setSpeaking(active: boolean): void;
  setFacing(facing: PetFacing): void;
  setReducedMotion(active: boolean): void;
  dispose(): void;
}
```

renderer 必须：

1. 合并 patch 并通过 update 回调产生完整状态。
2. 不在 `dispose` 后继续更新 React 状态。
3. 清理所有 timer、rAF、事件监听和资源订阅。
4. 对资源加载失败做可观察的错误处理，并保留核心 fallback。
5. 不把角色私有动作伪装成核心 `PetMotion`。
6. 把扩展能力放在角色专属 API 或内部控制器中，除非未来协议明确扩展接口。

### 8.3 SVG 适配要求

- `viewBox` 必须映射到 `240×260` 逻辑画布或提供明确转换。
- SVG 不得通过外部远程资源才能显示主体。
- `overflow` 和 filter 阴影不能把关键内容推到窗口外。
- 动画 transform 的最大范围必须参与 `visualBounds` 验收。
- 交互区域必须与 SVG 图形或透明 hit rect 明确绑定。

### 8.4 Spritesheet 适配要求

- manifest 必须声明整图尺寸、单帧尺寸、网格、行列、动作帧范围和 FPS。
- 每个动作的帧必须在同一行/同一帧坐标规则内，不能越行或串帧。
- 所有动作帧必须共享透明画布和脚底锚点。
- `reducedMotion` 时停止 rAF。
- 左右行走必须显式声明左右帧或镜像策略。
- 单帧尺寸和显示倍率必须映射到 `240×260` 逻辑画布，不得依赖当前窗口自然宽高。

### 8.5 Image-sequence 适配要求

- 所有帧必须在同一透明画布尺寸内对齐。
- 动作 manifest 使用 `frames[] + fps`，每一帧的主体位置、脚底线和视觉 bbox 必须一致。
- 新动作不得只提交不同尺寸图片而依赖 CSS 自适应。
- 预加载失败时保留最后成功帧或静态 fallback。
- 单帧动作可以不启动 rAF，但必须保留核心状态和 data attributes。
- 眨眼、歪头、生气等角色私有行为属于扩展能力，不得污染共享动作语义。

### 8.6 Live2D 适配要求

Live2D 仍受许可门禁约束。接入时除本协议外，还必须满足：

- 一个桌宠窗口只创建一个 WebGL context。
- 模型、动作、表情、参数和纹理只能从 manifest 白名单加载。
- 资源状态必须到 `ready` 后才显示为可用角色。
- context lost、睡眠恢复和窗口重建必须能重新初始化。
- 隐藏或 reduced-motion 时停止不必要的渲染循环。
- 禁止用户脚本、动态库、任意模型包和运行时模型拼接。
- 换装只能是同一模型的部件/参数/纹理切换，不能持续新增独立模型绕过审核。
- 官方样本和 Live2D 相关许可证必须单独归档，不能因为代码可运行就视为可发布。

## 9. 角色扩展能力协议

### 9.1 扩展命名空间

每个角色最多声明一个主扩展命名空间，建议等于 `character.id`。所有扩展 ID 必须以该命名空间开头：

```text
namespace: cream-kitten
extension action: cream-kitten:stretch
extension zone: cream-kitten:bell
extension effect: cream-kitten:heart-burst
```

### 9.2 扩展生命周期

扩展可以由以下角色专属边界消费：

- `VisualComponent` 内部。
- 角色专属 `PetRenderer` 工厂返回的控制器。
- 角色专属面板或角色配置页。

扩展不得：

- 直接修改共享 PetStateMachine 的状态图。
- 绕过动作白名单、冷却、DND、隐藏或 OFFLINE 策略。
- 直接调用任意系统 API 或外部链接。
- 假设所有角色都存在同名扩展。

### 9.3 扩展与核心交互的关系

基础交互先产生通用事件：

```text
interaction(zoneId, eventType, timestamp)
```

角色可以把它映射为扩展动作，例如：

```text
zoneId = cream-kitten:bell
click -> cream-kitten:ring
```

但通用运行时仍能完成默认行为，例如 `primary` 点击反馈、拖动和双击打开聊天。扩展处理失败不得阻塞默认行为。

## 10. 资源、许可证与安全

### 10.1 资源来源

每个资源包必须记录：

- 原作者或制作团队。
- 来源 URL 或内部创作记录。
- 使用的工具和生成流程（如适用）。
- 许可证名称和 SPDX 标识（如存在）。
- 是否允许商业使用、修改、再分发和打包进 Electron asar。
- 是否需要署名、NOTICE 或额外授权。
- 对第三方模型、字体、音频、纹理和训练/生成资产的单独说明。

“推荐 MIT”“来源不明”“只有下载地址但没有许可证”都不能作为 release 级凭证。

### 10.2 完整性

发布构建必须校验：

- manifest schema。
- 资源文件存在。
- SHA-256 哈希匹配。
- 资源路径位于允许的角色包目录。
- 禁止通过远程 URL、动态 import、用户输入路径或脚本注入加载角色资源。
- 角色包不含可执行动态库、脚本注入点或未经审核的原生模块。

### 10.3 性能预算

角色包应声明并在验收中记录：

- 总资源大小。
- 单张最大纹理/帧尺寸。
- 预加载资源数量。
- 同时运行的 rAF、计时器、粒子数量。
- reduced-motion 和隐藏状态的资源消耗。
- Live2D 的 drawables、纹理和 context 使用情况。

角色不得以“视觉效果”为理由无限增加预加载、循环或高频定时器。

## 11. 角色注册与产品一致性

新增角色的接入顺序必须是：

1. 在 `@pet/protocol` 增加合法 `PetId`。
2. 添加角色包 manifest、资源、许可证和缩略图。
3. 通过 manifest 预检。
4. 实现 `VisualComponent`。
5. 实现完整 `PetRenderer` 适配器。
6. 在 `character-registry.ts` 注册 `id`、名称、描述、组件和 factory。
7. 在角色选择页使用 manifest/registry 提供的缩略图，不允许按角色 ID 写 if/else 回退到星屿。
8. 角色窗口错误降级使用该角色的静态 fallback；若角色 fallback 不可用，才使用通用 fallback，并显式记录角色丢失。
9. 聊天、设置、本地聊天、空状态和角色预览不得硬编码星屿视觉。需要统一的 `CharacterVisualProvider` 或等价 registry 读取路径。
10. 运行角色级单测、资源预检、窗口边界测试和至少一条 E2E smoke 测试。

未知 `PetId` 的默认回退仍可以是星屿，但必须产生可观察日志/诊断信息，不能把未知角色静默当成正常注册。

## 12. 现有角色迁移策略

### 12.1 星屿（star-isle）

定位：**core-reference / release candidate**。

星屿目前拥有最完整的 SVG 分层、透明命中区和状态视觉，作为协议的参考实现。迁移重点：

- 将现有 `head/body/tail` 转换为 manifest 的兼容 interaction zone。
- 把 visual bounds、anchor 和菜单避让区写入 manifest。
- 补充资源来源、版本、哈希和自动验收。
- 将 fallback 和面板缩略图接入角色 registry。

### 12.2 CodeNoNo（codenono）

定位：**legacy-compatible / dev-only 或 bundled，取决于许可证审核结果**。

已知差异：

- 当前只提供 `body` 命中区。
- 部分核心动作使用语义复用。
- spritesheet 依赖固定网格和帧表。
- 上游许可证需要正式确认，不得只依据 NOTICE 中的推荐性描述。

迁移重点：

- 提供 `primary` 显式映射，旧 `body` 作为兼容别名。
- 补齐动作覆盖矩阵和回退声明。
- 完成许可证和来源门禁。
- 添加 `0.5×/1×/2×`、reduced-motion、拖动、菜单和命中区测试。

### 12.3 奶盖（cream-kitten）

定位：**legacy-compatible / dev-only 或 bundled，取决于资源许可和帧对齐结果**。

已知差异：

- 当前只有 `body` 命中区。
- 私有 renderer 包含眨眼、歪头、生气、自动漫步和自动睡眠等行为。
- 部分动作使用语义复用。
- 现有帧图片尺寸不一致，不能只依赖注释中的统一画布约定。

迁移重点：

- 把私有行为写成 `cream-kitten` 扩展能力，不加入共享动作枚举。
- 用统一工具或预检确保所有帧的透明画布和脚底锚点一致。
- 增加图片加载失败、最后成功帧回退和 SSR/测试环境安全检查。
- 提供角色专属静态 fallback。

### 12.4 迁移等级

| 等级                | 含义                             | 可进入 release | 要求                                        |
| ------------------- | -------------------------------- | -------------- | ------------------------------------------- |
| `legacy-compatible` | 已能运行，但存在明确协议差异     | 否             | 核心渲染、primary、基础状态、生命周期不崩溃 |
| `bundled`           | 产品内置可用，仍可能有非关键差异 | 视产品发布策略 | 许可证、资源完整性、核心验收和回退完整      |
| `release`           | 完整符合本协议                   | 是             | 全部 P0/P1 验收通过，文档和审计齐全         |
| `blocked`           | 不能安全或稳定使用               | 否             | 不得注册为用户可选角色                      |

规范发布后，新形象不能直接标记为 `legacy-compatible` 逃避核心契约；该等级只用于现有角色迁移。

## 13. 验收矩阵

### 13.1 P0：注册和运行时

- [ ] `PetIdSchema`、manifest、registry、角色目录 ID 一致。
- [ ] `VisualComponent` 接受可选 state，缺省状态可渲染。
- [ ] `PetRenderer` 六个方法完整实现，`dispose` 后无更新。
- [ ] `primary` 存在，或明确声明 `interaction.enabled=false`。
- [ ] `240×260` 逻辑画布和右下脚底锚点正确。
- [ ] 未知/资源失败时存在稳定 fallback。
- [ ] 角色可以在桌宠窗口、菜单、气泡和面板切换流程中运行。

### 13.2 P0：核心动作与状态

- [ ] 11 个核心动作全部有 `native/fallback/unsupported` 声明。
- [ ] 6 个核心表情全部有声明。
- [ ] `facing`、`speaking`、`intensity`、`reducedMotion` 均有验收。
- [ ] 睡眠唤醒、拖动、行走、说话、隐藏和 OFFLINE 不出现悬挂或崩溃。
- [ ] 动作被打断时不会留下旧 timer、rAF 或错误帧。

### 13.3 P0：边界与交互

- [ ] 所有可见内容在 `visualBounds` 内。
- [ ] 交互区只包含透明 padding 或角色可见内容；菜单打开时菜单 overlay 优先接收输入。
- [ ] 交互区域在 `0.5×/1×/2×` 下位置稳定。
- [ ] primary 点击、拖动、双击和右键菜单流程通过。
- [ ] 不查找不存在的 `head/body/tail` 固定部位。
- [ ] 气泡、菜单扩窗和二级菜单不裁切角色关键内容。

### 13.4 P1：资源与性能

- [ ] 资源文件、哈希和 manifest 校验通过。
- [ ] 许可证、来源、商业使用和 NOTICE 完整。
- [ ] spritesheet 网格、帧范围、FPS 合法。
- [ ] image-sequence 所有帧画布、透明边界和脚底锚点一致。
- [ ] Live2D 许可、manifest、context 和恢复策略通过专项审核。
- [ ] reduced-motion 和隐藏状态的 rAF/timer/渲染循环已停止。
- [ ] 角色预加载失败时不会白屏或无限重试。

### 13.5 P1：产品一致性

- [ ] 角色选择页显示正确缩略图、名称和描述。
- [ ] 聊天、设置、本地聊天、预览和错误 fallback 不硬编码星屿。
- [ ] 角色切换、重启、多显示器、DPI 和菜单扩窗不改变脚底锚点。
- [ ] 至少一条角色级 E2E smoke 测试覆盖打开、交互和切换。

## 14. 自动化落地顺序

### 阶段 A：建立事实源

1. 新增角色 manifest 类型和 zod schema，放在共享协议或角色资源包的明确边界内。
2. 将 `PetId`、registry 和资源 manifest 建立一致性检查。
3. 定义 `visualBounds`、anchor、interaction zones 和 menu exclusion 的纯数据结构。

### 阶段 B：适配现有角色

1. 星屿先完成完整 manifest，作为 reference implementation。
2. CodeNoNo 和奶盖补 `primary`、动作回退、资源许可证和帧/网格验收。
3. 把图片角色私有行为改用扩展命名和角色内部控制器表达。

### 阶段 C：改造产品消费方

1. 用角色 registry/manifest 驱动角色选择缩略图。
2. 引入角色感知的 `CharacterVisualProvider`，消除聊天、设置、预览和 fallback 中的星屿硬编码。
3. 将 PetExperience 的交互命中从固定 `head/body/tail` 迁移为 manifest zone ID。
4. 保留旧 ID 的兼容映射，直到现有角色迁移完成。

### 阶段 D：自动验收与准入

1. 编写资源预检 CLI：manifest、文件存在、哈希、尺寸、透明画布、许可证。
2. 编写动作/表情覆盖矩阵测试。
3. 编写 0.5/1/2 scale、DPI、菜单、气泡、命中区和 reduced-motion 的组件测试。
4. 增加每个 release 角色的 E2E smoke 和角色选择页回归。
5. CI 中阻止不完整或许可证未知的角色进入发布包。

## 15. 待实现但已明确的接口方向

以下内容属于后续实现计划，不在本设计稿中直接修改代码，但协议已经为其留出边界：

- `CharacterManifestSchema` 和 manifest 加载器。
- `InteractionZone` 数据结构与 hit testing 适配层。
- `CharacterVisualProvider`，统一角色选择页、聊天、设置和 fallback 的视觉来源。
- `CharacterExtensionRegistry` 或等价的角色扩展能力边界。
- 资源预检 CLI 和 CI gate。
- 角色级视觉快照和缩放/DPI E2E 工具。
- Live2D manifest schema、context 恢复和许可审计。

这些接口落地时必须遵守本协议，不得为了兼容某一个角色重新引入固定 `head/body/tail` 或隐含的角色尺寸假设。

## 16. 结论

后续桌宠形象不是“换一张图”或“再加一个组件”，而是一个经过 manifest 声明、渲染器适配、资源审计和自动验收的角色包。

统一的不是角色长相，而是以下边界：

```text
统一画布与锚点
统一核心状态和动作语义
统一生命周期与降级
统一 primary 基础交互能力
统一资源和许可证门禁
统一验收标准
角色专属能力在命名空间内自由扩展
```

通过这套协议，拥有尾巴的角色、没有身体结构的角色、纯图片角色、spritesheet 角色和未来 Live2D 角色都可以共存，而不会迫使通用运行时假设它们拥有相同的身体部位或相同的动画实现。
