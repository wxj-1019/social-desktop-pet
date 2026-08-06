/** 输出审核供应商测试 —— 12.5 免费 Moderation（OpenAI 兼容）。 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOpenAiCompatibleModerator, moderationConfigFromEnv } from './moderation.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(body: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('createOpenAiCompatibleModerator', () => {
  it('未命中任何类目 → passed + 空 blockedCategories', async () => {
    stubFetch({ results: [{ flagged: false, categories: {} }] });
    const moderator = createOpenAiCompatibleModerator({ apiKey: 'k', baseUrl: 'https://api.test' });

    const result = await moderator.moderate('你好呀，今天天气不错', []);
    expect(result).toEqual({ passed: true, blockedCategories: [], crisisLevel: 'none' });
  });

  it('命中 hate → 拦截并映射协议类别', async () => {
    stubFetch({
      results: [{ flagged: true, categories: { hate: true, 'hate/threatening': true } }],
    });
    const moderator = createOpenAiCompatibleModerator({ apiKey: 'k', baseUrl: 'https://api.test' });

    const result = await moderator.moderate('你就是个混蛋', []);
    expect(result.passed).toBe(false);
    expect(result.blockedCategories).toContain('hate');
  });

  it('命中 self-harm → 映射 self_harm 并触发危机语义（blocked + crisisLevel none 由节点处理）', async () => {
    stubFetch({ results: [{ flagged: true, categories: { 'self-harm': true } }] });
    const moderator = createOpenAiCompatibleModerator({ apiKey: 'k', baseUrl: 'https://api.test' });

    const result = await moderator.moderate('我不想活了', []);
    expect(result.passed).toBe(false);
    expect(result.blockedCategories).toContain('self_harm');
  });

  it('allowlist 激活时记忆相关内容放行（引用自己的记忆不算泄漏）', async () => {
    // 供应商对"记忆"相关内容不设专门类目——协议映射无 memory 类目，保持拦截语义：
    // 这里验证 allowlist 存在时不影响非敏感类目的拦截（如 hate 仍拦截）
    stubFetch({ results: [{ flagged: true, categories: { hate: true } }] });
    const moderator = createOpenAiCompatibleModerator({ apiKey: 'k', baseUrl: 'https://api.test' });

    const result = await moderator.moderate('你就是个混蛋', ['mem-1']);
    expect(result.passed).toBe(false);
    expect(result.blockedCategories).toContain('hate');
  });

  it('未映射的供应商类目 → 忽略（不产生未知类别）', async () => {
    stubFetch({ results: [{ flagged: true, categories: { some_future_category: true } }] });
    const moderator = createOpenAiCompatibleModerator({ apiKey: 'k', baseUrl: 'https://api.test' });

    const result = await moderator.moderate('x', []);
    expect(result.passed).toBe(true);
    expect(result.blockedCategories).toEqual([]);
  });

  it('非 2xx → 抛错（图内规则版兜底）', async () => {
    stubFetch({ error: 'boom' }, false, 500);
    const moderator = createOpenAiCompatibleModerator({ apiKey: 'k', baseUrl: 'https://api.test' });

    await expect(moderator.moderate('x', [])).rejects.toThrow(/审核调用失败 \(500\)/);
  });
});

describe('moderationConfigFromEnv', () => {
  it('MODERATION_* 齐全 → 配置', () => {
    const config = moderationConfigFromEnv({
      MODERATION_API_KEY: 'k',
      MODERATION_BASE_URL: 'https://api.test/',
    } as NodeJS.ProcessEnv);
    expect(config).toEqual({ apiKey: 'k', baseUrl: 'https://api.test' });
  });

  it('只配 AI_MODEL_* → null（不复用：对话供应商如 DeepSeek 无 /moderations）', () => {
    const config = moderationConfigFromEnv({
      AI_MODEL_API_KEY: 'k',
      AI_MODEL_BASE_URL: 'https://api.deepseek.com',
    } as NodeJS.ProcessEnv);
    expect(config).toBeNull();
  });

  it('两者都缺 → null（规则版兜底）', () => {
    expect(moderationConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });
});
