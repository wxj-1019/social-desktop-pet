/**
 * 嵌入客户端测试 —— 10.7 向量臂的服务端实现（OpenAI 兼容协议）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpenAiCompatibleEmbeddingClient, embeddingConfigFromEnv } from './embedding.js';

const CONFIG = {
  apiKey: 'test-key',
  baseUrl: 'https://embed.example.com/v1',
  model: 'text-embedding-3-small',
};

describe('createOpenAiCompatibleEmbeddingClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POST /embeddings 并按输入序返回向量', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createOpenAiCompatibleEmbeddingClient(CONFIG);
    const vectors = await client.embed(['我喜欢抹茶', '我在准备考试']);

    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://embed.example.com/v1/embeddings');
    expect(init.headers).toMatchObject({ authorization: 'Bearer test-key' });
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'text-embedding-3-small',
      input: ['我喜欢抹茶', '我在准备考试'],
    });
  });

  it('空输入直接返回空数组（不发请求）', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = createOpenAiCompatibleEmbeddingClient(CONFIG);
    expect(await client.embed([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('非 2xx → 抛错（调用方降级 FTS-only）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => 'unauthorized',
      })),
    );
    const client = createOpenAiCompatibleEmbeddingClient(CONFIG);
    await expect(client.embed(['x'])).rejects.toThrow('嵌入调用失败 (401)');
  });
});

describe('embeddingConfigFromEnv', () => {
  it('EMBEDDING_* 齐全 → 配置；缺任一 → null（FTS-only 降级）', () => {
    const env = {
      EMBEDDING_API_KEY: 'k',
      EMBEDDING_BASE_URL: 'https://e.example.com/',
      EMBEDDING_MODEL: 'm',
    } as NodeJS.ProcessEnv;
    const config = embeddingConfigFromEnv(env);
    expect(config).toEqual({
      apiKey: 'k',
      baseUrl: 'https://e.example.com',
      model: 'm',
    });
    expect(embeddingConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(
      embeddingConfigFromEnv({
        AI_MODEL_API_KEY: 'k',
        AI_MODEL_BASE_URL: 'b',
      } as NodeJS.ProcessEnv),
    ).toBeNull();
  });

  it('缺省复用 AI_MODEL_*（与对话同供应商）', () => {
    const config = embeddingConfigFromEnv({
      AI_MODEL_API_KEY: 'k',
      AI_MODEL_BASE_URL: 'https://api.deepseek.com',
      EMBEDDING_MODEL: 'm',
    } as NodeJS.ProcessEnv);
    expect(config).toEqual({
      apiKey: 'k',
      baseUrl: 'https://api.deepseek.com',
      model: 'm',
    });
  });
});
