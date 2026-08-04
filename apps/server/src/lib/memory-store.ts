/**
 * 记忆存储 pg 实现 —— 10.6 落库 / 10.7 相似检索 / 11.2 审计（注入 ai-graph MemoryExtractStore）。
 *
 * - 每个事务开头 set_config('request.jwt.claims')（AGENTS.md 第 4 条：应用层校验为主，RLS 纵深防御兜底）
 * - findSimilar：embedding 列就绪前用 精确匹配 + 子串 + FTS(ts_rank) 加权排序；
 *   嵌入服务到位后在 PgMemoryExtractStore 内切换 pgvector 余弦（10.7 HNSW 索引已建）
 */
import type {
  AuditEntry,
  ConfirmationDraft,
  MemoryExtractStore,
  PersistMemoryInput,
  SimilarMemory,
} from '@pet/ai-graph';
import type pg from 'pg';

import { rlsClaimsJson } from '../db/pool.js';

/** 自动保存记忆的默认命名空间（pet_id:scenario；10.5） */
const DEFAULT_NAMESPACE = 'star-isle:private_chat';

export class PgMemoryExtractStore implements MemoryExtractStore {
  constructor(private readonly pool: pg.Pool) {}

  async findSimilar(ownerUserId: string, value: string, topK: number): Promise<SimilarMemory[]> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        rlsClaimsJson(ownerUserId),
      ]);
      const { rows } = await client.query(
        `select memory_id, value, category, source_type
         from private_memories
         where owner_user_id = $1 and memory_status = 'active'
         order by (
           case
             when value = $2 then 3
             when value ilike '%' || $2 || '%' or $2 ilike '%' || value || '%' then 2
             when to_tsvector('simple', value) @@ plainto_tsquery('simple', $2) then 1
             else 0
           end
         ) desc, updated_at desc
         limit $3`,
        [ownerUserId, value, topK],
      );
      await client.query('commit');
      return rows.map((r) => ({
        memoryId: String(r.memory_id),
        value: String(r.value),
        category: String(r.category) as SimilarMemory['category'],
        sourceType: String(r.source_type) as SimilarMemory['sourceType'],
      }));
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async persistMemory(input: PersistMemoryInput): Promise<{ memoryId: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        rlsClaimsJson(input.ownerUserId),
      ]);
      const { rows } = await client.query(
        `insert into private_memories (
           owner_user_id, category, value, source_turn_ids, confidence, user_confirmed,
           sensitivity, visibility, purpose, importance, memory_status, superseded_by,
           source_type, namespace
         ) values ($1, $2, $3, $4, 1, false, $5, 'private', 'private_chat', $6, 'active', $7, $8, $9)
         returning memory_id`,
        [
          input.ownerUserId,
          input.category,
          input.value,
          input.sourceTurnIds,
          input.sensitivity,
          input.importance,
          input.supersedeMemoryId ?? null,
          input.sourceType,
          DEFAULT_NAMESPACE,
        ],
      );
      await client.query('commit');
      return { memoryId: String(rows[0]?.memory_id) };
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async invalidateMemory(ownerUserId: string, memoryId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        rlsClaimsJson(ownerUserId),
      ]);
      // 10.5 纠正=置失效不删除；应用层限定 owner，RLS 兜底
      await client.query(
        `update private_memories set memory_status = 'invalidated', updated_at = now()
         where memory_id = $1 and owner_user_id = $2 and memory_status = 'active'`,
        [memoryId, ownerUserId],
      );
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async createConfirmation(input: ConfirmationDraft): Promise<{ confirmationId: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        rlsClaimsJson(input.ownerUserId),
      ]);
      const { rows } = await client.query(
        `insert into memory_confirmations (
           owner_user_id, category, value, importance, source_type, sensitivity, source_turn_ids
         ) values ($1, $2, $3, $4, $5, $6, $7)
         returning confirmation_id`,
        [
          input.ownerUserId,
          input.category,
          input.value,
          input.importance,
          input.sourceType,
          input.sensitivity,
          input.sourceTurnIds,
        ],
      );
      await client.query('commit');
      return { confirmationId: String(rows[0]?.confirmation_id) };
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async logAudit(entry: AuditEntry): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        rlsClaimsJson(entry.ownerUserId),
      ]);
      await client.query(
        `insert into memory_audit_log (owner_user_id, action, memory_id, value, source_turn_ids)
         values ($1, $2, $3, $4, $5)`,
        [entry.ownerUserId, entry.action, entry.memoryId ?? null, entry.value, entry.sourceTurnIds],
      );
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }
}
