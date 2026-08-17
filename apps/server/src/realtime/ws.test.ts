/**
 * RealtimeServer 稳定性测试（8.x / 9.2）：
 * - error 事件必须有监听（否则单客户端异常会通过 EventEmitter 崩掉整个进程）
 * - 服务端心跳：正常连接 ping/pong 存活；未响应 pong 的僵尸连接被 terminate 清理
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket, type WebSocketServer } from 'ws';

import { JwtService } from '../auth/jwt.js';

import { RealtimeServer } from './ws.js';

const jwt = new JwtService({ secret: 'test-secret' });

/** 起真实 HTTP 服务器 + RealtimeServer，返回 { server, realtime, url, close } */
async function startServer(heartbeatIntervalMs = 1_000) {
  const realtime = new RealtimeServer(jwt, {}, heartbeatIntervalMs);
  const server: Server = createServer();
  realtime.attach(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    realtime,
    url: `ws://127.0.0.1:${port}/realtime`,
    close: async () => {
      realtime.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** 建一个已鉴权连接（等 auth_ok） */
async function connectAuthed(url: string): Promise<WebSocket> {
  const token = await jwt.sign({ sub: 'user-1', deviceId: 'dev-1' });
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
      ws.once('message', (data) => {
        if (String(data).includes('auth_ok')) resolve();
        else reject(new Error(`auth 失败：${String(data)}`));
      });
    });
    ws.once('error', reject);
  });
  return ws;
}

function rawConns(realtime: RealtimeServer): Set<WebSocket> {
  const wss = (realtime as unknown as { wss: WebSocketServer }).wss;
  return wss.clients;
}

const openServers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  while (openServers.length > 0) {
    const s = openServers.pop();
    if (s) await s.close();
  }
});

describe('RealtimeServer 稳定性', () => {
  it('error 事件有监听：socket 异常不崩进程，且连接被清理', async () => {
    const ctx = await startServer();
    openServers.push(ctx);

    const client = await connectAuthed(ctx.url);
    await viWaitFor(() => expect(ctx.realtime.onlineUsers).toBe(1));

    // 模拟底层 socket 错误（网络中断 / deliver 时 ECONNRESET）
    const raw = [...rawConns(ctx.realtime)][0];
    expect(raw).toBeDefined();
    raw!.emit('error', new Error('ECONNRESET'));

    // error → ws.close() → close → remove：进程未崩且在线数归零
    await viWaitFor(() => expect(ctx.realtime.onlineUsers).toBe(0));
    client.terminate();
  });

  it('心跳：正常连接收到 pong 后跨 tick 存活', async () => {
    const ctx = await startServer(100);
    openServers.push(ctx);

    const client = await connectAuthed(ctx.url);
    await viWaitFor(() => expect(ctx.realtime.onlineUsers).toBe(1));

    // 真实 ws 客户端自动应答 ping → pong，isAlive 每轮刷新 → 不被清理
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 120));
      expect(ctx.realtime.onlineUsers).toBe(1);
    }
    client.terminate();
  });

  it('心跳：未响应 pong 的僵尸连接被 terminate 清理', async () => {
    const ctx = await startServer(10_000); // 关掉自动 tick，手动控制
    openServers.push(ctx);

    const client = await connectAuthed(ctx.url);
    await viWaitFor(() => expect(ctx.realtime.onlineUsers).toBe(1));

    // 第一轮 tick：ping 置 isAlive=false（真实客户端会回 pong，但我们模拟失联）
    ctx.realtime.heartbeatTick();
    // 第二轮 tick：仍为 false → terminate 清理
    ctx.realtime.heartbeatTick();

    await viWaitFor(() => expect(ctx.realtime.onlineUsers).toBe(0));
    client.terminate();
  });
});

describe('RealtimeServer.kickUser', () => {
  it('关闭该用户全部连接；无连接用户为 no-op 不抛错', () => {
    const server = new RealtimeServer(jwt, {}, 30_000);
    const closed: string[] = [];
    const fakeWs = (name: string) => ({ close: () => closed.push(name) });
    const conns = (
      server as unknown as {
        conns: Map<string, Set<{ close(): void }>>;
      }
    ).conns;
    conns.set('u1', new Set([fakeWs('ws1'), fakeWs('ws2')]));

    server.kickUser('u1');

    expect(closed).toEqual(['ws1', 'ws2']);
    expect(() => server.kickUser('nobody')).not.toThrow();
  });
});

/** 轻量轮询等待（避免引入依赖；30×50ms 上限） */
async function viWaitFor(assert: () => void, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assert();
      return;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw lastError;
}
