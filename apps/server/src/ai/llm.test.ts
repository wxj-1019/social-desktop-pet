import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpenAiCompatibleClient, llmConfigFromEnv } from './llm.js';

/** 构造 OpenAI 兼容 SSE 响应体（delta 流） */
function sseBody(deltas: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = deltas.map((d) =>
    encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`),
  );
  chunks.push(encoder.encode('data: [DONE]\n\n'));
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

describe('llmConfigFromEnv（8.3 密钥只存服务端环境变量）', () => {
  it('returns null when key/base/model missing (chat 降级骨架)', () => {
    expect(llmConfigFromEnv({})).toBeNull();
    expect(llmConfigFromEnv({ AI_MODEL_API_KEY: 'k' })).toBeNull();
  });

  it('parses full config and strips trailing slash', () => {
    const cfg = llmConfigFromEnv({
      AI_MODEL_API_KEY: 'secret',
      AI_MODEL_BASE_URL: 'https://api.deepseek.com/',
      AI_MODEL_NAME: 'deepseek-chat',
    });
    expect(cfg).toEqual({
      apiKey: 'secret',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    });
  });
});

describe('createOpenAiCompatibleClient（流式 SSE delta 解析）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('streams deltas via onToken and resolves full text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        body: sseBody(['你', '好', '呀']),
      })),
    );
    const client = createOpenAiCompatibleClient({
      apiKey: 'k',
      baseUrl: 'https://api.example.com',
      model: 'm',
    });
    const tokens: string[] = [];
    const full = await client.streamChat([{ role: 'user', content: 'hi' }], (t) => tokens.push(t));
    expect(tokens).toEqual(['你', '好', '呀']);
    expect(full).toBe('你好呀');
  });

  it('handles deltas split across chunks (跨 chunk 缓冲)', async () => {
    const encoder = new TextEncoder();
    const partial = encoder.encode('data: {"choices":[{"delta":{"content":"你');
    const rest = encoder.encode('好"}}]}\n\ndata: [DONE]\n\n');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(partial);
            controller.enqueue(rest);
            controller.close();
          },
        }),
      })),
    );
    const client = createOpenAiCompatibleClient({
      apiKey: 'k',
      baseUrl: 'https://api.example.com',
      model: 'm',
    });
    const tokens: string[] = [];
    const full = await client.streamChat([], (t) => tokens.push(t));
    expect(full).toBe('你好');
  });

  it('propagates non-ok responses as errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, text: async () => 'unauthorized' })),
    );
    const client = createOpenAiCompatibleClient({
      apiKey: 'bad',
      baseUrl: 'https://api.example.com',
      model: 'm',
    });
    await expect(client.streamChat([], () => undefined)).rejects.toThrow('401');
  });
});
