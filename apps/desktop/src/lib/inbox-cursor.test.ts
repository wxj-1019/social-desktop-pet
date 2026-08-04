/**
 * /sync 循环分页（9.5 慢路径补齐）—— 单页/多页追平/hasMore 终止/页数上限。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, type SyncEvent } from './api/client.js';
import { syncAfter } from './inbox-cursor.js';

function page(events: SyncEvent[], nextInboxSeq: number, hasMore: boolean) {
  return { events, nextInboxSeq, hasMore };
}

function evt(inboxSeq: number): SyncEvent {
  return {
    inboxSeq,
    event: {
      eventId: `evt-${inboxSeq}`,
      roomId: null,
      roomSeq: null,
      type: 'gift.snack_sent',
      payload: {},
      reliability: 'A',
      serverTimestamp: '2026-08-03T10:00:00.000Z',
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('syncAfter（9.5 循环分页）', () => {
  it('单页即追上（hasMore=false 立即终止）', async () => {
    const spy = vi.spyOn(api, 'sync').mockResolvedValue(page([evt(1), evt(2)], 2, false));
    const result = await syncAfter(0);
    expect(result.items.map((e) => e.inboxSeq)).toEqual([1, 2]);
    expect(result.nextInboxSeq).toBe(2);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(0);
  });

  it('多页追平：循环传 cursor，直到 hasMore=false', async () => {
    const spy = vi
      .spyOn(api, 'sync')
      .mockResolvedValueOnce(page([evt(1)], 1, true))
      .mockResolvedValueOnce(page([evt(2), evt(3)], 3, true))
      .mockResolvedValueOnce(page([], 3, false));
    const result = await syncAfter(0);
    expect(result.items.map((e) => e.inboxSeq)).toEqual([1, 2, 3]);
    expect(result.nextInboxSeq).toBe(3);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls.map((c) => c[0])).toEqual([0, 1, 3]);
  });

  it('页数上限防失控：20 页后停止（剩余留给下一次拉取）', async () => {
    const spy = vi.spyOn(api, 'sync').mockResolvedValue(page([evt(1)], 1, true)); // 永远 hasMore=true
    const result = await syncAfter(0);
    expect(spy).toHaveBeenCalledTimes(20);
    expect(result.items).toHaveLength(20);
  });

  it('空事件页也推进游标（B 类过期推进）', async () => {
    const spy = vi.spyOn(api, 'sync').mockResolvedValue(page([], 7, false));
    const result = await syncAfter(7);
    expect(result.items).toEqual([]);
    expect(result.nextInboxSeq).toBe(7);
    expect(spy).toHaveBeenCalledWith(7);
  });

  it('服务端异常向上抛（调用方 30s 轮询/WS 重连兜底）', async () => {
    vi.spyOn(api, 'sync').mockRejectedValue(new Error('network down'));
    await expect(syncAfter(0)).rejects.toThrow('network down');
  });
});
