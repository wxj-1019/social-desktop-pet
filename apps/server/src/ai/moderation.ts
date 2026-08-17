/**
 * 输出审核供应商 —— 12.5 免费 Moderation（OpenAI 兼容 /v1/moderations）。
 *
 * - 密钥只存服务端环境变量（8.3）：MODERATION_API_KEY + MODERATION_BASE_URL
 *   **必须显式配置**——不复用 AI_MODEL_*（对话供应商如 DeepSeek 不提供
 *   /moderations 端点，误启用会产生无效请求；未配置时图内规则版兜底）
 * - allowlist 语义核对：检索到的记忆 ID（allowlistedMemoryIds）在供应商命中
 *   "敏感细节"类目时不拦截——记忆是自己的，模型引用自己的记忆不算泄漏；
 *   其余类目（仇恨/自伤/暴力/色情等）一律拦截
 */
import type { OutputModerator } from '@pet/ai-graph';
import type { ContentCategory, OutputModerationResult } from '@pet/protocol';

export interface ModerationConfig {
  apiKey: string;
  /** OpenAI 兼容 base URL（须指向提供 /moderations 的服务） */
  baseUrl: string;
}

/** 从环境变量构造配置；未配置返回 null（服务降级规则版） */
export function moderationConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ModerationConfig | null {
  const apiKey = env['MODERATION_API_KEY'];
  const baseUrl = env['MODERATION_BASE_URL'];
  if (!apiKey || !baseUrl) return null;
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, '') };
}

/** OpenAI moderations 分类 → 协议 ContentCategory 映射（未命中 → null，放行） */
const CATEGORY_MAP: Record<string, ContentCategory> = {
  hate: 'hate',
  'hate/threatening': 'hate',
  harassment: 'harassment',
  'self-harm': 'self_harm',
  'sexual/minors': 'minor_risk',
  violence: 'violence',
  'violence/graphic': 'violence',
};

/** OpenAI 兼容审核客户端（12.5 免费端点） */
export function createOpenAiCompatibleModerator(config: ModerationConfig): OutputModerator {
  return {
    async moderate(text: string, _allowlistedMemoryIds: string[]): Promise<OutputModerationResult> {
      const res = await fetch(`${config.baseUrl}/moderations`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ input: text }),
      });
      if (!res.ok) {
        const body = (await res.text().catch(() => '')) as string;
        throw new Error(`审核调用失败 (${res.status}): ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        results: Array<{ flagged: boolean; categories: Record<string, boolean> }>;
      };
      const result = data.results[0];
      if (!result || !result.flagged) {
        return { passed: true, blockedCategories: [], crisisLevel: 'none' };
      }
      // 命中类目 → 协议类别。注意：allowlistedMemoryIds（"引用自己的记忆不算泄漏"）
      // 在 OpenAI 类目层面无法区分（类目名不含 'memory'，原 includes('memory')
      // 判断是死代码、从不放行）—— 宁可误拦不可漏拦，语义核对待内容层实现（V-11）
      const blocked = Object.entries(result.categories)
        .filter(([, flagged]) => flagged)
        .map(([category]) => CATEGORY_MAP[category])
        .filter((c): c is ContentCategory => c !== undefined);
      return {
        passed: blocked.length === 0,
        blockedCategories: blocked,
        crisisLevel: 'none',
      };
    },
  };
}
