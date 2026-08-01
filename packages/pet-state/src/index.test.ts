import { describe, expect, it } from 'vitest';

import { PetStateMachine, ACTION_WHITELIST } from './index.js';

/** 可控时钟 */
function makeClock(initial = 0) {
  let t = initial;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('PetStateMachine (7.1)', () => {
  it('starts in STARTING and can enter IDLE', () => {
    const sm = new PetStateMachine();
    expect(sm.current).toBe('STARTING');
    expect(sm.transition('IDLE')).toBe(true);
    expect(sm.current).toBe('IDLE');
  });

  it('rejects illegal transitions (7.1 状态图)', () => {
    const sm = new PetStateMachine();
    sm.transition('IDLE');
    // IDLE → CHATTING 合法
    expect(sm.transition('CHATTING')).toBe(true);
    // CHATTING → WALKING 非法（7.1 无此边）
    expect(sm.transition('WALKING')).toBe(false);
    expect(sm.current).toBe('CHATTING');
  });

  it('handles QUIET / HIDDEN / OFFLINE from any normal state', () => {
    const sm = new PetStateMachine();
    sm.transition('IDLE');
    expect(sm.transition('QUIET')).toBe(true); // 勿扰
    expect(sm.transition('IDLE')).toBe(true); // 恢复
    expect(sm.transition('HIDDEN')).toBe(true); // 托盘
    expect(sm.transition('IDLE')).toBe(true);
    expect(sm.markOffline()).toBe(true); // 云失败，本地动画继续
    expect(sm.current).toBe('OFFLINE');
    expect(sm.markOnline()).toBe(true);
    expect(sm.current).toBe('IDLE');
  });

  it('approves whitelisted action from IDLE', () => {
    const sm = new PetStateMachine();
    sm.transition('IDLE');
    expect(sm.requestAction({ intent: 'wave' }).approved).toBe(true);
  });

  it('rejects action in DND/QUIET (7.3 勿扰)', () => {
    const sm = new PetStateMachine();
    sm.transition('IDLE');
    sm.transition('QUIET');
    expect(sm.requestAction({ intent: 'wave' })).toMatchObject({
      approved: false,
      reason: 'dnd',
    });
  });

  it('rejects action not in whitelist (7.1 白名单)', () => {
    const sm = new PetStateMachine();
    sm.transition('IDLE');
    sm.transition('SLEEPING');
    // 睡觉时只能唤醒（idle），wave 不在白名单
    expect(sm.requestAction({ intent: 'wave' })).toMatchObject({
      approved: false,
      reason: 'not_allowed',
    });
    // 唤醒
    expect(sm.requestAction({ intent: 'idle' }).approved).toBe(true);
  });

  it('enforces per-action cooldown (防刷)', () => {
    const clock = makeClock();
    const sm = new PetStateMachine({ now: clock.now, actionCooldownMs: { wave: 10_000 } });
    sm.transition('IDLE');
    expect(sm.requestAction({ intent: 'wave' }).approved).toBe(true);
    // 冷却期内拒绝
    clock.advance(5_000);
    expect(sm.requestAction({ intent: 'wave' })).toMatchObject({
      approved: false,
      reason: 'cooldown',
    });
    // 冷却过后恢复
    clock.advance(6_000);
    expect(sm.requestAction({ intent: 'wave' }).approved).toBe(true);
  });

  it('degrades to SITTING then SLEEPING on idle timeout (7.2 长时间无操作)', () => {
    const clock = makeClock();
    const sm = new PetStateMachine({
      now: clock.now,
      idleToSitMs: 180_000,
      sitToSleepMs: 600_000,
    });
    sm.transition('IDLE');
    // 未到阈值
    clock.advance(179_000);
    sm.tick();
    expect(sm.current).toBe('IDLE');
    // 超过 → SITTING
    clock.advance(2_000);
    sm.tick();
    expect(sm.current).toBe('SITTING');
    // 坐着超过 → SLEEPING
    clock.advance(601_000);
    sm.tick();
    expect(sm.current).toBe('SLEEPING');
  });

  it('every state has a whitelist entry (不遗漏)', () => {
    const states = [
      'STARTING',
      'IDLE',
      'WALKING',
      'SITTING',
      'CHATTING',
      'HOSTING',
      'VISITING',
      'SLEEPING',
      'QUIET',
      'HIDDEN',
      'OFFLINE',
    ] as const;
    for (const s of states) {
      expect(ACTION_WHITELIST[s]).toBeDefined();
    }
  });
});
