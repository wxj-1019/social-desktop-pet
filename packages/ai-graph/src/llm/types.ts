/**
 * LLM 客户端抽象 —— 10.1 generateNode 的模型调用接口。
 *
 * 依赖无关（ai-graph 可在 Deno/Node/浏览器复用）：实现由宿主注入
 * （apps/server/src/ai/llm.ts 提供 OpenAI 兼容实现；密钥只存服务端环境变量，8.3）。
 * 未注入时 generateNode 降级为骨架回复（框架阶段行为不变）。
 */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmClient {
  /**
   * 流式对话：token 经 onToken 回调逐片返回，resolve 完整文本。
   * @param messages 对话消息（10.4 人格 system prompt 由调用方构造）
   */
  streamChat(messages: LlmMessage[], onToken: (token: string) => void): Promise<string>;
}
