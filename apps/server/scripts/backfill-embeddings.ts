/**
 * 历史记忆 embedding 回填 —— 10.7 向量臂启用前的离线任务。
 *
 * 用法（需 .env.local 配置 EMBEDDING_MODEL 等）：
 *   pnpm --filter @pet/server backfill-embeddings
 *
 * 扫描所有 embedding is null 的 active 记忆（含确认卡/编辑产生的记忆），
 * 分批（32 条/批）生成向量并落库；幂等——重跑只补剩余缺失。
 */
import { pathToFileURL } from 'node:url';

import pg from 'pg';

import {
  embeddingConfigFromEnv,
  createOpenAiCompatibleEmbeddingClient,
} from '../src/ai/embedding.js';

const BATCH_SIZE = 32;

async function main(): Promise<void> {
  const config = embeddingConfigFromEnv();
  if (!config) {
    console.error('[backfill] 未配置嵌入服务（EMBEDDING_API_KEY/BASE_URL/MODEL）——跳过');
    process.exitCode = 1;
    return;
  }
  const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
  const embedder = createOpenAiCompatibleEmbeddingClient(config);

  try {
    let total = 0;
    for (;;) {
      const { rows } = await pool.query(
        `select memory_id, value from private_memories
         where embedding is null and memory_status = 'active'
         order by created_at asc
         limit $1`,
        [BATCH_SIZE],
      );
      if (rows.length === 0) break;
      const vectors = await embedder.embed(rows.map((r) => String(r.value)));
      for (let i = 0; i < rows.length; i++) {
        const vec = vectors[i];
        if (!vec) continue;
        await pool.query(
          `update private_memories set embedding = $2::vector where memory_id = $1`,
          [String(rows[i].memory_id), JSON.stringify(vec)],
        );
      }
      total += rows.length;
      console.info(`[backfill] +${rows.length}（累计 ${total}）`);
    }
    console.info(`[backfill] 完成：共回填 ${total} 条记忆`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

// 供测试直接调用
export { main as backfillEmbeddings };
