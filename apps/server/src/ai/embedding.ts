/**
 * OpenAI 兼容嵌入客户端 —— 10.7 向量检索臂（服务端）。
 *
 * - 密钥只存服务端环境变量（8.3）：EMBEDDING_API_KEY（缺省复用 AI_MODEL_API_KEY）
 * - 兼容 /embeddings 协议（OpenAI / GLM / Qwen 等均兼容）
 * - 未配置时返回 undefined → 记忆 store 降级 FTS-only（RRF 单臂，检索语义不变）
 */
import type { EmbeddingProvider } from '@pet/ai-graph';

export interface EmbeddingConfig {
  apiKey: string;
  /** OpenAI 兼容 base URL（缺省复用 AI_MODEL_BASE_URL） */
  baseUrl: string;
  /** 模型名（如 text-embedding-3-small / embedding-2） */
  model: string;
}

/** 从环境变量构造配置；未配置返回 null（服务降级 FTS-only） */
export function embeddingConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingConfig | null {
  const apiKey = env['EMBEDDING_API_KEY'] ?? env['AI_MODEL_API_KEY'];
  const baseUrl = env['EMBEDDING_BASE_URL'] ?? env['AI_MODEL_BASE_URL'];
  const model = env['EMBEDDING_MODEL'];
  if (!apiKey || !baseUrl || !model) return null;
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, ''), model };
}

/** OpenAI 兼容嵌入客户端（默认 8s 超时：嵌入正常远快于此；事务内调用（确认/编辑
 *  落库补向量）长占连接会拖垮连接池，供应商故障时 8s 封顶、降级 FTS-only 由回填脚本兜底） */
export function createOpenAiCompatibleEmbeddingClient(
  config: EmbeddingConfig,
  timeoutMs = 8_000,
): EmbeddingProvider {
  return {
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) return [];
      const res = await fetch(`${config.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({ model: config.model, input: texts }),
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => '')) as string;
        throw new Error(`嵌入调用失败 (${res.status}): ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        data: Array<{ embedding: number[] }>;
      };
      // 供应商返回序与输入序一致（协议约定）；异常时由调用方兜底
      return data.data.map((d) => d.embedding);
    },
  };
}
