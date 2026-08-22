/**
 * 集群广播集成测试（多实例支持）：InMemoryPubSub 驱动 RealtimeServer 的
 * 跨实例投递 / 自环去重 / presence 聚合 / 失联实例清理。
 * PgPubSub 的 PG 侧行为（LISTEN/NOTIFY）由真实服务启动日志与 e2e 兜底。
 */
import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';

import { InMemoryPubSub } from './pubsub.js';
import { RealtimeServer } from './ws.js';

const jwt = new JwtService({ secret: 'test-secret' });

const openServers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  while (openServers.length > 0) {
    const s = openServers.pop();
    if (s) await s.close();
  }
  vi.restoreAllMocks();
});

function makeRealtime(): RealtimeServer {
  const realtime = new RealtimeServer(jwt, {}, 30_000);
  const server: Server = createServer();
  realtime.attach(server);
  openServers.push({
    close: async () => {
      realtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  });
  return realtime;
}

/** 直接向 conns 表注入一个假在线用户（绕过 WS 握手，聚焦 pubsub 路由逻辑） */
function injectOnlineUser(realtime: RealtimeServer, userId: string): void {
  const conns = (realtime as unknown as { conns: Map<string, Set<unknown>> }).conns;
  conns.set(userId, new Set());
}

describe('RealtimeServer × ClusterPubSub（多实例）', () => {
  it('deliver 发布 ws.delivery 广播（携带实例 id）', async () => {
    const realtime = makeRealtime();
    const pubsub = new InMemoryPubSub();
    realtime.attachPubSub(pubsub);
    pubsub.published.length = 0; // 丢弃 attach 时的首次 presence.ping

    realtime.deliver('u1', { type: 'inbox.delivered' });
    await vi.waitFor(() => expect(pubsub.published.length).toBeGreaterThan(0));
    const msg = pubsub.published[0] as {
      channel: string;
      payload: { from: string; userId: string };
    };
    expect(msg.channel).toBe('ws.delivery');
    expect(msg.payload.from).toBe(pubsub.instanceId);
    expect(msg.payload.userId).toBe('u1');
  });

  it('远端实例的 ws.delivery 到达本实例后投本地连接（本实例不再回广播）', async () => {
    const realtime = makeRealtime();
    const pubsub = new InMemoryPubSub();
    realtime.attachPubSub(pubsub);
    pubsub.published.length = 0; // 丢弃 attach 时的首次 presence.ping
    injectOnlineUser(realtime, 'u-remote');

    // 模拟远端实例发布（from ≠ 本实例 id）
    await pubsub.publish('ws.delivery', {
      from: 'other-instance',
      userId: 'u-remote',
      event: { type: 'inbox.delivered', marker: 'remote' },
    });
    // 本地消费远端消息后不回广播：published 中不出现 from=本实例 的 ws.delivery
    const echoBroadcasts = pubsub.published.filter(
      (p) =>
        p.channel === 'ws.delivery' && (p.payload as { from: string }).from === pubsub.instanceId,
    );
    expect(echoBroadcasts).toHaveLength(0);
  });

  it('自环消息（from = 本实例）不重复投递', async () => {
    const realtime = makeRealtime();
    const pubsub = new InMemoryPubSub();
    realtime.attachPubSub(pubsub);
    pubsub.published.length = 0; // 丢弃 attach 时的首次 presence.ping
    injectOnlineUser(realtime, 'u1');

    // deliver → 本地投 + publish；自环 handler 收到后应跳过（不二次投递/无异常）
    realtime.deliver('u1', { type: 'inbox.delivered' });
    await vi.waitFor(() => expect(pubsub.published.length).toBe(1));
    // InMemoryPubSub.publish 立即回环 handler：自环去重后 published 仍为 1（未级联）
    expect(pubsub.published.length).toBe(1);
  });

  it('presence.ping：远端在线集合聚合进 isOnline；失联实例被清理', async () => {
    const realtime = makeRealtime();
    const pubsub = new InMemoryPubSub();
    realtime.attachPubSub(pubsub);
    pubsub.published.length = 0; // 丢弃 attach 时的首次 presence.ping

    // 远端实例上报在线用户
    await pubsub.publish('presence.ping', {
      from: 'instance-b',
      userIds: ['u-b1', 'u-b2'],
    });
    expect(realtime.isOnline('u-b1')).toBe(true);
    expect(realtime.isOnline('u-b2')).toBe(true);
    expect(realtime.isOnline('u-unknown')).toBe(false);

    // 本实例连接的用户（聚合优先本地）
    injectOnlineUser(realtime, 'u-local');
    expect(realtime.isOnline('u-local')).toBe(true);

    // 失联清理：把 instance-b 的 seenAt 拨到 4 分钟前
    const remotes = (
      realtime as unknown as {
        remoteInstances: Map<string, { seenAt: number; userIds: Set<string> }>;
      }
    ).remoteInstances;
    remotes.get('instance-b')!.seenAt = Date.now() - 240_000;
    realtime.cleanupStaleRemoteInstances();
    expect(realtime.isOnline('u-b1')).toBe(false);
    expect(realtime.isOnline('u-local')).toBe(true);
  });

  it('publish 超限载荷抛错（调用方降级，不影响本地投递）', async () => {
    const realtime = makeRealtime();
    const pubsub = new InMemoryPubSub();
    realtime.attachPubSub(pubsub);
    pubsub.published.length = 0; // 丢弃 attach 时的首次 presence.ping
    injectOnlineUser(realtime, 'u1');

    // InMemory 版不限长——超限校验在 PgPubSub；此处验证 deliver 本地路径不受 publish 失败影响
    const failing = {
      instanceId: 'failing',
      publish: vi.fn(async () => {
        throw new Error('payload too large');
      }),
      on: vi.fn(),
      close: async () => undefined,
    };
    realtime.attachPubSub(failing as never);
    expect(() => realtime.deliver('u1', { type: 'x' })).not.toThrow();
  });
});
