/**
 * callLocalLlm —— OpenAI 兼容 /chat/completions 调用单测（fetch stub）。
 * 覆盖：成功解析与截断、HTTP 错误信封、空回复、异常信封。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { callLocalLlm } from './local-llm-chat.js';

const CONFIG = {
  enabled: true,
  baseUrl: 'https://llm.example.com/v1/',
  apiKey: 'sk-test',
  model: 'test-model',
} as const;

const MESSAGES = [{ role: 'user' as const, content: '你好' }];

function stubFetch(impl: () => Promise<unknown>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callLocalLlm（Main 侧 OpenAI 兼容调用）', () => {
  it('posts to {baseUrl}/chat/completions with bearer key and returns reply', async () => {
    const fetchMock = stubFetch(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: ' 嗨～我在呢 ' } }] }), {
          status: 200,
        }),
    );

    const result = await callLocalLlm(CONFIG, MESSAGES);

    expect(result).toEqual({ reply: '嗨～我在呢' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // 尾斜杠归一化
    expect(url).toBe('https://llm.example.com/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');
    expect(JSON.parse(String(init.body)).model).toBe('test-model');
  });

  it('returns an error envelope on HTTP failure', async () => {
    stubFetch(async () => new Response('nope', { status: 401 }));

    const result = await callLocalLlm(CONFIG, MESSAGES);

    expect('error' in result && result.error).toContain('401');
  });

  it('returns empty_reply when choices content is missing/blank', async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: {} }] }), {
          status: 200,
        }),
    );

    const result = await callLocalLlm(CONFIG, MESSAGES);

    expect(result).toEqual({ error: 'empty_reply' });
  });

  it('returns a network error envelope when fetch throws', async () => {
    stubFetch(async () => {
      throw new Error('boom');
    });

    const result = await callLocalLlm(CONFIG, MESSAGES);

    expect(result).toEqual({ error: 'boom' });
  });

  it('caps reply length to protect bubble/history', async () => {
    const long = '呀'.repeat(2000);
    stubFetch(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: long } }] }), {
          status: 200,
        }),
    );

    const result = await callLocalLlm(CONFIG, MESSAGES);

    expect('reply' in result ? result.reply.length : 0).toBeLessThanOrEqual(1000);
  });
});
