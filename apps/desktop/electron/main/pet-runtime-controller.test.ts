import type { PetRuntimeSnapshot, PetVisualCommand } from '@pet/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PetRuntimeController } from './pet-runtime-controller.js';

afterEach(() => {
  vi.useRealTimers();
});

function makeRuntime(visuals: PetVisualCommand[], snapshots: PetRuntimeSnapshot[]) {
  return new PetRuntimeController({
    emitSnapshot: (s) => snapshots.push(s),
    emitVisual: (c) => visuals.push(c),
  });
}

describe('PetRuntimeController (Main 进程唯一宠物运行时)', () => {
  it('boots to IDLE, broadcasts happy stretch, then degrades to SITTING/SLEEPING', () => {
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

    // 180s 空闲降级 → SITTING；再 600s → SLEEPING，状态切换广播 stateToMotion
    vi.advanceTimersByTime(180_000 - 1_200);
    expect(snapshots.at(-1)?.state).toBe('SITTING');
    expect(visuals).toContainEqual({ type: 'motion', motion: 'sit', intensity: 1 });

    vi.advanceTimersByTime(600_000);
    expect(snapshots.at(-1)?.state).toBe('SLEEPING');
    expect(visuals).toContainEqual({ type: 'motion', motion: 'sleep', intensity: 1 });

    runtime.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops all timers while hidden and restores exactly one tick on unhide', () => {
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
    expect(vi.getTimerCount()).toBe(1);

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

  it('drives chat start/done through speaking, expression, motion and bubble', () => {
    vi.useFakeTimers();
    const visuals: PetVisualCommand[] = [];
    const snapshots: PetRuntimeSnapshot[] = [];
    const runtime = makeRuntime(visuals, snapshots);
    runtime.start();

    runtime.handleChat({ phase: 'start', source: 'local_chat', text: '你好呀' });
    expect(runtime.snapshot.state).toBe('CHATTING');
    expect(visuals).toContainEqual({ type: 'speaking', active: true });

    runtime.handleChat({ phase: 'update', source: 'local_chat', text: 'x'.repeat(200) });
    expect(visuals).toContainEqual({ type: 'bubble', text: 'x'.repeat(160) });

    runtime.handleChat({
      phase: 'done',
      source: 'local_chat',
      output: {
        dialogue: '今天也要元气满满！',
        emotion: 'happy',
        actionIntent: 'nod',
        intensity: 5,
      },
    });
    expect(visuals).toContainEqual({ type: 'speaking', active: false });
    expect(visuals).toContainEqual({ type: 'expression', expression: 'happy' });
    expect(visuals).toContainEqual({ type: 'motion', motion: 'talk', intensity: 3 });
    expect(visuals).toContainEqual({ type: 'bubble', text: '今天也要元气满满！' });
    expect(runtime.snapshot.state).toBe('IDLE');

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
});
