import type { PetRuntimeSnapshot, PetVisualCommand } from '@pet/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PetRuntimeController } from './pet-runtime-controller.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function makeRuntime(visuals: PetVisualCommand[], snapshots: PetRuntimeSnapshot[]) {
  return new PetRuntimeController({
    emitSnapshot: (s) => snapshots.push(s),
    emitVisual: (c) => visuals.push(c),
  });
}

describe('PetRuntimeController (Main 进程唯一宠物运行时)', () => {
  it('boots to IDLE, broadcasts happy stretch, then degrades to SITTING after the activity window', () => {
    vi.useFakeTimers();
    const snapshots: PetRuntimeSnapshot[] = [];
    const visuals: PetVisualCommand[] = [];
    const runtime = makeRuntime(visuals, snapshots);

    runtime.start();
    expect(snapshots.at(-1)).toEqual({ state: 'IDLE', online: true, dnd: false, hidden: false });
    expect(visuals).toContainEqual({ type: 'motion', motion: 'happy', intensity: 1 });

    // 启动伸懒腰 1.2s 后回到 idle 动作
    vi.advanceTimersByTime(1_200);
    expect(visuals).toContainEqual({ type: 'motion', motion: 'idle', intensity: 1 });

    // 活动窗口（150s）过后停止溜达，空闲降级可达：最坏末轮溜达结束 ≤245s，+180s → SITTING（500s 内不会到 SLEEPING）
    vi.advanceTimersByTime(500_000 - 1_200);
    expect(snapshots.at(-1)?.state).toBe('SITTING');
    expect(visuals).toContainEqual({ type: 'motion', motion: 'sit', intensity: 1 });

    // SITTING 连续 600s → SLEEPING（窗口已过，溜达不再重挂，确定性）
    vi.advanceTimersByTime(610_000);
    expect(snapshots.at(-1)?.state).toBe('SLEEPING');
    expect(visuals).toContainEqual({ type: 'motion', motion: 'sleep', intensity: 1 });

    runtime.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops all timers while hidden and restores tick + wander timers on unhide', () => {
    vi.useFakeTimers();
    const snapshots: PetRuntimeSnapshot[] = [];
    const visuals: PetVisualCommand[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    runtime.setHidden(true);
    expect(runtime.snapshot).toEqual({
      state: 'HIDDEN',
      online: true,
      dnd: false,
      hidden: true,
    });
    expect(vi.getTimerCount()).toBe(0);

    runtime.setHidden(false);
    expect(runtime.snapshot.state).toBe('IDLE');
    // tick + wander 两个定时器
    expect(vi.getTimerCount()).toBe(2);

    runtime.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('approves local offline actions and rejects cloud actions without visuals', () => {
    vi.useFakeTimers();
    const visuals: PetVisualCommand[] = [];
    const snapshots: PetRuntimeSnapshot[] = [];
    const runtime = makeRuntime(visuals, snapshots);

    runtime.setOnline(false);
    expect(runtime.snapshot.state).toBe('OFFLINE');

    const local = runtime.requestAction({ intent: 'touch', source: 'local_interaction' });
    expect(local.approved).toBe(true);
    expect(visuals).toContainEqual({ type: 'motion', motion: 'touch', intensity: 1 });

    const cloud = runtime.requestAction({ intent: 'wave', source: 'cloud_ai' });
    expect(cloud).toEqual({ approved: false, intent: 'wave', reason: 'offline' });
    expect(visuals.filter((c) => c.type === 'motion' && c.motion === 'wave')).toHaveLength(0);

    runtime.stop();
  });

  it('wanders: random 30-90s enters WALKING, then returns to IDLE after 3-5s', () => {
    vi.useFakeTimers();
    const snapshots: PetRuntimeSnapshot[] = [];
    const visuals: PetVisualCommand[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();

    // 90s 推进必触发溜达（随机上限 90s，延迟 < 90s）；期间 tick 不降级（180s 才 SITTING）
    vi.advanceTimersByTime(90_000);
    const walkingIdx = snapshots.findIndex((s) => s.state === 'WALKING');
    expect(walkingIdx).toBeGreaterThanOrEqual(0);
    expect(visuals).toContainEqual({ type: 'motion', motion: 'walk', intensity: 1 });

    // 溜达 3-5s 后回 IDLE（结束定时器上限 5s；回 IDLE 后 30-90s 才可能再溜达）
    vi.advanceTimersByTime(5_000);
    expect(snapshots.slice(walkingIdx).some((s) => s.state === 'IDLE')).toBe(true);

    runtime.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('can start a deterministic wander through the same approved runtime path', () => {
    vi.useFakeTimers();
    const snapshots: PetRuntimeSnapshot[] = [];
    const visuals: PetVisualCommand[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();

    expect(runtime.tryStartWander()).toBe(true);
    expect(runtime.snapshot.state).toBe('WALKING');
    expect(visuals.at(-1)).toEqual({ type: 'motion', motion: 'walk', intensity: 1 });

    expect(runtime.cancelWander()).toBe(true);
    expect(runtime.snapshot.state).toBe('IDLE');
    expect(visuals.at(-1)).toEqual({ type: 'motion', motion: 'idle', intensity: 1 });

    runtime.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('plays walk and turns with manual horizontal dragging, then restores the state motion', () => {
    vi.useFakeTimers();
    const snapshots: PetRuntimeSnapshot[] = [];
    const visuals: PetVisualCommand[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();
    vi.advanceTimersByTime(1_200);

    expect(runtime.tryStartWander()).toBe(true);
    expect(runtime.snapshot.state).toBe('WALKING');
    runtime.beginManualDrag();
    expect(runtime.snapshot.state).toBe('IDLE');
    expect(visuals.at(-1)).toEqual({ type: 'motion', motion: 'walk', intensity: 1 });

    runtime.updateManualDrag(18);
    runtime.updateManualDrag(6);
    runtime.updateManualDrag(-12);
    expect(visuals.filter((command) => command.type === 'facing')).toEqual([
      { type: 'facing', facing: 'right' },
      { type: 'facing', facing: 'left' },
    ]);

    runtime.endManualDrag();
    expect(visuals.at(-1)).toEqual({ type: 'motion', motion: 'idle', intensity: 1 });

    runtime.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not wander while QUIET (rearms instead of entering WALKING)', () => {
    vi.useFakeTimers();
    const snapshots: PetRuntimeSnapshot[] = [];
    const visuals: PetVisualCommand[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();
    runtime.setDnd(true);

    vi.advanceTimersByTime(90_000);
    expect(runtime.snapshot.state).toBe('QUIET');
    expect(snapshots.every((s) => s.state !== 'WALKING')).toBe(true);

    runtime.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('interaction refreshes the activity window (wander continues after touch)', () => {
    vi.useFakeTimers();
    const snapshots: PetRuntimeSnapshot[] = [];
    const visuals: PetVisualCommand[] = [];
    // 固定随机值 → 溜达延迟 60s、持续 4s（30s + r*60s / 3s + r*2s），轮次可精确预期：60/124/188/252s
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();

    // 130s 触摸刷新活动窗口（延至 280s）：若不刷新，150s 后不再挂溜达，第 4 轮（252s）不会触发
    vi.advanceTimersByTime(130_000);
    runtime.handleInteraction({ kind: 'head_touch' });
    vi.advanceTimersByTime(150_000);
    expect(snapshots.filter((s) => s.state === 'WALKING').length).toBeGreaterThanOrEqual(4);

    runtime.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('re-arms after a walk-cooldown rejection (chat walk within 15s)', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // 溜达延迟 60s
    const snapshots: PetRuntimeSnapshot[] = [];
    const visuals: PetVisualCommand[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();

    // 55s 时聊天输出 walk 动作（进入 15s 冷却）
    vi.advanceTimersByTime(55_000);
    runtime.requestAction({ intent: 'walk', source: 'cloud_ai' });
    expect(visuals).toContainEqual({ type: 'motion', motion: 'walk', intensity: 1 });

    // t=60s 溜达到点 → walk 冷却中 → 本轮跳过（无 WALKING 快照）
    vi.advanceTimersByTime(5_000);
    expect(snapshots.every((s) => s.state !== 'WALKING')).toBe(true);

    // 修复后重挂：下一轮 t=120s（冷却已过 70s）→ 溜达成功
    vi.advanceTimersByTime(60_000);
    expect(snapshots.some((s) => s.state === 'WALKING')).toBe(true);

    runtime.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('maps head/body/tail touches to approved visuals and ignores UI-only clicks', () => {
    vi.useFakeTimers();
    const visuals: PetVisualCommand[] = [];
    const snapshots: PetRuntimeSnapshot[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();

    runtime.handleInteraction({ kind: 'head_touch' });
    expect(visuals).toContainEqual({ type: 'motion', motion: 'touch', intensity: 1 });

    runtime.handleInteraction({ kind: 'body_touch' });
    expect(visuals).toContainEqual({ type: 'motion', motion: 'idle', intensity: 1 });

    runtime.handleInteraction({ kind: 'tail_touch' });
    expect(visuals).toContainEqual({ type: 'motion', motion: 'surprised', intensity: 1 });

    const before = visuals.length;
    runtime.handleInteraction({ kind: 'double_click' });
    runtime.handleInteraction({ kind: 'context_menu' });
    expect(visuals.length).toBe(before);

    runtime.stop();
  });

  it('returns a transient touch animation to the current state motion', () => {
    vi.useFakeTimers();
    const visuals: PetVisualCommand[] = [];
    const snapshots: PetRuntimeSnapshot[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();
    vi.advanceTimersByTime(1_200);

    runtime.handleInteraction({ kind: 'head_touch' });
    expect(visuals.at(-1)).toEqual({ type: 'motion', motion: 'touch', intensity: 1 });
    vi.advanceTimersByTime(1_299);
    expect(visuals.at(-1)).toEqual({ type: 'motion', motion: 'touch', intensity: 1 });
    vi.advanceTimersByTime(1);
    expect(visuals.at(-1)).toEqual({ type: 'motion', motion: 'idle', intensity: 1 });

    runtime.stop();
  });

  it('drives chat start/done through speaking, expression, motion and bubble', () => {
    vi.useFakeTimers();
    const visuals: PetVisualCommand[] = [];
    const snapshots: PetRuntimeSnapshot[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();

    runtime.handleChat({ phase: 'start', source: 'local_chat', text: '你好呀' });
    expect(runtime.snapshot.state).toBe('CHATTING');
    expect(visuals).toContainEqual({ type: 'speaking', active: true });
    expect(visuals).toContainEqual({ type: 'motion', motion: 'talk', intensity: 1 });

    runtime.handleChat({ phase: 'update', source: 'local_chat', text: 'x'.repeat(200) });
    expect(visuals).toContainEqual({ type: 'bubble', text: 'x'.repeat(160) });

    runtime.handleChat({
      phase: 'done',
      source: 'local_chat',
      output: {
        dialogue: '今天也要元气满满！',
        emotion: 'happy',
        actionIntent: 'cheer',
        intensity: 5,
      },
    });
    expect(visuals).toContainEqual({ type: 'speaking', active: false });
    expect(visuals).toContainEqual({ type: 'expression', expression: 'happy' });
    expect(visuals).toContainEqual({ type: 'motion', motion: 'happy', intensity: 3 });
    expect(visuals).toContainEqual({ type: 'bubble', text: '今天也要元气满满！' });
    expect(runtime.snapshot.state).toBe('IDLE');

    runtime.stop();
  });

  it('chat interrupts an active wander and enters CHATTING through IDLE', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const visuals: PetVisualCommand[] = [];
    const snapshots: PetRuntimeSnapshot[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();
    vi.advanceTimersByTime(30_000);
    expect(runtime.snapshot.state).toBe('WALKING');

    runtime.handleChat({ phase: 'start', source: 'local_chat', text: '停一下' });
    expect(runtime.snapshot.state).toBe('CHATTING');
    expect(visuals.at(-1)).toEqual({ type: 'motion', motion: 'talk', intensity: 1 });

    runtime.stop();
  });

  it('keeps OFFLINE state but still broadcasts speaking on chat start', () => {
    vi.useFakeTimers();
    const visuals: PetVisualCommand[] = [];
    const snapshots: PetRuntimeSnapshot[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.setOnline(false);

    runtime.handleChat({ phase: 'start', source: 'local_chat', text: 'hi' });
    expect(runtime.snapshot.state).toBe('OFFLINE');
    expect(visuals).toContainEqual({ type: 'speaking', active: true });

    runtime.stop();
  });

  it('ignores chat speaking and bubble while quiet', () => {
    vi.useFakeTimers();
    const visuals: PetVisualCommand[] = [];
    const snapshots: PetRuntimeSnapshot[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();
    runtime.setDnd(true);

    const before = visuals.length;
    runtime.handleChat({ phase: 'start', source: 'local_chat', text: 'hi' });
    runtime.handleChat({ phase: 'update', source: 'local_chat', text: 'hello' });
    expect(visuals.length).toBe(before);

    runtime.stop();
  });

  it('closes chat visuals and returns to IDLE on error', () => {
    vi.useFakeTimers();
    const visuals: PetVisualCommand[] = [];
    const snapshots: PetRuntimeSnapshot[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();
    runtime.handleChat({ phase: 'start', source: 'cloud_ai', text: 'hi' });

    runtime.handleChat({ phase: 'error', source: 'cloud_ai', message: 'e'.repeat(200) });
    expect(visuals).toContainEqual({ type: 'speaking', active: false });
    expect(visuals).toContainEqual({ type: 'bubble', text: 'e'.repeat(120) });
    expect(runtime.snapshot.state).toBe('IDLE');

    runtime.stop();
  });

  it('never emits after stop()', () => {
    vi.useFakeTimers();
    const snapshots: PetRuntimeSnapshot[] = [];
    const visuals: PetVisualCommand[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();
    runtime.stop();

    const baseline = snapshots.length + visuals.length;
    runtime.handleChat({ phase: 'start', source: 'local_chat', text: 'hi' });
    runtime.handleChat({
      phase: 'done',
      source: 'local_chat',
      output: { dialogue: 'x', emotion: 'happy', actionIntent: 'wave', intensity: 3 },
    });
    runtime.handleInteraction({ kind: 'head_touch' });
    runtime.requestAction({ intent: 'wave', source: 'local_interaction' });
    runtime.setOnline(false);
    runtime.setDnd(true);
    runtime.setHidden(true);
    vi.advanceTimersByTime(10_000);

    expect(snapshots.length + visuals.length).toBe(baseline);
  });

  it('IDLE 收到礼物：happy 表情 + happy 动作 + 气泡（含昵称）', () => {
    vi.useFakeTimers();
    const visuals: PetVisualCommand[] = [];
    const snapshots: PetRuntimeSnapshot[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();

    runtime.handleSocialEvent({
      type: 'gift.snack_sent',
      giftId: 'gift-1',
      snackId: 'snack_cookie',
      fromUserId: 'user-1',
      fromNickname: 'Alice',
    });
    expect(visuals).toContainEqual({ type: 'expression', expression: 'happy' });
    expect(visuals).toContainEqual({ type: 'motion', motion: 'happy', intensity: 1 });
    expect(visuals).toContainEqual({ type: 'bubble', text: 'Alice 送来了小饼干！' });

    runtime.stop();
  });

  it('QUIET / HIDDEN 忽略礼物（无任何视觉指令）', () => {
    vi.useFakeTimers();
    const visuals: PetVisualCommand[] = [];
    const snapshots: PetRuntimeSnapshot[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();

    runtime.setDnd(true);
    expect(runtime.snapshot.state).toBe('QUIET');
    const quietBefore = visuals.length;
    runtime.handleSocialEvent({
      type: 'gift.snack_sent',
      giftId: 'gift-q',
      snackId: 'snack_candy',
      fromUserId: 'user-1',
    });
    expect(visuals.length).toBe(quietBefore);

    runtime.setDnd(false);
    runtime.setHidden(true);
    expect(runtime.snapshot.state).toBe('HIDDEN');
    const hiddenBefore = visuals.length;
    runtime.handleSocialEvent({
      type: 'gift.snack_sent',
      giftId: 'gift-h',
      snackId: 'snack_tea',
      fromUserId: 'user-1',
    });
    expect(visuals.length).toBe(hiddenBefore);

    runtime.stop();
  });

  it('CHATTING 中收到礼物：仍弹气泡 + 表情，无动作（cheer 不在白名单，非 cooldown 不补偿）', () => {
    vi.useFakeTimers();
    const visuals: PetVisualCommand[] = [];
    const snapshots: PetRuntimeSnapshot[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();
    runtime.handleChat({ phase: 'start', source: 'local_chat', text: 'hi' });
    expect(runtime.snapshot.state).toBe('CHATTING');

    const motionsBefore = visuals.filter(
      (c) => c.type === 'motion' && (c.motion === 'happy' || c.motion === 'wave'),
    ).length;
    runtime.handleSocialEvent({
      type: 'gift.snack_sent',
      giftId: 'gift-c',
      snackId: 'snack_cookie',
      fromUserId: 'user-1',
    });
    expect(visuals).toContainEqual({ type: 'expression', expression: 'happy' });
    expect(visuals).toContainEqual({ type: 'bubble', text: '好友 送来了小饼干！' });
    expect(
      visuals.filter((c) => c.type === 'motion' && (c.motion === 'happy' || c.motion === 'wave')),
    ).toHaveLength(motionsBefore);

    runtime.stop();
  });

  it('无昵称气泡回退"好友"，未知点心回退"点心"', () => {
    vi.useFakeTimers();
    const visuals: PetVisualCommand[] = [];
    const snapshots: PetRuntimeSnapshot[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();

    runtime.handleSocialEvent({
      type: 'gift.snack_sent',
      giftId: 'gift-4',
      snackId: 'snack_tea',
      fromUserId: 'user-1',
    });
    expect(visuals).toContainEqual({ type: 'bubble', text: '好友 送来了茶点！' });

    runtime.handleSocialEvent({
      type: 'gift.snack_sent',
      giftId: 'gift-5',
      snackId: 'snack_mystery',
      fromUserId: 'user-1',
    });
    expect(visuals).toContainEqual({ type: 'bubble', text: '好友 送来了点心！' });

    runtime.stop();
  });

  it('cheer 冷却中改播 wave 补偿动作', () => {
    vi.useFakeTimers();
    const visuals: PetVisualCommand[] = [];
    const snapshots: PetRuntimeSnapshot[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();

    runtime.handleSocialEvent({
      type: 'gift.snack_sent',
      giftId: 'gift-a',
      snackId: 'snack_cookie',
      fromUserId: 'user-1',
    });
    // 立即第二次送礼：cheer 10s 冷却 → 尝试 wave 补偿（wave 冷却未用）
    runtime.handleSocialEvent({
      type: 'gift.snack_sent',
      giftId: 'gift-b',
      snackId: 'snack_candy',
      fromUserId: 'user-1',
    });
    expect(visuals).toContainEqual({ type: 'motion', motion: 'wave', intensity: 1 });

    runtime.stop();
  });

  it('stopped 后收到礼物无任何副作用', () => {
    vi.useFakeTimers();
    const visuals: PetVisualCommand[] = [];
    const snapshots: PetRuntimeSnapshot[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();
    runtime.stop();

    const baseline = visuals.length + snapshots.length;
    runtime.handleSocialEvent({
      type: 'gift.snack_sent',
      giftId: 'gift-s',
      snackId: 'snack_cookie',
      fromUserId: 'user-1',
    });
    expect(visuals.length + snapshots.length).toBe(baseline);
  });
});
