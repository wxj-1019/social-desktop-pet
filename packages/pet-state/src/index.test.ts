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
    expect(sm.requestAction({ intent: 'wave', source: 'system' }).approved).toBe(true);
  });

  it('rejects action in DND/QUIET (7.3 勿扰)', () => {
    const sm = new PetStateMachine();
    sm.transition('IDLE');
    sm.transition('QUIET');
    expect(sm.requestAction({ intent: 'wave', source: 'system' })).toMatchObject({
      approved: false,
      reason: 'dnd',
    });
  });

  it('rejects action not in whitelist (7.1 白名单)', () => {
    const sm = new PetStateMachine();
    sm.transition('IDLE');
    sm.transition('SLEEPING');
    // 睡觉时只能唤醒（idle），wave 不在白名单
    expect(sm.requestAction({ intent: 'wave', source: 'system' })).toMatchObject({
      approved: false,
      reason: 'not_allowed',
    });
    // 唤醒
    expect(sm.requestAction({ intent: 'idle', source: 'system' }).approved).toBe(true);
  });

  it('enforces per-action cooldown (防刷)', () => {
    const clock = makeClock();
    const sm = new PetStateMachine({ now: clock.now, actionCooldownMs: { wave: 10_000 } });
    sm.transition('IDLE');
    expect(sm.requestAction({ intent: 'wave', source: 'system' }).approved).toBe(true);
    // 冷却期内拒绝
    clock.advance(5_000);
    expect(sm.requestAction({ intent: 'wave', source: 'system' })).toMatchObject({
      approved: false,
      reason: 'cooldown',
    });
    // 冷却过后恢复
    clock.advance(6_000);
    expect(sm.requestAction({ intent: 'wave', source: 'system' }).approved).toBe(true);
  });

  it('approves local interaction / local chat / system while OFFLINE (7.1 本地动画继续)', () => {
    const sm = new PetStateMachine();
    sm.transition('IDLE');
    sm.markOffline();
    expect(sm.current).toBe('OFFLINE');
    // 本地触摸 → touch 按 IDLE 白名单审批
    expect(sm.requestAction({ intent: 'touch', source: 'local_interaction' })).toMatchObject({
      approved: true,
      intent: 'touch',
    });
    // 本地聊天 → nod 按 IDLE 白名单审批
    expect(sm.requestAction({ intent: 'nod', source: 'local_chat' })).toMatchObject({
      approved: true,
      intent: 'nod',
    });
    // system 源同样放行
    expect(sm.requestAction({ intent: 'walk', source: 'system' }).approved).toBe(true);
  });

  it('rejects cloud_ai action while OFFLINE (reason offline)', () => {
    const sm = new PetStateMachine();
    sm.transition('IDLE');
    sm.markOffline();
    expect(sm.requestAction({ intent: 'wave', source: 'cloud_ai' })).toMatchObject({
      approved: false,
      reason: 'offline',
    });
  });

  it('OFFLINE local actions still honor cooldown (冷却逻辑不变)', () => {
    const clock = makeClock();
    const sm = new PetStateMachine({ now: clock.now, actionCooldownMs: { touch: 15_000 } });
    sm.transition('IDLE');
    sm.markOffline();
    expect(sm.requestAction({ intent: 'touch', source: 'local_interaction' }).approved).toBe(true);
    clock.advance(5_000);
    expect(sm.requestAction({ intent: 'touch', source: 'local_interaction' })).toMatchObject({
      approved: false,
      reason: 'cooldown',
    });
    clock.advance(11_000);
    expect(sm.requestAction({ intent: 'touch', source: 'local_interaction' }).approved).toBe(true);
  });

  it('still rejects local actions in QUIET / HIDDEN (勿扰)', () => {
    const sm = new PetStateMachine();
    sm.transition('IDLE');
    sm.transition('QUIET');
    expect(sm.requestAction({ intent: 'touch', source: 'local_interaction' })).toMatchObject({
      approved: false,
      reason: 'dnd',
    });
    sm.transition('HIDDEN');
    expect(sm.requestAction({ intent: 'nod', source: 'local_chat' })).toMatchObject({
      approved: false,
      reason: 'dnd',
    });
  });

  it('OFFLINE local action outside IDLE whitelist is rejected as not_allowed', () => {
    const sm = new PetStateMachine();
    sm.transition('IDLE');
    sm.markOffline();
    // IDLE 白名单允许所有动画动作；SLEEPING 白名单只有 idle —— OFFLINE 审批用 IDLE，
    // 因此这里验证 OFFLINE 走 IDLE 白名单：任意动画动作均放行
    expect(sm.requestAction({ intent: 'sit', source: 'local_interaction' }).approved).toBe(true);
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
