# 星尾狐猫「星屿」真实可见桌宠设计

> 日期：2026-08-01  
> 状态：已完成视觉共创，待用户审阅正式规格  
> 范围：Windows 10/11 首版完整单人桌宠  
> 参考边界：借鉴 PetDex 的透明浮窗、可拖动、状态驱动动画和低打扰气泡机制；不复制其代码、角色、素材、品牌、文案或界面

## 1. 目标

在现有 Electron 桌面端中交付第一只真实可见、可交互、离线可用的原创桌宠「星屿」。星屿必须成为应用的第一视觉信号，而不是聊天面板旁的装饰图。

首版必须证明三件事：

1. 用户启动应用后立即看到一只会呼吸、眨眼、休息的桌宠。
2. 用户可以摸头、拖动、双击聊天，并能可靠地从托盘恢复穿透或隐藏状态。
3. 未登录或断网时星屿仍可使用；登录只解锁云端聊天、记忆和好友能力。

## 2. 已确认的产品决定

| 项目     | 决定                                      |
| -------- | ----------------------------------------- |
| 视觉技术 | Q 版 2D 精灵，不在首版使用 Live2D         |
| 角色类型 | 原创幻想兽                                |
| 角色名称 | 星尾狐猫「星屿」                          |
| 核心性格 | 温暖好奇，亲近但不过度黏人                |
| 资产方式 | 项目内程序绘制的原创分层 SVG              |
| 渲染路线 | React SVG + CSS/Web Animations            |
| 窗口布局 | 宠物优先，小型透明宠物窗 + 按需功能面板窗 |
| 离线策略 | 未登录、断网时仍可触摸、拖动和本地聊天    |
| 首版平台 | Windows 10/11 x64                         |
| 首版边界 | 完整单人桌宠，不包含好友送礼和拜访动画    |

## 3. 非目标

以下能力明确不进入本轮：

- Live2D Cubism SDK、`.moc3` 模型和任意角色导入；
- 复制或打包 PetDex 的角色、spritesheet、代码、品牌或文案；
- PetDex 式图鉴、商店、角色市场和在线资产下载；
- 好友宠物拜访、礼物接收动画和共同任务；
- 逐像素透明区域穿透；首版只支持整窗手动穿透；
- 语音、TTS、真实音素口型；
- 大型粒子场景、复杂物理或全桌面路径规划；
- macOS 签名、公证和窗口行为验收。

## 4. 角色视觉设计

### 4.1 角色轮廓

星屿采用狐猫混合轮廓：圆润身体、较大的三角耳、短前肢和蓬松长尾。辨识特征为：

- 蓝紫色外耳与浅蓝身体；
- 额间小型暖黄色光冠；
- 尾端星形暖黄色光源；
- 深蓝灰瞳孔和暖粉腮红；
- 宽高比接近 1:1，缩小到 160 CSS px 时仍能识别耳、眼、尾星。

角色不得依赖外部图片文件才能显示。最小静态轮廓直接由 React SVG 组件渲染，因此资源加载失败时也不会出现透明空窗。

### 4.2 分层部件

`StarIsleVisual` 至少包含以下独立 SVG 分组：

- `body`：呼吸、坐下和睡眠主形变；
- `head`：轻摆、低头和说话点头；
- `ear-left` / `ear-right`：好奇竖起、放松下垂、触摸反馈；
- `eye-left` / `eye-right`：眼睑、瞳孔和视线微跟随；
- `mouth`：闭合、微笑、说话三态；
- `paw-left` / `paw-right`：挥手和拖动姿势；
- `tail`：摆动、抱尾和拖动下垂；
- `tail-star`：亮度、缩放和暖色光晕；
- `crown`：情绪亮度和轻微漂浮；
- `cheeks`：开心和触摸时的透明度变化。

所有 SVG path、颜色和动画关键帧由本项目原创实现，并在文件头记录创作来源为项目自制。

### 4.3 视觉语义

星屿不使用大幅弹跳表达所有情绪。首版优先通过耳朵、尾巴和光效表达：

| 语义      | 耳朵     | 星尾       | 光冠         | 面部             |
| --------- | -------- | ---------- | ------------ | ---------------- |
| 好奇      | 同向竖起 | 小幅上扬   | 轻亮         | 瞳孔向目标微移   |
| 开心      | 放松外展 | 摆动并变亮 | 暖色脉冲一次 | 眯眼、微笑、腮红 |
| 安静      | 自然放松 | 环抱身体   | 低亮         | 正常眨眼         |
| 困倦      | 缓慢下垂 | 抱尾       | 逐渐变暗     | 半闭眼           |
| 困惑/离线 | 一高一低 | 暂停后轻摆 | 短闪一次     | 轻歪头           |

## 5. 窗口与页面架构

### 5.1 双窗口模型

现有单窗口拆为两个 BrowserWindow，二者加载同一 renderer bundle，但使用不同 surface 参数：

- `petWindow`：固定 280×320 CSS px，透明、无框、置顶、跳过任务栏、不可由用户调整尺寸；只渲染星屿、短气泡和极小状态入口。
- `panelWindow`：沿用现有 360×480 功能尺寸，按需显示；承载登录、本地聊天、云端聊天和好友页面。关闭行为是隐藏，不退出进程。

`petWindow` 是应用生命周期的主窗口。`panelWindow` 不存在或加载失败时，不影响桌宠待机、触摸、拖动和托盘控制。

### 5.2 页面入口

renderer 根据查询参数或 hash 选择根组件：

- `surface=pet` → `PetExperience`
- `surface=panel` → `AppPanel`

禁止在 `petWindow` 中挂载完整登录或聊天面板。星屿必须在未认证阶段仍然显示。

### 5.3 面板打开规则

下列操作打开 `panelWindow`：

- 双击星屿；
- 右键菜单选择“聊天”或“好友”；
- 托盘菜单选择“打开面板”；
- 未来深链需要用户处理邀请时。

面板默认锚定在星屿左侧或右侧，并通过 DisplayController 约束在当前工作区内。若空间不足，选择可见面积更大的一侧。

## 6. 运行时组件边界

### 6.1 主进程

新增 `PetRuntimeController`，作为两个窗口共享的单一宠物状态源：

- 持有 `@pet/pet-state` 的 `PetStateMachine`；
- 接收触摸、聊天、勿扰、隐藏、在线状态和 AI 动作请求；
- 将动作来源区分为 `local_interaction`、`local_chat`、`cloud_ai` 和 `system`；
- 执行状态转换和动作审批；
- 向 `petWindow` 发出只读状态快照与视觉命令；
- 向 `panelWindow` 发出当前状态，供 UI 展示；
- 维护动作冷却和空闲 tick；
- 隐藏或退出时停止 tick。

状态机纯逻辑继续保留在 `packages/pet-state`。Electron 控制器只负责生命周期、IPC 和事件广播。

### 6.2 PetExperience

`PetExperience` 只负责角色展示与直接交互，包含：

- `StarIsleVisual`：原创 SVG DOM；
- `PetAnimator`：状态/动作到 Web Animations 的适配器；
- `PointerInteraction`：点击、拖动、双击和右键分流；
- `PetBubble`：角色上方短气泡；
- `PetFallback`：动画初始化失败时的静态星屿。

### 6.3 PetRenderer 接口

首版 React SVG 实现必须通过以下抽象消费视觉命令：

```ts
interface PetRenderer {
  playMotion(motion: MotionName, intensity: 1 | 2 | 3): Promise<void>;
  setExpression(expression: ExpressionName): void;
  setSpeaking(active: boolean): void;
  setReducedMotion(active: boolean): void;
  dispose(): void;
}
```

接口不得暴露 SVG selector、DOM 节点或动画实现细节。未来 spritesheet 或 Live2D 渲染器可替换该实现，而无需修改状态机、聊天和 Electron 窗口逻辑。

### 6.4 动作适配

现有 `stateToMotion`、`stateToExpression` 和 `shouldInterrupt` 继续作为纯函数使用。补充两个适配器：

- `actionIntentToMotion(intent)`：处理 `nod`、`shake_head`、`cheer`、`comfort` 等协议意图；
- `emotionToExpression(emotion)`：覆盖 `apologetic` 和 `concerned`，映射到首版可表现的表情组合。

模型仍只能提供 `ActionIntent`、`Emotion` 和 `intensity` 枚举。最终动作必须经 `PetRuntimeController.requestAction()` 审批。

为满足“断网仍可用”，`ActionRequest` 增加来源字段。`OFFLINE` 只拒绝 `cloud_ai` 来源；用户直接触摸、拖动、本地聊天和系统恢复动作仍可执行。`QUIET` 与 `HIDDEN` 继续抑制主动动画。该规则需在 `packages/pet-state` 中作为纯逻辑实现并增加回归测试。

## 7. 交互设计

### 7.1 启动与空闲

1. 应用启动后立即创建并显示 `petWindow`。
2. 星屿播放不超过 1.2 秒的伸懒腰动作，然后进入 `IDLE`。
3. `IDLE` 持续呼吸、随机眨眼和小幅耳尾动作。
4. 沿用状态机默认值：空闲 3 分钟进入 `SITTING`，坐下 10 分钟进入 `SLEEPING`。
5. 点击、拖动、聊天或打开面板会唤醒星屿并回到允许的活动状态。

随机动画必须使用有上限的调度器，不为每个部件创建长期独立 timer。隐藏时清理所有 timer 和 animation。

### 7.2 指针分流

`PointerInteraction` 使用 pointer capture，并按以下规则分类：

- 移动距离小于 6 CSS px 且短按释放：点击；
- 6 CSS px 以上：拖动；
- 320 ms 内两次短点击：双击；
- `contextmenu`：请求主进程显示原生菜单。

点击命中区域：

- 头部 → `touch`，眯眼、低头、耳朵放松、星尾亮起；
- 身体 → 温和回应，保持 `idle`；
- 尾巴 → 尾巴短暂躲开，受动作冷却限制。

### 7.3 拖动窗口

由于整个窗口不能同时使用 CSS draggable region 和精细点击，拖动通过受控 IPC 完成：

1. `pet:drag-start`：主进程记录鼠标屏幕坐标和窗口初始 bounds；
2. `pet:drag-move`：renderer 每 animation frame 最多发送一次鼠标屏幕坐标；
3. 主进程按初始偏移计算窗口位置，并约束到可用显示器范围；
4. `pet:drag-end`：保存 displayId、锚点、位置和时间；
5. 异常中断时释放拖动状态，不保留全局鼠标监听。

坐标必须通过 zod 验证为有限数值，并限制到合理虚拟桌面范围。IPC handler 同时校验 sender URL、主 frame 和 `petWindow` 身份。

### 7.4 聊天

- 双击星屿打开聊天面板并聚焦输入框；
- 用户发送期间进入 `CHATTING`，星屿播放 talk 动作；
- 回复通过星屿上方短气泡逐段显示，长内容仍保留在面板历史中；
- 气泡最多显示两到三行，超出部分省略，不改变窗口尺寸；
- 回复结束或错误后回到 `IDLE`；
- 未登录或网络失败时自动使用现有本地规则聊天，而不是阻断星屿。

云端 SSE 的 `done` payload 应保留 `dialogue`、`emotion`、`actionIntent` 和 `intensity`。动作意图经状态机审批后执行；若拒绝，不影响文本回复。

### 7.5 托盘、勿扰与穿透

右键角色或托盘提供：

- 打开聊天；
- 打开好友；
- 勿扰模式；
- 整窗鼠标穿透；
- 隐藏星屿；
- 退出。

勿扰模式：

- 状态进入 `QUIET`；
- 只保留呼吸和低频眨眼；
- 不播放主动挥手、探头或光效；
- 不自行弹出气泡或面板。

穿透模式使用现有 `setIgnoreMouseEvents(true, { forward: true })`。首版不做逐像素穿透。进入穿透后必须能通过真实、非空托盘图标恢复。

## 8. 本地数据

新增非敏感 `PetProfile`：

```ts
interface PetProfile {
  version: 1;
  petId: 'star-isle';
  displayName: string;
  reducedMotion: boolean;
  dnd: boolean;
  bubbleEnabled: boolean;
}
```

默认名称为“星屿”。首版可展示名称但不要求完成改名 UI。

数据存储在 Electron `app.getPath('userData')` 下的版本化 JSON 文件中，使用原子临时文件替换。该文件不存 token、聊天正文、AI 密钥或记忆内容。窗口位置继续使用现有 DisplayController/position store。

## 9. IPC 与协议安全

新增 IPC schema 应放在 `@pet/protocol` 根入口导出，至少覆盖：

- `pet:drag-start`
- `pet:drag-move`
- `pet:drag-end`
- `pet:interaction`
- `pet:request-action`
- `pet:set-dnd`
- `pet:set-pass-through`
- `panel:open`
- `panel:close`
- `pet-profile:get`
- `pet-profile:set`

所有 payload 使用 zod `safeParse`。禁止继续以 TypeScript cast 替代运行时验证。

AI 输出禁止包含：

- 鼠标或窗口坐标；
- 文件路径或 URL；
- JavaScript/HTML/CSS；
- IPC channel 名；
- 系统命令；
- 本地隐私设置修改。

## 10. 错误处理与降级

| 故障                      | 用户体验             | 技术行为                                     |
| ------------------------- | -------------------- | -------------------------------------------- |
| SVG 动画初始化失败        | 显示静态星屿         | `PetFallback` 保持点击、拖动和双击           |
| `petWindow` renderer 崩溃 | 自动重建一次         | 记录 `render-process-gone`，恢复位置和状态   |
| 面板加载失败              | 星屿继续运行         | 显示短错误气泡，不退出进程                   |
| 云端不可达                | 自动进入本地聊天     | 标记离线，不阻断触摸和基础动画               |
| 拖动 IPC 失败             | 窗口停在最后有效位置 | 清除 drag session，不循环重试                |
| 保存配置失败              | 当前会话继续         | 保留内存值，记录无敏感内容的错误             |
| 位置落在缺失屏幕          | 回到主屏右下安全区   | 使用 DisplayController fallback              |
| 穿透后失去交互            | 从托盘恢复           | 启动时确保托盘图标创建成功，否则拒绝进入穿透 |

## 11. 性能与可访问性

### 11.1 性能

- 默认只运行一个 SVG 角色动画树；
- 使用 `transform` 和 `opacity`，避免布局动画；
- 动画调度器可见时运行，隐藏时暂停；
- 不以 viewport 宽度缩放字体；
- 面板关闭后不得保留聊天页面的高频 timer；
- 目标为 60 FPS，低性能环境允许降至 30 FPS；
- 尊重 `prefers-reduced-motion`，关闭耳尾摆动和光效脉冲，仅保留静态姿态及淡入淡出。

### 11.2 可访问性

- 所有可见工具按钮有可读名称和 tooltip；
- 双击聊天必须有右键和托盘等价入口；
- 不以颜色作为唯一状态信号；
- 星尾光效不闪烁超过 3 Hz；
- 面板继续支持键盘登录和聊天；
- 错误和聊天状态使用适当的 `aria-live`。

## 12. 测试设计

### 12.1 单元测试

- `actionIntentToMotion` 和 `emotionToExpression` 覆盖所有协议枚举；
- 动作优先级、中断规则和勿扰降级；
- Pointer 分类：click、drag、double-click、context menu；
- PetProfile schema、迁移和原子存储错误；
- IPC 对非法坐标、未知字段、错误 sender 的拒绝；
- PetRuntimeController 的启动、空闲、睡眠、触摸、聊天和隐藏生命周期。

### 12.2 组件测试

- 星屿 SVG 在无网络、无 session 时仍渲染；
- 每个分层部件存在且 viewBox 不溢出；
- reduced-motion 模式关闭主动循环动画；
- 气泡文本不会改变 petWindow 的固定尺寸；
- fallback 静态角色仍可触发交互。

### 12.3 Electron e2e

必须覆盖：

1. 冷启动后星屿可见；
2. 未登录时单击头部产生 touch 反馈；
3. 拖动后窗口位置变化并在重启后恢复；
4. 双击打开 panelWindow；
5. 未登录可进入本地聊天；
6. 隐藏后由托盘恢复；
7. 穿透后由托盘关闭穿透；
8. 勿扰后没有主动动作；
9. panelWindow 关闭不影响 petWindow；
10. renderer 崩溃模拟后静态或完整角色恢复；
11. 截图像素检查确认 petWindow 的角色主体区域存在足量非透明像素，防止透明空窗误判为通过。

测试使用独立 Electron `userDataDir`，不得依赖用户本机 safeStorage 或历史状态。截图需同时覆盖默认 DPI 和至少一个高 DPI viewport，并检查角色未越界、气泡未遮挡主体。

### 12.4 Windows 真机门禁

- Windows 10 与 Windows 11 各至少一台；
- 100%、150%、200% DPI 无裁切；
- 多显示器、负坐标和主显示器切换后位置可恢复；
- 勿扰、隐藏和穿透均可从托盘恢复；
- 断网启动仍显示星屿并可本地聊天；
- 隐藏时停止主动动画和 timer；
- 连续运行 30 分钟无透明空窗、崩溃或明显位置漂移；
- 打包版在没有源码、Node 和环境变量的新 Windows 用户目录中可启动。

## 13. 验收标准

本轮只有同时满足以下条件才算完成：

1. 用户启动应用时无需登录即可在桌面看到原创星屿。
2. 星屿至少完整实现 `idle`、`touch`、`talk`、`wave`、`sit`、`sleep`、`drag` 和 `offline/error` 八类视觉行为。
3. 点击、拖动、双击和右键不会互相误触，拖动位置可以恢复。
4. 本地聊天和云端聊天都能驱动 talk 状态；云端不可达自动降级。
5. 整窗穿透、勿扰和隐藏均可由真实托盘图标可靠恢复。
6. `petWindow` 与 `panelWindow` 生命周期相互独立，面板失败不造成宠物消失。
7. 所有新增 IPC 经过 zod 验证并校验 sender。
8. `pnpm --filter @pet/desktop typecheck`、lint、单测和 Electron e2e 全部通过。
9. 安装包不包含任何未经授权的 PetDex、Live2D 样本或第三方角色资产。
10. Windows 真机门禁有日期、设备、DPI、结果和复现步骤记录。

## 14. 实施前置修复

本功能实施前先修复当前桌面端独立 typecheck 错误，因为现状不满足可持续开发门禁。仅修复与桌面端类型契约相关的问题：

- Session IPC 联合返回值缩窄；
- Electron listener cleanup 返回 `void`；
- ChatEntry role 窄化；
- Login IPC `unknown` 解析。

同时将 CI 中桌面端 typecheck 作为不可跳过门禁。此项是实施前置条件，不扩大为全项目安全重构。

## 15. 后续演进

首版验收后按顺序演进：

1. 好友送点心 → 对方星屿实时开心/吃点心动作；
2. 结构化 AI emotion/actionIntent 真正驱动表情和动作；
3. 正式美术替换程序绘制部件；
4. 若 Live2D 许可与资产均满足，再新增 Live2D `PetRenderer`；
5. 角色资源包、图鉴或多角色系统最后考虑。

首版 SVG 星屿不是临时空占位，而是可以真实交付和验证单人桌宠价值的完整角色；未来美术升级只替换渲染实现，不推翻产品交互和状态架构。
