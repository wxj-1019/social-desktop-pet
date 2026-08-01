/**
 * 桌宠确定性状态机 —— 对应设计稿 7.1。
 *
 * 状态图：
 *   STARTING → IDLE ↔ WALKING
 *                    ↔ SITTING
 *                    ↔ CHATTING
 *                    ↔ HOSTING
 *                    ↔ VISITING
 *                    ↔ SLEEPING
 *   任意正常状态 → QUIET / HIDDEN
 *   云服务失败 → OFFLINE（本地动画继续）
 *
 * 原则（7.1）：AI 只能提出 emotion 和 actionIntent；
 * 本地状态机根据当前状态、勿扰、冷却时间和动作白名单决定是否执行。
 * 确定性状态机拥有最终执行权（0.2-6）。
 */
import type { ActionIntent, PetState } from '@pet/protocol';

export { PetStateSchema } from '@pet/protocol';
export type { PetState, ActionIntent } from '@pet/protocol';

/** 每个动作的默认冷却（毫秒）—— 防刷与节奏控制 */
export const DEFAULT_ACTION_COOLDOWN_MS: Record<ActionIntent, number> = {
  idle: 0,
  wave: 10_000,
  nod: 5_000,
  shake_head: 8_000,
  touch: 15_000,
  sit: 20_000,
  sleep: 30_000,
  walk: 15_000,
  cheer: 10_000,
  comfort: 10_000,
};

/**
 * 动作白名单：当前状态下允许执行的动作。
 * 勿扰（QUIET/HIDDEN/OFFLINE）下拒绝一切动画动作（7.3：不弹气泡、不播放声音、降低帧率）。
 */
export const ACTION_WHITELIST: Record<PetState, ReadonlySet<ActionIntent>> = {
  STARTING: new Set(['idle']),
  IDLE: new Set([
    'idle',
    'wave',
    'nod',
    'shake_head',
    'touch',
    'sit',
    'sleep',
    'walk',
    'cheer',
    'comfort',
  ]),
  WALKING: new Set(['idle', 'walk']),
  SITTING: new Set(['idle', 'sit', 'wave', 'nod', 'comfort']),
  CHATTING: new Set(['idle', 'nod', 'shake_head', 'comfort', 'wave']),
  HOSTING: new Set(['idle', 'wave', 'nod', 'cheer']),
  VISITING: new Set(['idle', 'wave', 'nod']),
  SLEEPING: new Set(['idle']), // 唤醒动作
  QUIET: new Set([]),
  HIDDEN: new Set([]),
  OFFLINE: new Set([]),
};

/** 合法状态转换（7.1 状态图） */
const TRANSITIONS: ReadonlyMap<PetState, ReadonlySet<PetState>> = new Map<
  PetState,
  ReadonlySet<PetState>
>([
  ['STARTING', new Set<PetState>(['IDLE', 'OFFLINE'])],
  [
    'IDLE',
    new Set<PetState>([
      'WALKING',
      'SITTING',
      'CHATTING',
      'HOSTING',
      'VISITING',
      'SLEEPING',
      'QUIET',
      'HIDDEN',
      'OFFLINE',
    ]),
  ],
  ['WALKING', new Set<PetState>(['IDLE', 'SITTING', 'QUIET', 'HIDDEN', 'OFFLINE'])],
  ['SITTING', new Set<PetState>(['IDLE', 'SLEEPING', 'QUIET', 'HIDDEN', 'OFFLINE'])],
  ['CHATTING', new Set<PetState>(['IDLE', 'QUIET', 'HIDDEN', 'OFFLINE'])],
  ['HOSTING', new Set<PetState>(['IDLE', 'QUIET', 'HIDDEN', 'OFFLINE'])],
  ['VISITING', new Set<PetState>(['IDLE', 'QUIET', 'HIDDEN', 'OFFLINE'])],
  ['SLEEPING', new Set<PetState>(['IDLE', 'QUIET', 'HIDDEN', 'OFFLINE'])],
  ['QUIET', new Set<PetState>(['IDLE', 'SITTING', 'SLEEPING', 'HIDDEN', 'OFFLINE'])],
  ['HIDDEN', new Set<PetState>(['IDLE', 'OFFLINE'])],
  ['OFFLINE', new Set<PetState>(['IDLE'])],
]);

export interface PetStateMachineOptions {
  /** 空闲多久（ms）被动进入 SITTING，默认 3 分钟 */
  idleToSitMs?: number;
  /** 坐着多久（ms）被动进入 SLEEPING，默认 10 分钟 */
  sitToSleepMs?: number;
  /** 动作冷却表覆盖 */
  actionCooldownMs?: Partial<Record<ActionIntent, number>>;
  /** 时钟注入（测试用） */
  now?: () => number;
}

export interface ActionRequest {
  intent: ActionIntent;
  /** 动作触发原因（调试/审计） */
  reason?: string;
}

export interface ActionDecision {
  approved: boolean;
  intent: ActionIntent;
  /** 拒绝原因（供日志与降级） */
  reason?: 'dnd' | 'cooldown' | 'not_allowed' | 'offline';
}

export class PetStateMachine {
  private state: PetState = 'STARTING';
  private stateEnteredAt: number;
  private lastActionAt = new Map<ActionIntent, number>();
  private readonly idleToSitMs: number;
  private readonly sitToSleepMs: number;
  private readonly cooldown: Record<ActionIntent, number>;
  private readonly now: () => number;

  constructor(options: PetStateMachineOptions = {}) {
    this.idleToSitMs = options.idleToSitMs ?? 180_000;
    this.sitToSleepMs = options.sitToSleepMs ?? 600_000;
    this.cooldown = { ...DEFAULT_ACTION_COOLDOWN_MS, ...options.actionCooldownMs };
    this.now = options.now ?? (() => Date.now());
    this.stateEnteredAt = this.now();
  }

  get current(): PetState {
    return this.state;
  }

  /** 尝试转换；非法转换返回 false（日志记录，不抛错） */
  transition(to: PetState, reason?: string): boolean {
    void reason;
    const allowed = TRANSITIONS.get(this.state);
    if (!allowed?.has(to)) return false;
    this.state = to;
    this.stateEnteredAt = this.now();
    return true;
  }

  /** 云服务失败 → OFFLINE（本地动画继续，7.1） */
  markOffline(): boolean {
    return this.transition('OFFLINE', 'cloud_down');
  }

  /** 恢复在线（OFFLINE → IDLE） */
  markOnline(): boolean {
    return this.transition('IDLE', 'cloud_back');
  }

  /** 7.1 动作审批：AI 提出 actionIntent，状态机决定是否执行 */
  requestAction(req: ActionRequest): ActionDecision {
    // 1. 勿扰 / 隐藏 / 离线：拒绝一切动画动作（7.3）
    if (this.state === 'QUIET' || this.state === 'HIDDEN' || this.state === 'OFFLINE') {
      return { approved: false, intent: req.intent, reason: 'dnd' };
    }
    // 2. 白名单
    if (!ACTION_WHITELIST[this.state].has(req.intent)) {
      return { approved: false, intent: req.intent, reason: 'not_allowed' };
    }
    // 3. 冷却
    const cooldown = this.cooldown[req.intent];
    if (cooldown > 0) {
      const last = this.lastActionAt.get(req.intent);
      if (last !== undefined && this.now() - last < cooldown) {
        return { approved: false, intent: req.intent, reason: 'cooldown' };
      }
    }
    this.lastActionAt.set(req.intent, this.now());
    return { approved: true, intent: req.intent };
  }

  /**
   * 空闲降级（驱动层定时调用）：
   * 长时间无操作 → SITTING；坐着过久 → SLEEPING（7.2 最后一条）。
   */
  tick(): void {
    if (this.state === 'IDLE' && this.now() - this.stateEnteredAt >= this.idleToSitMs) {
      this.transition('SITTING', 'idle_timeout');
    } else if (this.state === 'SITTING' && this.now() - this.stateEnteredAt >= this.sitToSleepMs) {
      this.transition('SLEEPING', 'sit_timeout');
    }
  }
}
