import { describe, expect, it, vi } from 'vitest';

import type { RealtimeServer } from '../realtime/ws.js';

import { deliverEvent } from './inbox.js';

/** 内存 fake：记录 SQL 序列并模拟 nextval/returning */
function makeFakePool() {
  let seq = 100;
  const calls: string[] = [];
  const client = {
    query: vi.fn(async (sql: string) => {
      calls.push(sql.trim().split(/\s+/)[0]?.toLowerCase() ?? '');
      const first = sql.trim().toLowerCase();
      if (first.startsWith('update rooms')) return { rows: [{ next_room_seq: ++seq }] };
      if (first.startsWith('insert into events')) return { rows: [{ event_id: 'evt-1' }] };
      if (first.startsWith('insert into user_inbox')) return { rows: [{ inbox_seq: ++seq }] };
      if (first.startsWith('begin') || first.startsWith('commit') || first.startsWith('rollback'))
        return { rows: [] };
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn(async () => client),
  };
  return { pool, client, calls };
}

/** fake realtime：记录 deliver 调用（不含 RealtimeServer 其余接口，使用处 cast） */
function makeRealtime(): { deliver: RealtimeServer['deliver']; delivered: unknown[] } {
  const delivered: unknown[] = [];
  return {
    deliver: vi.fn((_userId: string, event: unknown) => {
      delivered.push(event);
      return 1;
    }),
    get delivered(): unknown[] {
      return delivered;
    },
  };
}

describe('deliverEvent（9.4 可靠写入核心）', () => {
  it('writes event + both inboxes in one transaction, then notifies via WS', async () => {
    const { pool, client, calls } = makeFakePool();
    const realtime = makeRealtime();

    const result = await deliverEvent({
      pool: pool as never,
      realtime: realtime as unknown as RealtimeServer,
      roomId: 'room-1',
      type: 'gift.snack_sent',
      payload: { snackId: 'snack_cookie' },
      reliability: 'A',
      recipients: ['u1', 'u2'],
    });

    // 事务顺序：begin → room_seq 自增 → events → 每收件人 inbox → commit
    expect(calls).toEqual(['begin', 'update', 'insert', 'insert', 'insert', 'commit']);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("nextval('user_inbox_seq')"),
      expect.anything(),
    );
    // room_seq 在 events 之前自增，事件与 inbox 同事务
    expect(result.eventId).toBe('evt-1');
    expect(result.roomSeq).toBe(101);
    expect(Object.keys(result.inboxSeqs)).toHaveLength(2);

    // 提交后 WS 通知双方（9.4 第 5 步）
    expect(realtime.deliver).toHaveBeenCalledTimes(2);
    const first = realtime.delivered[0] as { type: string; eventId: string };
    expect(first.type).toBe('inbox.delivered');
    expect(first.eventId).toBe('evt-1'); // 响应与 WS 同一 eventId（第 6 步）
  });

  it('rolls back and does not notify when the write fails (提交才代表成功)', async () => {
    const { pool, client } = makeFakePool();
    // 整体替换：inbox 写入（第二人）时失败
    client.query.mockImplementation(async (sql: string) => {
      const first = sql.trim().toLowerCase();
      if (first.startsWith('update rooms')) return { rows: [{ next_room_seq: 5 }] };
      if (first.startsWith('insert into events')) return { rows: [{ event_id: 'evt-x' }] };
      if (first.startsWith('insert into user_inbox')) throw new Error('disk full');
      return { rows: [] };
    });
    const realtime = makeRealtime();

    await expect(
      deliverEvent({
        pool: pool as never,
        realtime: realtime as unknown as RealtimeServer,
        roomId: null,
        type: 'visit.arrived',
        payload: {},
        reliability: 'A',
        recipients: ['u1', 'u2'],
      }),
    ).rejects.toThrow('disk full');

    // 回滚 + 无任何 WS 通知
    expect(client.query).toHaveBeenCalledWith('rollback');
    expect(realtime.deliver).not.toHaveBeenCalled();
  });
});
