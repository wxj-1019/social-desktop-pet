/**
 * PetRuntimeController —— Main 进程唯一的桌宠运行时（设计稿 7.1 / 7.2 / 7.3）。
 *
 * 职责：
 * - 持有唯一的 PetStateMachine（确定性状态机 + 动作审批）
 * - 生命周期：start() STARTING → IDLE + 伸懒腰开场动画 + 5s 空闲降级 tick
 * - 模式优先级：HIDDEN > QUIET > OFFLINE > activity（reconcileMode）
 * - 交互 / 聊天 / 动作请求 → 视觉指令（emitVisual）与运行时快照（emitSnapshot）广播
 *
 * 纯逻辑（可单测）：不依赖 Electron window / IPC（Task 7/10 接入），
 * 不 import renderer src/**；时钟与定时器全部注入。
 */
import {
  actionIntentToMotion,
  emotionToExpression,
  normalizeIntensity,
  PetStateMachine,
  shouldInterrupt,
  stateToMotion,
} from '@pet/pet-state';
import type {
  ActionIntent,
  PetActionDecision,
  PetActionRequest,
  PetChatEvent,
  PetFacing,
  PetInteraction,
  PetMotion,
  PetRuntimeSnapshot,
  PetSocialEvent,
  PetState,
  PetVisualCommand,
} from '@pet/protocol';

/** 空闲降级 tick 周期（7.2） */
const TICK_MS = 5_000;
/** 启动伸懒腰动画结束后回到 idle 的延时 */
const BOOT_STRETCH_MS = 1_200;

/** 溜达调度（7.2 idle 随机溜达）：开始延迟 30-90s、持续 3-5s */
const WANDER_MIN_DELAY_MS = 30_000;
const WANDER_MAX_DELAY_MS = 90_000;
const WANDER_DURATION_MIN_MS = 3_000;
const WANDER_DURATION_MAX_MS = 5_000;
/** 活动窗口：距最近一次用户/系统活动超过该时长后停止溜达，让空闲降级（SITTING）可达 */
const WANDER_STOP_IDLE_MS = 150_000;

/** 冷启动默认气泡文案（落岛开场：一次性，帮助用户定位桌宠） */
const STARTUP_BUBBLE_TEXT = '我在这儿。今天也一起待着吧。';

/** 瞬时动作播放时长；结束后按届时的状态回到基础动作。 */
const ACTION_DURATION_MS: Readonly<Record<ActionIntent, number>> = {
  idle: 0,
  wave: 1_600,
  nod: 900,
  shake_head: 1_100,
  touch: 1_300,
  sit: 3_000,
  sleep: 4_000,
  walk: 3_000,
  cheer: 1_200,
  comfort: 1_500,
};

/** 断线气泡冷却：60s 内反复断线不重复提示，避免网络抖动刷屏（P2 断线降级人格化） */
const OFFLINE_BUBBLE_COOLDOWN_MS = 60_000;

/** 好友上线欢迎气泡冷却：5min 内不重复（防开关机/重连刷屏） */
const PRESENCE_BUBBLE_COOLDOWN_MS = 5 * 60_000;

/** 点心名称映射（送礼气泡显示文案；未知 id 回退"点心"） */
export function snackLabel(snackId: string): string {
  switch (snackId) {
    case 'snack_cookie':
      return '小饼干';
    case 'snack_candy':
      return '糖果';
    case 'snack_tea':
      return '茶点';
    default:
      return '点心';
  }
}

/** 送礼气泡文案（无昵称回退"好友"） */
export function giftBubbleText(event: Pick<PetSocialEvent, 'snackId' | 'fromNickname'>): string {
  return `${event.fromNickname ?? '好友'} 送来了${snackLabel(event.snackId)}！`;
}

export interface PetRuntimeOptions {
  /** 运行时快照广播（渲染层展示状态） */
  emitSnapshot: (snapshot: PetRuntimeSnapshot) => void;
  /** 视觉指令广播（渲染层执行动作/表情/说话/气泡） */
  emitVisual: (command: PetVisualCommand) => void;
  /** 时钟注入（测试用） */
  now?: () => number;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
}

export class PetRuntimeController {
  readonly machine: PetStateMachine;

  private readonly options: PetRuntimeOptions;
  private readonly setIntervalFn: typeof globalThis.setInterval;
  private readonly clearIntervalFn: typeof globalThis.clearInterval;
  private readonly setTimeoutFn: typeof globalThis.setTimeout;
  private readonly clearTimeoutFn: typeof globalThis.clearTimeout;

  private interval: ReturnType<typeof globalThis.setInterval> | null = null;
  private bootTimeout: ReturnType<typeof globalThis.setTimeout> | null = null;
  private wanderTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private wanderEndTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private actionResetTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private activeTransientMotion: PetMotion | null = null;
  private manualDragging = false;
  private manualDragFacing: PetFacing | null = null;
  private online = true;
  private dnd = false;
  private hidden = false;
  private passThrough = false;
  private started = false;
  private stopped = false;
  /** 冷启动默认气泡只发一次（落岛开场）；勿扰/隐藏时不发 */
  private startupBubbleSent = false;
  /** 最近一次用户/系统活动时刻（活动窗口起点；溜达仅在窗口内挂起） */
  private lastActivityAt = 0;
  /** 上次断线气泡时刻（60s 冷却，防抖动刷屏） */
  private lastOfflineBubbleAt = 0;
  /** 上次好友上线欢迎气泡时刻（5min 冷却，防开关机刷屏） */
  private lastPresenceBubbleAt = 0;

  constructor(options: PetRuntimeOptions) {
    this.options = options;
    this.setIntervalFn = options.setInterval ?? globalThis.setInterval;
    this.clearIntervalFn = options.clearInterval ?? globalThis.clearInterval;
    this.setTimeoutFn = options.setTimeout ?? globalThis.setTimeout;
    this.clearTimeoutFn = options.clearTimeout ?? globalThis.clearTimeout;
    this.machine = new PetStateMachine({ now: options.now });
  }

  /** 启动：进入 flags 推导的初始模式，广播快照 + 伸懒腰动画，挂起 boot/tick 定时器 */
  start(): void {
    if (this.stopped || this.started) return;
    this.started = true;
    this.lastActivityAt = this.nowMs();
    this.enterModeState('boot');
    this.emitSnapshot();
    this.emitVisual({ type: 'motion', motion: 'happy', intensity: 1 }); // 伸懒腰开场（7.2）
    // 落岛开场默认气泡：每次冷启动一次（非勿扰/非隐藏时），帮用户定位桌宠
    if (!this.startupBubbleSent && this.isBubbleAllowed()) {
      this.startupBubbleSent = true;
      this.emitVisual({ type: 'bubble', text: STARTUP_BUBBLE_TEXT });
    }
    this.armBootTimeout();
    this.ensureTickTimer();
  }

  /** 停止：清空所有定时器，之后任何方法不再广播 */
  stop(): void {
    this.stopped = true;
    this.stopTimers();
  }

  get snapshot(): PetRuntimeSnapshot {
    return {
      state: this.machine.current,
      online: this.online,
      dnd: this.dnd,
      hidden: this.hidden,
      passThrough: this.passThrough,
    };
  }

  /** 穿透状态同步（窗口/托盘操作在 Main 端收敛后调用；仅记状态+广播，不动模式机） */
  syncPassThrough(enabled: boolean): void {
    if (this.passThrough === enabled) return;
    this.passThrough = enabled;
    if (this.stopped) return;
    this.emitSnapshot();
  }

  setOnline(online: boolean): void {
    if (this.online === online) return;
    this.online = online;
    if (this.stopped) return;
    // 断线降级人格化（P2）：一次性气泡"网络不在，我先陪你"；60s 冷却防抖动刷屏。
    // 恢复在线不播音，静默回到正常状态即可。
    if (!online && this.nowMs() - this.lastOfflineBubbleAt > OFFLINE_BUBBLE_COOLDOWN_MS) {
      this.lastOfflineBubbleAt = this.nowMs();
      this.emitVisual({ type: 'bubble', text: '网络不在，我先陪你～' });
    }
    this.reconcileMode(true);
  }

  setDnd(enabled: boolean): void {
    if (this.dnd === enabled) return;
    this.dnd = enabled;
    if (this.stopped) return;
    // 勿扰状态给用户即时反馈：一次性气泡提示（之后气泡被 isBubbleAllowed 抑制）
    if (enabled) {
      this.emitVisual({ type: 'bubble', text: '勿扰模式已开启，我先安静一会儿' });
    } else {
      this.emitVisual({ type: 'bubble', text: '我回来啦～' });
    }
    this.reconcileMode(true);
  }

  setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    if (this.stopped) return;
    this.reconcileMode(true);
  }

  /** 互动动作（摸头/聊天输出等）→ 完整生命周期（playAction：时长后回常态）；冷却期给低成本表情反馈 */
  handleInteraction(interaction: PetInteraction): void {
    if (this.stopped) return;
    this.lastActivityAt = this.nowMs();
    let intent: ActionIntent;
    switch (interaction.kind) {
      case 'head_touch':
        intent = 'touch';
        break;
      case 'body_touch':
        // 身体点击：给一个小开心跳（此前 intent='idle' 完全无反应）
        intent = 'cheer';
        break;
      case 'tail_touch':
        intent = 'shake_head';
        break;
      default:
        // double_click / context_menu：纯 UI 层事件，无视觉动作
        return;
    }
    const decision = this.requestAction({ intent, source: 'local_interaction' });
    if (!decision.approved && decision.reason === 'cooldown') {
      // 冷却期兜底：重复摸头不再完全忽略，给一个低成本反馈（眨眼/表情）
      this.emitVisual({ type: 'expression', expression: 'warm' });
    }
  }

  handleChat(event: PetChatEvent): void {
    if (this.stopped) return;
    this.lastActivityAt = this.nowMs();
    switch (event.phase) {
      case 'start':
        this.handleChatStart(event);
        return;
      case 'update':
        this.handleChatUpdate(event);
        return;
      case 'done':
        this.handleChatDone(event);
        return;
      case 'error':
        this.handleChatError(event);
        return;
    }
  }

  /**
   * 社交事件（好友送礼/拜访/上线）：
   * - gift.snack_sent：开心表情 + cheer（冷却时 wave 补偿）+ 送礼气泡
   * - visit.arrived：开心表情 + wave 欢迎 + "来看你啦"气泡（拜访受每日限额，无需冷却）
   * - friend.online：开心表情 + wave 欢迎 + "上线啦"气泡（5min 冷却防开关机刷屏）
   * 勿扰/隐藏（QUIET/HIDDEN）整体忽略——勿扰时不应弹社交气泡。
   */
  handleSocialEvent(event: PetSocialEvent): void {
    if (this.stopped) return;
    this.lastActivityAt = this.nowMs();
    if (this.machine.current === 'QUIET' || this.machine.current === 'HIDDEN') return;

    switch (event.type) {
      case 'gift.snack_sent': {
        // 表情是情绪，不经动作审批（9.4 收到礼物的第一反应）
        this.emitVisual({ type: 'expression', expression: 'happy' });

        const decision = this.machine.requestAction({ intent: 'cheer', source: 'system' });
        if (decision.approved) {
          this.playAction('cheer', 1);
        } else if (decision.reason === 'cooldown') {
          // 冷却补偿：cheer 被冷却挡住时尝试 wave（节奏内仍有庆祝动作）
          const fallback = this.machine.requestAction({ intent: 'wave', source: 'system' });
          if (fallback.approved) {
            this.playAction('wave', 1);
          }
        }
        // 其余拒绝（dnd/not_allowed/offline）：仅气泡，不动作

        if (this.isBubbleAllowed()) {
          this.emitVisual({ type: 'bubble', text: giftBubbleText(event) });
        }
        return;
      }
      case 'visit.arrived': {
        // 好友来串门：wave 欢迎（经动作审批；冷却中仅表情与气泡）
        this.emitVisual({ type: 'expression', expression: 'happy' });
        const decision = this.machine.requestAction({ intent: 'wave', source: 'system' });
        if (decision.approved) {
          this.playAction('wave', 1);
        }
        if (this.isBubbleAllowed()) {
          this.emitVisual({ type: 'bubble', text: `${event.fromNickname ?? '好友'} 来看你啦` });
        }
        return;
      }
      case 'friend.online': {
        // 好友上线：wave 欢迎 + 气泡（5min 冷却防开关机刷屏）
        this.emitVisual({ type: 'expression', expression: 'happy' });
        const decision = this.machine.requestAction({ intent: 'wave', source: 'system' });
        if (decision.approved) {
          this.playAction('wave', 1);
        }
        if (
          this.isBubbleAllowed() &&
          this.nowMs() - this.lastPresenceBubbleAt > PRESENCE_BUBBLE_COOLDOWN_MS
        ) {
          this.lastPresenceBubbleAt = this.nowMs();
          this.emitVisual({ type: 'bubble', text: `${event.friendNickname ?? '好友'} 上线啦` });
        }
        return;
      }
    }
  }

  requestAction(request: PetActionRequest): PetActionDecision {
    const decision = this.machine.requestAction(request);
    if (!this.stopped && decision.approved) {
      this.playAction(request.intent, normalizeIntensity(1));
    }
    return decision;
  }

  /** 立即尝试开始一次溜达；供受控触发与 E2E 验证复用正常状态/动作审批路径。 */
  tryStartWander(): boolean {
    if (this.stopped) return false;
    if (this.wanderTimer !== null) {
      this.clearTimeoutFn(this.wanderTimer);
      this.wanderTimer = null;
    }
    return this.startWander();
  }

  /** 用户拖动等高优先级交互会结束当前溜达，并恢复 IDLE 基础动作。 */
  cancelWander(): boolean {
    if (this.stopped || this.machine.current !== 'WALKING') return false;
    if (this.wanderEndTimer !== null) {
      this.clearTimeoutFn(this.wanderEndTimer);
      this.wanderEndTimer = null;
    }
    this.lastActivityAt = this.nowMs();
    this.machine.transition('IDLE', 'wander_cancelled');
    this.emitSnapshot();
    this.emitStateMotion();
    this.armWanderTimer();
    return true;
  }

  /** 手动拖拽开始：取得视觉动作所有权，并沿用正常 walk 动画。 */
  beginManualDrag(): void {
    if (this.stopped || this.manualDragging) return;
    this.manualDragging = true;
    this.manualDragFacing = null;
    this.lastActivityAt = this.nowMs();
    this.cancelWander();
    this.emitPersistentMotion('walk', 1);
  }

  /** 按实际窗口横向位移更新朝向；同方向连续事件不重复广播。 */
  updateManualDrag(deltaX: number): void {
    if (this.stopped || !this.manualDragging || !Number.isFinite(deltaX) || deltaX === 0) return;
    const facing: PetFacing = deltaX < 0 ? 'left' : 'right';
    if (facing === this.manualDragFacing) return;
    this.manualDragFacing = facing;
    this.emitVisual({ type: 'facing', facing });
  }

  /** 手动拖拽结束/取消：释放视觉所有权，恢复当前状态的基础动作。 */
  endManualDrag(): void {
    if (this.stopped || !this.manualDragging) return;
    this.manualDragging = false;
    this.manualDragFacing = null;
    this.emitStateMotion();
    this.armWanderTimer();
  }

  private handleChatStart(_event: Extract<PetChatEvent, { phase: 'start' }>): void {
    // 勿扰 / 隐藏：忽略聊天（7.3 不弹气泡 / 不播音 / 不动作）
    if (this.machine.current === 'QUIET' || this.machine.current === 'HIDDEN') return;
    // OFFLINE：本地动画继续，保持 OFFLINE 状态（7.1）
    if (this.machine.current === 'OFFLINE') {
      this.emitVisual({ type: 'speaking', active: true });
      this.emitPersistentMotion('talk', 1);
      return;
    }

    const before = this.machine.current;
    if (this.machine.current !== 'IDLE' && this.machine.current !== 'CHATTING') {
      this.machine.transition('IDLE', 'chat_interrupt');
    }
    if (this.machine.current === 'IDLE') {
      this.machine.transition('CHATTING', 'chat_start');
    }
    if (this.machine.current !== before) {
      this.emitSnapshot();
    }
    this.emitVisual({ type: 'speaking', active: true });
    this.emitPersistentMotion('talk', 1);
  }

  private handleChatUpdate(event: Extract<PetChatEvent, { phase: 'update' }>): void {
    if (!this.isBubbleAllowed()) return;
    this.emitVisual({ type: 'bubble', text: event.text.slice(-160) });
  }

  private handleChatDone(event: Extract<PetChatEvent, { phase: 'done' }>): void {
    const { output } = event;
    this.emitVisual({ type: 'speaking', active: false });
    this.emitVisual({ type: 'expression', expression: emotionToExpression(output.emotion) });
    // 正常聊天结束先回到 IDLE，再按活动态白名单审批最终动作；否则 cheer/walk/sit
    // 会被 CHATTING 白名单误拒绝，模型虽输出动作但视觉层永远收不到。
    if (this.machine.current === 'CHATTING') {
      this.machine.transition('IDLE', 'chat_done');
      this.emitSnapshot();
    }
    const decision = this.machine.requestAction({
      intent: output.actionIntent,
      source: event.source,
    });
    let playedAction = false;
    if (decision.approved) {
      playedAction = this.playAction(output.actionIntent, normalizeIntensity(output.intensity));
    }
    if (this.isBubbleAllowed()) {
      this.emitVisual({ type: 'bubble', text: output.dialogue.slice(-160) });
    }
    if (!playedAction) this.emitStateMotion();
    this.armWanderTimer();
  }

  private handleChatError(event: Extract<PetChatEvent, { phase: 'error' }>): void {
    this.emitVisual({ type: 'speaking', active: false });
    if (this.isBubbleAllowed()) {
      this.emitVisual({ type: 'bubble', text: event.message.slice(-120) });
    }
    if (this.machine.transition('IDLE', 'chat_error')) {
      this.emitSnapshot();
    }
    this.emitStateMotion();
    this.armWanderTimer();
  }

  /** 气泡仅在非勿扰 / 非隐藏时允许（7.3） */
  private isBubbleAllowed(): boolean {
    return !this.hidden && !this.dnd;
  }

  /** 公开入口：给桌宠发一条提示气泡（用于勿扰/穿透等状态切换的用户反馈） */
  showBubble(text: string): void {
    this.emitVisual({ type: 'bubble', text });
  }

  private emitSnapshot(): void {
    this.options.emitSnapshot(this.snapshot);
  }

  private emitVisual(command: PetVisualCommand): void {
    this.options.emitVisual(command);
  }

  /** 状态基础动作：强制结束瞬时动作，并同步到当前状态。 */
  private emitStateMotion(): void {
    this.clearBootTimeout();
    this.clearActionResetTimer();
    this.activeTransientMotion = null;
    this.emitVisual({
      type: 'motion',
      motion: stateToMotion(this.machine.current),
      intensity: 1,
    });
  }

  /** 持续到显式状态变化的动作（聊天说话态等）。 */
  private emitPersistentMotion(motion: PetMotion, intensity: 1 | 2 | 3): void {
    this.clearBootTimeout();
    this.clearActionResetTimer();
    this.activeTransientMotion = null;
    this.emitVisual({ type: 'motion', motion, intensity });
  }

  /** 播放一次动作；高优先级瞬时动作不会被仍在播放的低优先级请求覆盖。 */
  private playAction(intent: ActionIntent, intensity: 1 | 2 | 3): boolean {
    const duration = ACTION_DURATION_MS[intent];
    if (duration === 0) {
      this.emitStateMotion();
      return true;
    }
    const motion = actionIntentToMotion(intent);
    if (this.activeTransientMotion && shouldInterrupt(motion, this.activeTransientMotion)) {
      return false;
    }

    this.clearBootTimeout();
    this.clearActionResetTimer();
    this.activeTransientMotion = motion;
    this.emitVisual({ type: 'motion', motion, intensity });
    this.actionResetTimer = this.setTimeoutFn(() => {
      this.actionResetTimer = null;
      this.activeTransientMotion = null;
      if (this.stopped) return;
      this.emitVisual({
        type: 'motion',
        motion: stateToMotion(this.machine.current),
        intensity: 1,
      });
    }, duration);
    return true;
  }

  private clearActionResetTimer(): void {
    if (this.actionResetTimer === null) return;
    this.clearTimeoutFn(this.actionResetTimer);
    this.actionResetTimer = null;
  }

  private clearBootTimeout(): void {
    if (this.bootTimeout === null) return;
    this.clearTimeoutFn(this.bootTimeout);
    this.bootTimeout = null;
  }

  /** 模式优先级：HIDDEN > QUIET > OFFLINE > activity */
  private deriveTargetState(): PetState {
    if (this.hidden) return 'HIDDEN';
    if (this.dnd) return 'QUIET';
    if (!this.online) return 'OFFLINE';
    return 'IDLE';
  }

  /** 按 flags 推导目标状态并尝试进入；直接转换失败先过渡 IDLE 再进入目标。返回 state 是否变化 */
  private enterModeState(reason: string): boolean {
    const target = this.deriveTargetState();
    const before = this.machine.current;
    if (target !== before && !this.machine.transition(target, reason)) {
      if (this.machine.transition('IDLE', `${reason}_via_idle`)) {
        this.machine.transition(target, reason);
      }
    }
    return this.machine.current !== before;
  }

  /** 模式调和：每次状态变化广播快照 + stateToMotion；恢复后重开恰一个 tick 定时器 */
  private reconcileMode(flagChanged = false): void {
    if (this.stopped) return;
    const stateChanged = this.enterModeState('mode_reconcile');
    if (stateChanged) {
      this.emitSnapshot();
      this.emitStateMotion();
    } else if (flagChanged) {
      // 状态未变（如 hidden 中改 online/dnd）只更新 flags 快照
      this.emitSnapshot();
    }
    this.ensureTickTimer();
  }

  /** 5s 空闲降级 tick：状态变化才广播快照 + stateToMotion */
  private onTick(): void {
    if (this.stopped) return;
    const before = this.machine.current;
    this.machine.tick();
    if (this.machine.current !== before) {
      this.emitSnapshot();
      this.emitStateMotion();
    }
  }

  /** 仅可见（非 HIDDEN）时维持恰一个 tick 定时器；hidden 时清空所有定时器 */
  private ensureTickTimer(): void {
    if (this.stopped) return;
    if (this.hidden) {
      this.stopTimers();
      return;
    }
    if (this.interval === null) {
      this.interval = this.setIntervalFn(() => this.onTick(), TICK_MS);
    }
    this.armWanderTimer();
  }

  /** 当前时间（与 state machine 同一时钟源：options.now 注入或 Date.now） */
  private nowMs(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** 挂起溜达开始定时器（30-90s 随机；已挂起/隐藏时不重复挂） */
  private armWanderTimer(): void {
    if (this.stopped || this.hidden || this.manualDragging || this.wanderTimer !== null) return;
    if (this.nowMs() - this.lastActivityAt > WANDER_STOP_IDLE_MS) return; // 久置无活动：停止溜达，让空闲降级可达
    const delay =
      WANDER_MIN_DELAY_MS + Math.floor(Math.random() * (WANDER_MAX_DELAY_MS - WANDER_MIN_DELAY_MS));
    this.wanderTimer = this.setTimeoutFn(() => {
      this.wanderTimer = null;
      this.startWander();
    }, delay);
  }

  /** 溜达开始：仅 IDLE 时进入 WALKING（QUIET/SLEEPING/OFFLINE 等重新挂起）；walk 经动作审批 */
  private startWander(): boolean {
    if (this.stopped) return false;
    if (this.machine.current !== 'IDLE') {
      this.armWanderTimer();
      return false;
    }
    this.machine.transition('WALKING', 'wander_start');
    const decision = this.machine.requestAction({ intent: 'walk', source: 'system' });
    if (!decision.approved) {
      // walk 冷却中（聊天输出可能刚用过 walk）：本轮跳过，重新挂起下一轮
      this.machine.transition('IDLE', 'wander_abort');
      this.armWanderTimer();
      return false;
    }
    this.emitStateMotion();
    this.emitSnapshot();
    this.wanderEndTimer = this.setTimeoutFn(
      () => {
        this.wanderEndTimer = null;
        this.endWander();
      },
      WANDER_DURATION_MIN_MS +
        Math.floor(Math.random() * (WANDER_DURATION_MAX_MS - WANDER_DURATION_MIN_MS)),
    );
    return true;
  }

  /** 溜达结束：仍在 WALKING 才回 IDLE；随后重新挂起下一轮 */
  private endWander(): void {
    if (this.stopped) return;
    if (this.machine.current === 'WALKING') {
      this.machine.transition('IDLE', 'wander_done');
      this.emitSnapshot();
      this.emitStateMotion();
    }
    this.armWanderTimer();
  }

  /** 启动伸懒腰 1.2s 后回到 idle 动作（一次性） */
  private armBootTimeout(): void {
    if (this.stopped || this.hidden) return;
    if (this.bootTimeout !== null) {
      this.clearTimeoutFn(this.bootTimeout);
      this.bootTimeout = null;
    }
    this.bootTimeout = this.setTimeoutFn(() => {
      this.bootTimeout = null;
      if (this.stopped) return;
      this.emitStateMotion();
    }, BOOT_STRETCH_MS);
  }

  private stopTimers(): void {
    if (this.interval !== null) {
      this.clearIntervalFn(this.interval);
      this.interval = null;
    }
    if (this.bootTimeout !== null) {
      this.clearTimeoutFn(this.bootTimeout);
      this.bootTimeout = null;
    }
    this.clearActionResetTimer();
    this.activeTransientMotion = null;
    this.manualDragging = false;
    this.manualDragFacing = null;
    if (this.wanderTimer !== null) {
      this.clearTimeoutFn(this.wanderTimer);
      this.wanderTimer = null;
    }
    if (this.wanderEndTimer !== null) {
      this.clearTimeoutFn(this.wanderEndTimer);
      this.wanderEndTimer = null;
    }
  }
}
