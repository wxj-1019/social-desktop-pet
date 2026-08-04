/**
 * API client（渲染进程）—— chatStream done 帧 → 完整 ModelOutput（Task 11）。
 * done 帧必须是 dialogue/emotion/actionIntent/intensity 四字段（strict），
 * 缺失/越界/多余字段一律 onError('模型回复格式无效') 且不调 onDone。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from './client.js';

const encoder = new TextEncoder();

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** 构造一个只含给定 SSE 帧的 200 响应流 */
function sseResponse(...frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api.chatStream done 帧 → 完整 ModelOutput', () => {
  it('四字段完整 done 帧把完整 ModelOutput 传给 onDone', async () => {
    vi.stubGlobal('window', { pet: { getApiBase: async () => 'http://api.test' } });
    const onDone = vi.fn();
    const onError = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse(
          sseFrame('token', { text: '你' }),
          sseFrame('done', {
            dialogue: '你好呀！今天真开心',
            emotion: 'warm',
            actionIntent: 'nod',
            intensity: 3,
          }),
        ),
      ),
    );

    await api.chatStream('你好', { onToken: () => undefined, onDone, onError });

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith({
      dialogue: '你好呀！今天真开心',
      emotion: 'warm',
      actionIntent: 'nod',
      intensity: 3,
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('intensity 越界（9）的 done 帧 → onError 且不调 onDone', async () => {
    vi.stubGlobal('window', { pet: { getApiBase: async () => 'http://api.test' } });
    const onDone = vi.fn();
    const onError = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse(
          sseFrame('done', { dialogue: '嗯', emotion: 'warm', actionIntent: 'nod', intensity: 9 }),
        ),
      ),
    );

    await api.chatStream('hi', { onToken: () => undefined, onDone, onError });

    expect(onError).toHaveBeenCalledWith('模型回复格式无效');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('多余字段的 done 帧（strict 拒绝）→ onError 且不调 onDone', async () => {
    vi.stubGlobal('window', { pet: { getApiBase: async () => 'http://api.test' } });
    const onDone = vi.fn();
    const onError = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse(
          sseFrame('done', {
            dialogue: '嗯',
            emotion: 'warm',
            actionIntent: 'nod',
            intensity: 2,
            extra: '不许有',
          }),
        ),
      ),
    );

    await api.chatStream('hi', { onToken: () => undefined, onDone, onError });

    expect(onError).toHaveBeenCalledWith('模型回复格式无效');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('流中途断开（无 done 帧）不会永久卡住', async () => {
    vi.stubGlobal('window', { pet: { getApiBase: async () => 'http://api.test' } });
    const onDone = vi.fn();
    const onError = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse(sseFrame('token', { text: '部分内容' }))),
    );

    await expect(
      api.chatStream('hi', { onToken: () => undefined, onDone, onError }),
    ).resolves.toBeUndefined();
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('api 记忆接口（10.6 / D-3 确认队列）', () => {
  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200 });
  }

  it('memorySummary 解析 pending + recentlySaved 契约字段', async () => {
    vi.stubGlobal('window', { pet: { getApiBase: async () => 'http://api.test' } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          pending: [
            {
              confirmationId: '99999999-9999-4999-8999-999999999999',
              category: 'fact',
              value: '我有糖尿病',
              importance: 7,
              sourceType: 'user_stated',
              sensitivity: 'high',
              sourceTurnIds: ['11111111-1111-4111-8111-111111111111'],
              createdAt: '2026-08-03T10:00:00.000Z',
            },
          ],
          recentlySaved: [
            {
              memoryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              value: '我喜欢抹茶',
              savedAt: '2026-08-03T10:00:30.000Z',
            },
          ],
        }),
      ),
    );

    const summary = await api.memorySummary();
    expect(summary.pending[0]?.confirmationId).toBe('99999999-9999-4999-8999-999999999999');
    expect(summary.pending[0]?.sensitivity).toBe('high');
    expect(summary.recentlySaved[0]?.value).toBe('我喜欢抹茶');
  });

  it('confirmMemory 可携带修改值（POST /memories/confirm）', async () => {
    vi.stubGlobal('window', { pet: { getApiBase: async () => 'http://api.test' } });
    const fetchMock = vi.fn(async () => jsonResponse({ memoryId: 'm-9' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.confirmMemory('c-1', '我有二型糖尿病');
    expect(result.memoryId).toBe('m-9');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/memories/confirm');
    expect(JSON.parse(String(init.body))).toEqual({
      confirmationId: 'c-1',
      value: '我有二型糖尿病',
    });
  });

  it('rejectMemory / invalidateMemory 走对应端点', async () => {
    vi.stubGlobal('window', { pet: { getApiBase: async () => 'http://api.test' } });
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await api.rejectMemory('c-2');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/memories/reject');
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      confirmationId: 'c-2',
    });

    await api.invalidateMemory('m-1');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/memories/m-1/invalidate');
  });
});
