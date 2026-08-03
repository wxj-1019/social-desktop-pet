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
  stateToMotion,
} from '@pet/pet-state';
import type {
  ActionIntent,
  PetActionDecision,
  PetActionRequest,
  PetChatEvent,
  PetInteraction,
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
  private online = true;
  private dnd = false;
  private hidden = false;
  private started = false;
  private stopped = false;
  /** 最近一次用户/系统活动时刻（活动窗口起点；溜达仅在窗口内挂起） */
  private lastActivityAt = 0;

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
    };
  }

  setOnline(online: boolean): void {
    if (this.online === online) return;
    this.online = online;
    if (this.stopped) return;
    this.reconcileMode(true);
  }

  setDnd(enabled: boolean): void {
    if (this.dnd === enabled) return;
    this.dnd = enabled;
    if (this.stopped) return;
    this.reconcileMode(true);
  }

  setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return;
    this.hidden = hidden;
    if (this.stopped) return;
    this.reconcileMode(true);
  }

  handleInteraction(interaction: PetInteraction): void {
    if (this.stopped) return;
    this.lastActivityAt = this.nowMs();
    let intent: ActionIntent;
    switch (interaction.kind) {
      case 'head_touch':
        intent = 'touch';
        break;
      case 'body_touch':
        intent = 'idle';
        break;
      case 'tail_touch':
        intent = 'shake_head';
        break;
      default:
        // double_click / context_menu：纯 UI 层事件，无视觉动作
        return;
    }
    const decision = this.machine.requestAction({ intent, source: 'local_interaction' });
    if (decision.approved) {
      this.emitVisual({
        type: 'motion',
        motion: actionIntentToMotion(intent),
        intensity: 1,
      });
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
   * 社交事件（好友送礼）：开心表情（情绪不经动作审批）+ cheer 动作（冷却时 wave 补偿）+ 送礼气泡。
   * 勿扰/隐藏（QUIET/HIDDEN）整体忽略——勿扰时不应弹送礼气泡。
   */
  handleSocialEvent(event: PetSocialEvent): void {
    if (this.stopped) return;
    this.lastActivityAt = this.nowMs();
    if (this.machine.current === 'QUIET' || this.machine.current === 'HIDDEN') return;

    // 表情是情绪，不经动作审批（9.4 收到礼物的第一反应）
    this.emitVisual({ type: 'expression', expression: 'happy' });

    const decision = this.machine.requestAction({ intent: 'cheer', source: 'system' });
    if (decision.approved) {
      this.emitVisual({ type: 'motion', motion: 'happy', intensity: 1 });
    } else if (decision.reason === 'cooldown') {
      // 冷却补偿：cheer 被冷却挡住时尝试 wave（节奏内仍有庆祝动作）
      const fallback = this.machine.requestAction({ intent: 'wave', source: 'system' });
      if (fallback.approved) {
        this.emitVisual({ type: 'motion', motion: 'wave', intensity: 1 });
      }
    }
    // 其余拒绝（dnd/not_allowed/offline）：仅气泡，不动作

    if (this.isBubbleAllowed()) {
      this.emitVisual({ type: 'bubble', text: giftBubbleText(event) });
    }
  }

  requestAction(request: PetActionRequest): PetActionDecision {
    const decision = this.machine.requestAction(request);
    if (!this.stopped && decision.approved) {
      this.emitVisual({
        type: 'motion',
        motion: actionIntentToMotion(request.intent),
        intensity: normalizeIntensity(1),
      });
    }
    return decision;
  }

  private handleChatStart(_event: Extract<PetChatEvent, { phase: 'start' }>): void {
    // 勿扰 / 隐藏：忽略聊天（7.3 不弹气泡 / 不播音 / 不动作）
    if (this.machine.current === 'QUIET' || this.machine.current === 'HIDDEN') return;
    this.emitVisual({ type: 'speaking', active: true });
    // OFFLINE：本地动画继续，保持 OFFLINE 状态（7.1）
    if (this.machine.current === 'OFFLINE') return;
    if (this.machine.current === 'IDLE') {
      this.machine.transition('CHATTING', 'chat_start');
      this.emitSnapshot();
    }
  }

  private handleChatUpdate(event: Extract<PetChatEvent, { phase: 'update' }>): void {
    if (!this.isBubbleAllowed()) return;
    this.emitVisual({ type: 'bubble', text: event.text.slice(-160) });
  }

  private handleChatDone(event: Extract<PetChatEvent, { phase: 'done' }>): void {
    const { output } = event;
    this.emitVisual({ type: 'speaking', active: false });
    this.emitVisual({ type: 'expression', expression: emotionToExpression(output.emotion) });
    const decision = this.machine.requestAction({
      intent: output.actionIntent,
      source: event.source,
    });
    if (decision.approved) {
      this.emitVisual({
        type: 'motion',
        motion: actionIntentToMotion(output.actionIntent),
        intensity: normalizeIntensity(output.intensity),
      });
    }
    if (this.isBubbleAllowed()) {
      this.emitVisual({ type: 'bubble', text: output.dialogue.slice(-160) });
    }
    // 回到活动态：仅在确实在 CHATTING 时回收（QUIET/HIDDEN/OFFLINE 由 reconcileMode 维护）
    if (this.machine.current === 'CHATTING') {
      this.machine.transition('IDLE', 'chat_done');
      this.emitSnapshot();
    }
  }

  private handleChatError(event: Extract<PetChatEvent, { phase: 'error' }>): void {
    this.emitVisual({ type: 'speaking', active: false });
    if (this.isBubbleAllowed()) {
      this.emitVisual({ type: 'bubble', text: event.message.slice(-120) });
    }
    if (this.machine.transition('IDLE', 'chat_error')) {
      this.emitSnapshot();
    }
  }

  /** 气泡仅在非勿扰 / 非隐藏时允许（7.3） */
  private isBubbleAllowed(): boolean {
    return !this.hidden && !this.dnd;
  }

  private emitSnapshot(): void {
    this.options.emitSnapshot(this.snapshot);
  }

  private emitVisual(command: PetVisualCommand): void {
    this.options.emitVisual(command);
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
      this.emitVisual({
        type: 'motion',
        motion: stateToMotion(this.machine.current),
        intensity: 1,
      });
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
      this.emitVisual({
        type: 'motion',
        motion: stateToMotion(this.machine.current),
        intensity: 1,
      });
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
    if (this.stopped || this.hidden || this.wanderTimer !== null) return;
    if (this.nowMs() - this.lastActivityAt > WANDER_STOP_IDLE_MS) return; // 久置无活动：停止溜达，让空闲降级可达
    const delay =
      WANDER_MIN_DELAY_MS + Math.floor(Math.random() * (WANDER_MAX_DELAY_MS - WANDER_MIN_DELAY_MS));
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
      // walk 冷却中（聊天输出可能刚用过 walk）等真实拒绝源：本轮跳过，不挂 end 定时器
      this.machine.transition('IDLE', 'wander_abort');
      return;
    }
    this.emitSnapshot();
    this.wanderEndTimer = this.setTimeoutFn(
      () => {
        this.wanderEndTimer = null;
        this.endWander();
      },
      WANDER_DURATION_MIN_MS +
        Math.floor(Math.random() * (WANDER_DURATION_MAX_MS - WANDER_DURATION_MIN_MS)),
    );
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
      this.emitVisual({ type: 'motion', motion: 'idle', intensity: 1 });
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
