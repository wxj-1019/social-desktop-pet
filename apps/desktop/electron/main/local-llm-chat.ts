/**
 * local-llm-chat —— Main 侧 OpenAI 兼容 /chat/completions 调用（BYOK）。
 *
 * 在 Main 进程发请求：密钥不出主进程、不受渲染层 CSP connect-src 限制。
 * 统一 { reply } | { error } 信封；30s 超时；回复截断到 1000 字（本地闲聊够用，
 * 也避免异常端点返回超大文本撑爆气泡/历史）。
 */
import type { LocalLlmChatMessage, LocalLlmConfig } from '@pet/protocol';

const TIMEOUT_MS = 30_000;
const MAX_REPLY_CHARS = 1000;

export type LocalLlmChatResult = { reply: string } | { error: string };

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

export async function callLocalLlm(
  config: LocalLlmConfig,
  messages: LocalLlmChatMessage[],
): Promise<LocalLlmChatResult> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.8,
        max_tokens: 512,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { error: `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}` };
    }
    const data = (await res.json()) as OpenAiChatResponse;
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') {
      return { error: 'empty_reply' };
    }
    return { reply: content.trim().slice(0, MAX_REPLY_CHARS) };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { error: 'timeout' };
    }
    return { error: err instanceof Error ? err.message : 'network_error' };
  } finally {
    clearTimeout(timer);
  }
}
