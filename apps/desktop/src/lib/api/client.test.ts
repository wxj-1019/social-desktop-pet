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
