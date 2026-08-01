/**
 * OpenAI 兼容 LLM 客户端 —— 10.1 generateNode 的真实模型实现（服务端）。
 *
 * - 密钥只存服务端环境变量（8.3）：AI_MODEL_API_KEY
 * - 兼容 OpenAI /chat/completions 协议（GLM-4-Flash、DeepSeek、Qwen 等均兼容）
 * - 流式：stream:true → SSE delta 逐片回调
 *
 * 模型选型建议（预算约束）：
 *   AI_MODEL_BASE_URL=https://open.bigmodel.cn/api/paas/v4  AI_MODEL_NAME=glm-4-flash（免费档）
 *   AI_MODEL_BASE_URL=https://api.deepseek.com  AI_MODEL_NAME=deepseek-chat
 */
import type { LlmClient, LlmMessage } from '@pet/ai-graph';

export interface LlmConfig {
  /** 模型供应商密钥（绝不进客户端，8.3） */
  apiKey: string;
  /** OpenAI 兼容 base URL（如 https://api.deepseek.com） */
  baseUrl: string;
  /** 模型名（如 glm-4-flash / deepseek-chat） */
  model: string;
}

/** 从环境变量构造配置；未配置返回 null（服务降级为骨架回复） */
export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const apiKey = env['AI_MODEL_API_KEY'];
  const baseUrl = env['AI_MODEL_BASE_URL'];
  const model = env['AI_MODEL_NAME'];
  if (!apiKey || !baseUrl || !model) return null;
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, ''), model };
}

/** OpenAI 兼容客户端 */
export function createOpenAiCompatibleClient(config: LlmConfig): LlmClient {
  return {
    async streamChat(messages: LlmMessage[], onToken: (token: string) => void): Promise<string> {
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: true,
          temperature: 0.7,
          max_tokens: 300,
        }),
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => '')) as string;
        throw new Error(`模型调用失败 (${res.status}): ${body.slice(0, 200)}`);
      }
      if (!res.body) throw new Error('模型响应无流');

      // 解析 SSE：data: {...}\n\n；delta.content 逐片回调
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) !== -1) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const dataLine = block
              .split('\n')
              .find((l) => l.startsWith('data:'))
              ?.slice(5)
              .trim();
            if (!dataLine || dataLine === '[DONE]') continue;
            const parsed = JSON.parse(dataLine) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              full += delta;
              onToken(delta);
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      return full;
    },
  };
}
