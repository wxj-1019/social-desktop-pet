/**
 * Graph runtime 类型定义 —— loop engineering 的进阶：把 AI 流程建模为显式状态图。
 *
 * 设计参考 LangGraph（StateGraph / conditional edge / checkpointer），
 * 但依赖无关、约 300 LOC，可在 Deno（Edge Functions）/ Node（AI Worker）/ 浏览器（测试）三处复用。
 *
 * 价值（对应设计稿 11.2 / 13.5）：
 * - 可观测：每个节点 = 一次 span，自动产出检索/写入审计日志
 * - 可重放：checkpoint 持久化 → 泄漏取证可回放（13.5 发布阻断）
 * - 可恢复：长时子图（如记忆抽取）断点续跑
 * - 人在回路：HITL 中断点（D-3 记忆确认）
 */

/** 状态键（state key）。用 symbol 避免与用户状态字段冲突。 */
export const STATE_KEYS = {
  VALUES: Symbol('values'),
} as const;

/** 节点名 */
export type NodeName = string;

/** 节点函数：输入当前状态，返回要合并进状态的增量。纯函数优先。 */
export type NodeFn<S extends object> = (state: S, ctx: GraphRunContext) => Promise<Partial<S>>;

/** 条件函数：输入状态，返回下一个要走的节点名（或 END） */
export type ConditionFn<S extends object> = (state: S) => NodeName | typeof END;

/** 图执行上下文：注入可观测、checkpoint、中断、流式回调 */
export interface GraphRunContext {
  /** 当前执行线程标识（用于 checkpoint 关联） */
  threadId: string;
  /** 信号：中止当前图执行 */
  signal?: AbortSignal;
  /** 流式回调（用于 SSE token 推流 / span 事件） */
  emit: (event: GraphEvent) => void;
}

/** 流式/可观测事件 */
export type GraphEvent =
  | { type: 'node_start'; node: NodeName; timestamp: number }
  | { type: 'node_end'; node: NodeName; timestamp: number; durationMs: number }
  | { type: 'token'; text: string } // 生成节点的 token 流
  | { type: 'stream'; chunk: unknown } // 任意流式分片
  | { type: 'interrupt'; node: NodeName; reason: string } // HITL 中断
  | { type: 'checkpoint'; node: NodeName; stateVersion: number };

/** 图终点标记 */
export const END = '__END__' as const;
export const START = '__START__' as const;

/** Checkpointer 接口：持久化图状态（11.2 审计 + 13.5 回放） */
export interface Checkpointer<S extends object> {
  save(threadId: string, node: NodeName, state: S): Promise<void>;
  load(threadId: string): Promise<{ node: NodeName; state: S } | null>;
  list(threadId: string): Promise<Array<{ node: NodeName; state: S; savedAt: number }>>;
}

/** 内存 Checkpointer（默认；生产用 Postgres 实现见 checkpoint/postgres.ts） */
export class MemoryCheckpointer<S extends object> implements Checkpointer<S> {
  private store = new Map<string, Array<{ node: NodeName; state: S; savedAt: number }>>();

  async save(threadId: string, node: NodeName, state: S): Promise<void> {
    const arr = this.store.get(threadId) ?? [];
    arr.push({ node, state, savedAt: Date.now() });
    this.store.set(threadId, arr);
  }
  async load(threadId: string) {
    const arr = this.store.get(threadId);
    if (!arr || arr.length === 0) return null;
    const last = arr[arr.length - 1]!;
    return { node: last.node, state: last.state };
  }
  async list(threadId: string) {
    return this.store.get(threadId) ?? [];
  }
}
