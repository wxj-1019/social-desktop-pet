/**
 * 记忆抽取异步触发 —— 10.6。
 *
 * chat 流式完成后 fire-and-forget 调用：从 chat_messages 取 owner 本人最近
 * 4 条 user 消息（含当前 turn），跑 memory-extract 图（抽取→注入过滤→去重→
 * 分级确认→落库/确认队列）。任何失败只记日志，绝不阻塞/影响已流式的回复。
 */
import type pg from 'pg';

import { buildMemoryExtractFlow } from '@pet/ai-graph';
import type { LlmClient, MemoryExtractStore } from '@pet/ai-graph';
import { DEFAULT_FEATURE_FLAGS } from '@pet/config';

export interface RunMemoryExtractInput {
  userId: string;
  threadId: string;
  pool: pg.Pool;
  store: MemoryExtractStore;
  llm?: LlmClient;
}

/** 抽取上下文：当前 turn + 最近 3 条历史 user 消息（owner 本人，10.6 校验） */
const OWNER_TURN_LIMIT = 4;

export async function runMemoryExtract(input: RunMemoryExtractInput): Promise<void> {
  const { userId, threadId, pool, store, llm } = input;

  // 仅取 owner 本人、当前 thread 的 user 消息（source_turn_ids 溯源；
  // thread_id 过滤防跨线程污染，assistant/他人消息不进入抽取）
  const { rows } = await pool.query(
    `select message_id, content, memory_extracted_at from chat_messages
     where user_id = $1 and thread_id = $2 and role = 'user'
     order by created_at desc
     limit $3`,
    [userId, threadId, OWNER_TURN_LIMIT],
  );
  if (rows.length === 0) return;
  // 时间倒序 → 正序（最早在前）
  const turns = rows.map((r) => String(r.content)).reverse();
  const sourceTurnIds = rows.map((r) => String(r.message_id)).reverse();
  // 幂等 + 并发安全：原子抢占"最新一条 user turn"的抽取标记——
  // 连发消息时两次 fire-and-forget 并发触发，只有抢到标记的一方执行抽取，
  // 另一方直接返回（10.6 每条消息只抽一次；防重复 ADD）。
  const latestId = sourceTurnIds[sourceTurnIds.length - 1];
  const claimed = await pool.query(
    `update chat_messages set memory_extracted_at = now()
     where message_id = $1 and memory_extracted_at is null
     returning message_id`,
    [latestId],
  );
  if (claimed.rows.length === 0) return; // 已被并发调用标记/处理

  const graph = buildMemoryExtractFlow({
    llm,
    store,
    memoryConfirmation: DEFAULT_FEATURE_FLAGS.memoryConfirmation, // D-3 分级确认
  });

  const finalState = await graph.invoke(
    {
      threadId,
      ownerUserId: userId,
      ownerTurns: turns,
      sourceTurnIds,
      persistedCount: 0,
    },
    { threadId },
  );

  const { persistedCount, pendingConfirmation } = finalState;
  console.info(
    `[memory] thread=${threadId.slice(0, 8)} user=${userId.slice(0, 8)} ` +
      `candidates=${finalState.candidates?.length ?? 0} persisted=${persistedCount} ` +
      `pendingConfirm=${pendingConfirmation?.length ?? 0}`,
  );
}
