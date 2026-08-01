import { describe, expect, it, vi } from 'vitest';

import { retryDelayMs, toWsUrl } from './realtime.js';

describe('retryDelayMs（9.7 指数退避：0.5/1/2/4/8s 封顶 30s）', () => {
  it('doubles from 500ms and caps at 30s', () => {
    expect(retryDelayMs(0)).toBe(500);
    expect(retryDelayMs(1)).toBe(1000);
    expect(retryDelayMs(2)).toBe(2000);
    expect(retryDelayMs(3)).toBe(4000);
    expect(retryDelayMs(4)).toBe(8000);
    expect(retryDelayMs(5)).toBe(16_000);
    expect(retryDelayMs(6)).toBe(30_000); // 2^6=32s → 封顶
    expect(retryDelayMs(10)).toBe(30_000);
  });
});

describe('toWsUrl', () => {
  it('maps http→ws and https→wss', () => {
    expect(toWsUrl('http://127.0.0.1:8787')).toBe('ws://127.0.0.1:8787/realtime');
    expect(toWsUrl('https://api.pet.example')).toBe('wss://api.pet.example/realtime');
  });
});

describe('RealtimeClient 协议（鉴权握手/心跳/重连）', () => {
  // 用可控的 fake WebSocket 验证协议行为
  it('sends auth as first message and enters connected on auth_ok', async () => {
    const { RealtimeClient } = await import('./realtime.js');
    const sent: string[] = [];
    const events: Record<string, unknown>[] = [];

    class FakeWs {
      static OPEN = 1;
      readyState = 1;
      onopen: (() => void) | null = null;
      onmessage: ((ev: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      send(d: string) {
        sent.push(d);
      }
      close() {
        this.onclose?.();
      }
      /** 测试辅助：服务端发消息 */
      serverSend(msg: unknown) {
        this.onmessage?.({ data: JSON.stringify(msg) });
      }
    }
    const fake = new FakeWs();
    vi.stubGlobal(
      'WebSocket',
      vi.fn(() => fake),
    );

    const client = new RealtimeClient('ws://test/realtime', () => 'tok-1', {
      onEvent: (e) => events.push(e),
    });
    client.connect();
    fake.onopen?.();
    expect(sent[0]).toBe(JSON.stringify({ type: 'auth', token: 'tok-1' }));

    fake.serverSend({ type: 'auth_ok' });
    expect(client.currentStatus).toBe('connected');

    // 服务端事件透传
    fake.serverSend({ type: 'inbox.delivered', eventId: 'e1' });
    expect(events).toEqual([{ type: 'inbox.delivered', eventId: 'e1' }]);

    client.close();
    vi.unstubAllGlobals();
  });

  it('reconnects after unexpected close (指数退避)', async () => {
    vi.useFakeTimers();
    const { RealtimeClient } = await import('./realtime.js');
    const wsCount = 0;
    class FakeWs {
      static OPEN = 1;
      readyState = 1;
      onopen: (() => void) | null = null;
      onmessage: ((ev: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      send() {}
      close() {
        this.onclose?.();
      }
    }
    vi.stubGlobal(
      'WebSocket',
      vi.fn(() => new FakeWs() as unknown as WebSocket),
    );
    const reconnected = vi.fn();
    const client = new RealtimeClient('ws://test/realtime', () => 'tok', {
      onReconnected: reconnected,
    });
    client.connect();
    // 首次连接成功
    const first = client['ws'] as unknown as FakeWs;
    first.onopen?.();
    first.onmessage?.({ data: JSON.stringify({ type: 'auth_ok' }) });
    expect(wsCount).toBe(0);
    // 意外断开 → 500ms 后重连
    first.onclose?.();
    await vi.advanceTimersByTimeAsync(600);
    expect(client.currentStatus).toBe('connecting');
    const second = client['ws'] as unknown as FakeWs;
    second.onopen?.();
    second.onmessage?.({ data: JSON.stringify({ type: 'auth_ok' }) });
    expect(reconnected).toHaveBeenCalledTimes(1);
    client.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
