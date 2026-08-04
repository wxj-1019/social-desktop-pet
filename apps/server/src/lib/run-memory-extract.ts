/**
 * 记忆抽取异步触发 —— 10.6。
 *
 * chat 流式完成后 fire-and-forget 调用：从 chat_messages 取 owner 本人最近
 * 4 条 user 消息（含当前 turn），跑 memory-extract 图（抽取→注入过滤→去重→
 * 分级确认→落库/确认队列）。任何失败只记日志，绝不阻塞/影响已流式的回复。
 */
import { buildMemoryExtractFlow } from '@pet/ai-graph';
import type { LlmClient, MemoryExtractStore } from '@pet/ai-graph';
import { DEFAULT_FEATURE_FLAGS } from '@pet/config';
import type pg from 'pg';

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

  // 仅取 owner 本人 user 消息（source_turn_ids 溯源；assistant/他人消息不进入抽取）
  const { rows } = await pool.query(
    `select message_id, content, memory_extracted_at from chat_messages
     where user_id = $1 and role = 'user'
     order by created_at desc
     limit $2`,
    [userId, OWNER_TURN_LIMIT],
  );
  // 幂等：最新一条 user turn 已抽取过（memory_extracted_at 标记）→ 该窗口已处理，
  // 跳过。避免连发消息时重叠窗口反复触发 LLM 抽取（10.6 每条消息只抽一次）。
  if (rows.length === 0 || rows[0].memory_extracted_at !== null) return;
  // 时间倒序 → 正序（最早在前）
  const turns = rows.map((r) => String(r.content)).reverse();
  const sourceTurnIds = rows.map((r) => String(r.message_id)).reverse();

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

  // 抽取完成（结果为空/全 NOOP 也算处理过）→ 标记窗口，防重复触发
  await pool.query(
    `update chat_messages set memory_extracted_at = now()
     where message_id = any($1::uuid[])`,
    [sourceTurnIds],
  );

  const { persistedCount, pendingConfirmation } = finalState;
  console.info(
    `[memory] thread=${threadId.slice(0, 8)} user=${userId.slice(0, 8)} ` +
      `candidates=${finalState.candidates?.length ?? 0} persisted=${persistedCount} ` +
      `pendingConfirm=${pendingConfirmation?.length ?? 0}`,
  );
}
