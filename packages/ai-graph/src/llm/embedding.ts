/**
 * 嵌入客户端接口 —— 10.7 向量检索臂的模型供应商接入点。
 *
 * 与 LlmClient 并列（都是模型供应商接入）；服务端 pg store 注入实现后：
 * - persistMemory 落库时生成 embedding（无 provider → embedding=null，FTS-only）
 * - recallMemories 检索时生成查询向量（无 provider → 跳过向量臂，RRF 单臂退化）
 */
export interface EmbeddingProvider {
  /** 批量生成文本向量（返回与输入同序的向量数组） */
  embed(texts: string[]): Promise<number[][]>;
}
