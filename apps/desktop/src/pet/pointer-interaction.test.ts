import { describe, expect, it } from 'vitest';

import {
  classifyPointer,
  createDragMoveScheduler,
  type PointerSample,
} from './pointer-interaction.js';

describe('classifyPointer（点击/拖动/双击分类）', () => {
  const sample = (x: number, y: number, at: number): PointerSample => ({ x, y, at });

  it('classifies a still press as click', () => {
    const kind = classifyPointer({
      start: sample(100, 100, 1000),
      end: sample(100, 100, 1200),
      previousClickAt: null,
    });
    expect(kind).toBe('click');
  });

  it('classifies distance >= 6 as drag', () => {
    const kind = classifyPointer({
      start: sample(100, 100, 1000),
      end: sample(106, 100, 1100),
      previousClickAt: null,
    });
    expect(kind).toBe('drag');
  });

  it('treats exactly 6px as drag (inclusive threshold)', () => {
    const kind = classifyPointer({
      start: sample(100, 100, 1000),
      end: sample(100, 106, 1100),
      previousClickAt: null,
    });
    expect(kind).toBe('drag');
  });

  it('treats under 6px diagonal movement as click', () => {
    const kind = classifyPointer({
      start: sample(100, 100, 1000),
      end: sample(104, 104, 1100), // dist ≈ 5.66 < 6
      previousClickAt: null,
    });
    expect(kind).toBe('click');
  });

  it('classifies a quick second press within 320ms as double_click', () => {
    const kind = classifyPointer({
      start: sample(100, 100, 2000),
      end: sample(101, 100, 2100),
      previousClickAt: 1800,
    });
    expect(kind).toBe('double_click');
  });

  it('does not double_click when the previous click is too old', () => {
    const kind = classifyPointer({
      start: sample(100, 100, 2000),
      end: sample(101, 100, 2100),
      previousClickAt: 1500, // gap 600ms > 320ms
    });
    expect(kind).toBe('click');
  });

  it('does not double_click when the press duration exceeds 320ms', () => {
    const kind = classifyPointer({
      start: sample(100, 100, 2000),
      end: sample(101, 100, 2500), // duration 500ms > 320ms
      previousClickAt: 2300,
    });
    expect(kind).toBe('click');
  });

  it('does not double_click when previousClickAt is null', () => {
    const kind = classifyPointer({
      start: sample(100, 100, 2000),
      end: sample(101, 100, 2100),
      previousClickAt: null,
    });
    expect(kind).toBe('click');
  });
});

describe('createDragMoveScheduler（rAF 节流）', () => {
  function fakeFrame() {
    let nextHandle = 1;
    const pending = new Map<number, () => void>();
    return {
      raf: (cb: () => void) => {
        const handle = nextHandle++;
        pending.set(handle, cb);
        return handle;
      },
      caf: (handle: number) => {
        pending.delete(handle);
      },
      fire: () => {
        const callbacks = [...pending.values()];
        pending.clear();
        for (const cb of callbacks) cb();
      },
      count: () => pending.size,
    };
  }

  it('sends only the latest point once per frame', () => {
    const f = fakeFrame();
    const sent: { x: number; y: number }[] = [];
    const scheduler = createDragMoveScheduler((p) => sent.push(p), f.raf, f.caf);
    scheduler.push({ x: 1, y: 2 });
    scheduler.push({ x: 3, y: 4 });
    scheduler.push({ x: 5, y: 6 });
    expect(sent).toEqual([]);
    f.fire();
    expect(sent).toEqual([{ x: 5, y: 6 }]);
  });

  it('queues a fresh frame after the previous one flushed', () => {
    const f = fakeFrame();
    const sent: { x: number; y: number }[] = [];
    const scheduler = createDragMoveScheduler((p) => sent.push(p), f.raf, f.caf);
    scheduler.push({ x: 1, y: 2 });
    f.fire();
    scheduler.push({ x: 7, y: 8 });
    f.fire();
    expect(sent).toEqual([
      { x: 1, y: 2 },
      { x: 7, y: 8 },
    ]);
  });

  it('cancel drops the pending point and cancels the frame', () => {
    const f = fakeFrame();
    const sent: { x: number; y: number }[] = [];
    const scheduler = createDragMoveScheduler((p) => sent.push(p), f.raf, f.caf);
    scheduler.push({ x: 1, y: 2 });
    scheduler.cancel();
    expect(f.count()).toBe(0);
    expect(sent).toEqual([]);
    f.fire();
    expect(sent).toEqual([]);
  });

  it('cancel is idempotent and push after cancel schedules a fresh frame', () => {
    const f = fakeFrame();
    const sent: { x: number; y: number }[] = [];
    const scheduler = createDragMoveScheduler((p) => sent.push(p), f.raf, f.caf);
    scheduler.cancel();
    scheduler.cancel();
    scheduler.push({ x: 9, y: 9 });
    f.fire();
    expect(sent).toEqual([{ x: 9, y: 9 }]);
  });
});
