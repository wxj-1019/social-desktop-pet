/**
 * 记忆存储 pg 实现 —— 10.6 落库 / 10.7 检索（hybrid 召回）/ 11.2 审计
 * （注入 ai-graph MemoryExtractStore + MemoryRetrievalStore，同一实例双接口）。
 *
 * - 每个事务开头 set_config('request.jwt.claims')（AGENTS.md 第 4 条：应用层校验为主，RLS 纵深防御兜底）
 * - findSimilar：embedding 列就绪前用 精确匹配 + 子串 + FTS(ts_rank) 加权排序（去重裁决用）
 * - recallMemories：10.7 hybrid 召回（权限过滤 → FTS 臂 + 向量臂），打分在 ai-graph 纯函数完成
 */
import type {
  AuditEntry,
  ConfirmationDraft,
  EmbeddingProvider,
  MemoryExtractStore,
  MemoryRetrievalStore,
  MemorySearchInput,
  PersistMemoryInput,
  RetrievedMemory,
  SimilarMemory,
} from '@pet/ai-graph';
import type pg from 'pg';

import { rlsClaimsJson } from '../db/pool.js';

/** 自动保存记忆的默认命名空间（pet_id:scenario；10.5） */
const DEFAULT_NAMESPACE = 'star-isle:private_chat';

/**
 * 场景 → 可见性范围（10.7 权限过滤：friend_visit 不可见私人记忆；
 * bond 记忆需双人确认，接入后扩展）。
 */
function visibilityScope(purpose: MemorySearchInput['purpose']): string[] {
  return purpose === 'friend_visit' ? ['public_profile'] : ['private', 'public_profile'];
}

/** 每臂召回上限（RRF 需要足够排名；top-k 6 → 召回 20 足够） */
const RECALL_ARM_LIMIT = 20;

export class PgMemoryExtractStore implements MemoryExtractStore, MemoryRetrievalStore {
  constructor(
    private readonly pool: pg.Pool,
    /** 嵌入 provider（10.7 向量臂；无 → FTS-only 降级，RRF 单臂语义不变） */
    private readonly embeddingProvider?: EmbeddingProvider,
  ) {}

  /** 生成查询向量（provider 缺失 → undefined，向量臂跳过） */
  private async queryEmbedding(text: string): Promise<number[] | undefined> {
    if (!this.embeddingProvider) return undefined;
    const vectors = await this.embeddingProvider.embed([text]);
    return vectors[0];
  }

  /** 单条文本向量化（确认/编辑落库补 embedding；无 provider → null，FTS-only 降级） */
  async embedValue(value: string): Promise<number[] | null> {
    if (!this.embeddingProvider) return null;
    try {
      const vectors = await this.embeddingProvider.embed([value]);
      return vectors[0] ?? null;
    } catch (e) {
      // 嵌入失败不阻塞落库（降级 FTS-only；回填脚本可补齐）
      console.warn('[memory] embedding 生成失败，降级 FTS-only：', (e as Error).message);
      return null;
    }
  }

  /** 10.7 sensitivity 范围（AGENTS.md #5 权限过滤维度）：
   *  private_chat 自己对话 → 全部；friend_visit 对好友场景 → 排除 high
   *  （健康/财务等敏感记忆不入对好友的上下文） */
  private sensitivityScope(purpose: MemorySearchInput['purpose']): string[] {
    return purpose === 'friend_visit' ? ['low', 'medium'] : ['low', 'medium', 'high'];
  }

  async recallMemories(input: MemorySearchInput): Promise<{
    vectorHits: RetrievedMemory[];
    ftsHits: RetrievedMemory[];
  }> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        rlsClaimsJson(input.ownerUserId),
      ]);
      // 权限过滤（先于检索，10.7）：owner + active + purpose + visibility +
      // sensitivity + 时间有效性（AGENTS.md 约定 #5）
      const filter = `owner_user_id = $1 and memory_status = 'active' and purpose = $2
        and visibility = any($3)
        and sensitivity = any($6)
        and (expires_at is null or expires_at > now())
        and (valid_from is null or valid_from <= now())
        and (valid_to is null or valid_to >= now())`;
      const cols = `memory_id, value, category, source_type, sensitivity, importance,
        visibility, purpose, created_at`;
      const args = [
        input.ownerUserId,
        input.purpose,
        visibilityScope(input.purpose),
        input.query,
        RECALL_ARM_LIMIT,
        this.sensitivityScope(input.purpose),
      ] as const;

      // FTS 臂：tsvector @@ plainto_tsquery + ts_rank_cd 排序（GIN 索引）
      const { rows: ftsRows } = await client.query(
        `select ${cols}
         from private_memories
         where ${filter} and to_tsvector('simple', value) @@ plainto_tsquery('simple', $4)
         order by ts_rank_cd(to_tsvector('simple', value), plainto_tsquery('simple', $4)) desc
         limit $5`,
        [...args],
      );

      // 向量臂：嵌入 provider 就绪时生成查询向量（HNSW 索引）；无 provider 跳过
      let vecRows: Array<Record<string, unknown>> = [];
      const queryEmbedding = await this.queryEmbedding(input.query);
      if (queryEmbedding && queryEmbedding.length > 0) {
        const vecArgs = [
          ...args.slice(0, 3),
          JSON.stringify(queryEmbedding),
          RECALL_ARM_LIMIT,
          this.sensitivityScope(input.purpose),
        ];
        const { rows } = await client.query(
          `select ${cols}
           from private_memories
           where ${filter} and embedding is not null
           order by embedding <=> $4::vector
           limit $5`,
          vecArgs,
        );
        vecRows = rows;
      }

      await client.query('commit');
      return {
        vectorHits: vecRows.map((r) => toRetrievedMemory(r)),
        ftsHits: ftsRows.map((r) => toRetrievedMemory(r)),
      };
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

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
    // 10.7 向量臂：embedding 在**事务外**生成（外部 HTTP；事务内长占连接会拖垮
    // 连接池——input.value 不依赖事务数据，先算后落库；失败降级 FTS-only 由回填脚本兜底）
    let embedding: number[] | null = null;
    if (this.embeddingProvider) {
      try {
        const vectors = await this.embeddingProvider.embed([input.value]);
        embedding = vectors[0] ?? null;
      } catch (e) {
        console.warn('[memory] embedding 生成失败，降级 FTS-only：', (e as Error).message);
      }
    }
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
           source_type, namespace, embedding
         ) values ($1, $2, $3, $4, 1, false, $5, 'private', 'private_chat', $6, 'active', $7, $8, $9, $10::vector)
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
          embedding !== null ? JSON.stringify(embedding) : null,
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
           owner_user_id, category, value, importance, source_type, sensitivity,
           source_turn_ids, superseded_memory_id
         ) values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning confirmation_id`,
        [
          input.ownerUserId,
          input.category,
          input.value,
          input.importance,
          input.sourceType,
          input.sensitivity,
          input.sourceTurnIds,
          input.supersedeMemoryId ?? null,
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

/** 召回行 → RetrievedMemory（10.7 进上下文的精简记忆） */
function toRetrievedMemory(r: Record<string, unknown>): RetrievedMemory {
  return {
    memoryId: String(r.memory_id),
    value: String(r.value),
    category: String(r.category) as RetrievedMemory['category'],
    sourceType: String(r.source_type) as RetrievedMemory['sourceType'],
    sensitivity: String(r.sensitivity) as RetrievedMemory['sensitivity'],
    importance: Number(r.importance),
    visibility: String(r.visibility) as RetrievedMemory['visibility'],
    purpose: String(r.purpose) as RetrievedMemory['purpose'],
    createdAt: (r.created_at as Date).toISOString(),
  };
}
