/**
 * Presence 广播测试（9.2 在线状态闭环）：
 * - 上线/下线 → 查 active 好友 → deliverEvent 投递 B 类 presence.changed（带过期）
 * - 无好友 → 不投递
 * - 连接鉴权成功 → 刷新 devices.last_seen_at（设备维度）
 */
import { describe, expect, it, vi } from 'vitest';

import { createPresenceHooks } from './presence.js';
import type { RealtimeServer } from './ws.js';

/** 内存 fake pool：按 SQL 前缀返回行（好友查询 / update devices） */
function makeFakePool(friendUserIds: string[]) {
  const calls: string[] = [];
  const respond = async (sql: string) => {
    calls.push(sql.trim().split(/\s+/)[0]?.toLowerCase() ?? '');
    const first = sql.trim().toLowerCase();
    if (first.startsWith('select case'))
      return { rows: friendUserIds.map((id) => ({ friend_user_id: id })) };
    if (first.startsWith('update devices')) return { rows: [] };
    if (first.startsWith('update rooms')) return { rows: [{ next_room_seq: 1 }] };
    if (first.startsWith('insert into events')) return { rows: [{ event_id: 'evt-presence' }] };
    if (first.startsWith('insert into user_inbox')) return { rows: [{ inbox_seq: 1 }] };
    if (first.startsWith('begin') || first.startsWith('commit') || first.startsWith('rollback'))
      return { rows: [] };
    return { rows: [] };
  };
  const client = {
    query: vi.fn(respond),
    release: vi.fn(),
  };
  // presence 模块直接走 pool.query（好友查询/触达设备不要求事务）；deliverEvent 走 connect()
  const pool = {
    connect: vi.fn(async () => client),
    query: vi.fn(respond),
  };
  return { pool, client, calls };
}

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

describe('createPresenceHooks', () => {
  it('上线：投递 B 类 presence.changed 给全部 active 好友（带 expiresAt）', async () => {
    const { pool, calls } = makeFakePool(['u-bob']);
    const realtime = makeRealtime();

    const hooks = createPresenceHooks(pool as never, realtime as unknown as RealtimeServer);
    hooks.onPresenceChanged('u-alice', true);

    // 等 fire-and-forget 完成
    await vi.waitFor(() => expect(realtime.deliver).toHaveBeenCalledTimes(1));
    expect(calls[0]).toBe('select'); // 好友查询
    expect(calls).toContain('insert'); // events + inbox

    const notification = realtime.delivered[0] as {
      type: string;
      payload: { userId: string; online: boolean };
      expiresAt: string | null;
    };
    expect(notification.type).toBe('inbox.delivered');
    expect(notification.payload).toEqual({ userId: 'u-alice', online: true });
    // B 类短期可靠：必须带 expiresAt（72h，retention/sync 可清理）
    expect(notification.expiresAt).not.toBeNull();
  });

  it('下线：同样投递 presence.changed（online: false）', async () => {
    const { pool } = makeFakePool(['u-bob']);
    const realtime = makeRealtime();

    const hooks = createPresenceHooks(pool as never, realtime as unknown as RealtimeServer);
    hooks.onPresenceChanged('u-alice', false);

    await vi.waitFor(() => expect(realtime.deliver).toHaveBeenCalledTimes(1));
    const notification = realtime.delivered[0] as { payload: { online: boolean } };
    expect(notification.payload.online).toBe(false);
  });

  it('无 active 好友：不投递（不产生 DB 写入）', async () => {
    const { pool, calls } = makeFakePool([]);
    const realtime = makeRealtime();

    const hooks = createPresenceHooks(pool as never, realtime as unknown as RealtimeServer);
    hooks.onPresenceChanged('u-alone', true);

    // 给异步留时间：好友查询后 recipients 为空直接 return，不应有 insert
    await new Promise((r) => setTimeout(r, 20));
    expect(realtime.deliver).not.toHaveBeenCalled();
    expect(calls).not.toContain('insert');
  });

  it('连接鉴权成功：按设备刷新 last_seen_at', async () => {
    const { pool } = makeFakePool([]);
    const realtime = makeRealtime();

    const hooks = createPresenceHooks(pool as never, realtime as unknown as RealtimeServer);
    hooks.onAuthenticated('u-alice', 'dev-1');

    await vi.waitFor(() => expect(pool.query).toHaveBeenCalled());
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('update devices set last_seen_at = now()'),
      ['dev-1', 'u-alice'],
    );
  });
});
