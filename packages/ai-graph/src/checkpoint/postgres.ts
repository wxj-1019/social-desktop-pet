/**
 * Postgres Checkpointer —— 对应设计稿 11.2 审计日志 + 13.5 发布阻断取证回放。
 *
 * 把图状态写入 Postgres：
 * - 既是 HITL 中断后恢复的源
 * - 也是泄漏事件发生后的回放取证源（13.5：发现一例即阻断，需能回放定位）
 *
 * 实现：依赖一个 graph_checkpoints(thread_id, node, state, saved_at) 表。
 * 框架阶段提供接口与 SQL；具体连接由调用方注入。
 */
import type { Checkpointer, NodeName } from '../runtime/types.js';

export interface PostgresClient {
  query<T = unknown>(sql: string, params: unknown[]): Promise<T[]>;
}

export class PostgresCheckpointer<S extends object> implements Checkpointer<S> {
  constructor(private db: PostgresClient) {}

  async save(threadId: string, node: NodeName, state: S): Promise<void> {
    await this.db.query(
      `insert into graph_checkpoints (thread_id, node, state, saved_at)
       values ($1, $2, $3, now())`,
      [threadId, node, JSON.stringify(state)],
    );
  }

  async load(threadId: string) {
    const rows = await this.db.query<{ node: string; state: string }>(
      `select node, state from graph_checkpoints
       where thread_id = $1 order by saved_at desc limit 1`,
      [threadId],
    );
    const last = rows[0];
    if (!last) return null;
    return { node: last.node as NodeName, state: JSON.parse(last.state) as S };
  }

  async list(threadId: string) {
    const rows = await this.db.query<{ node: string; state: string; saved_at: string }>(
      `select node, state, saved_at from graph_checkpoints
       where thread_id = $1 order by saved_at asc`,
      [threadId],
    );
    return rows.map((r) => ({
      node: r.node as NodeName,
      state: JSON.parse(r.state) as S,
      savedAt: new Date(r.saved_at).getTime(),
    }));
  }
}

/** 建表 SQL（纳入 migrations） */
export const CHECKPOINT_DDL = /* sql */ `
create table if not exists graph_checkpoints (
  thread_id   text        not null,
  node        text        not null,
  state       jsonb       not null,
  saved_at    timestamptz not null default now()
);
create index if not exists graph_checkpoints_thread_idx on graph_checkpoints (thread_id, saved_at);
`;
