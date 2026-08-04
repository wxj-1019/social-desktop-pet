/**
 * 记忆检索 —— 设计稿 10.7 hybrid 检索（检索节点 + 纯打分）。
 *
 * 分工：
 * - MemoryRetrievalStore（服务端 pg 实现）只负责"召回"：权限过滤后的两组候选
 *   （向量余弦 + 全文 ts_rank），embedding 列就绪前向量臂可为空；
 * - 打分留在图内纯函数：RRF 融合（1/(60+rank_vec) + 1/(60+rank_fts)）→
 *   时间衰减（指数降权不删除）→ importance 加权 → topK —— 可单测、可复现。
 *
 * 权限过滤在 store 侧完成（owner + visibility + purpose + 时间有效性 +
 * memory_status=active，见服务端 recallMemories）；本模块不信任候选之外的内容。
 */
import type {
  MemoryCategory,
  MemoryPurpose,
  MemorySourceType,
  MemoryVisibility,
} from '@pet/protocol';

import type { NodeFn } from '../runtime/types.js';

import type { ChatFlowState } from './chat-flow-state.js';
import { purposeForScenario } from './chat-flow-state.js';

/** 检索结果（进上下文的精简记忆，10.5 字段裁剪） */
export interface RetrievedMemory {
  memoryId: string;
  value: string;
  category: MemoryCategory;
  sourceType: MemorySourceType;
  sensitivity: 'low' | 'medium' | 'high';
  importance: number;
  visibility: MemoryVisibility;
  purpose: MemoryPurpose;
  createdAt: string;
}

/** 检索输入（10.7：purpose 由场景映射，服务端据此过滤 visibility） */
export interface MemorySearchInput {
  ownerUserId: string;
  query: string;
  purpose: MemoryPurpose;
  /** 路由级 top-k（10.3：L1=3 / L2=6 / L3=6；检索取最大档） */
  topK: number;
  /** 查询向量（嵌入服务就绪后由调用方注入；无则服务端跳过向量臂） */
  queryEmbedding?: number[];
}

/**
 * MemoryRetrievalStore —— 服务端 pg 实现注入（与 MemoryExtractStore 并列，
 * PgMemoryExtractStore 同一实例实现双接口）。只负责权限过滤 + 召回，不打分。
 */
export interface MemoryRetrievalStore {
  recallMemories(input: MemorySearchInput): Promise<{
    vectorHits: RetrievedMemory[];
    ftsHits: RetrievedMemory[];
  }>;
}

// ---- 纯打分（10.7）----

/** RRF 常数 k（标准值 60） */
const RRF_K = 60;
/**
 * 综合分权重（10.7 三项可比，相关性主导）：
 * 相关性 0.6（RRF 相对值归一化到 [~0.5,1]：双臂命中显著高于单臂）、
 * 时间衰减 0.2（(0,1] 指数降权）、importance 0.2（归一化 [0.1,1]）。
 * 权重比例避免辅助信号淹没相关性（旧实现 RRF×60 把相关性压到 [1,2] 区间，
 * 档间差仅 0.016，而 importance 满差 4.5 —— 排序被 importance 主导）。
 */
const RELEVANCE_WEIGHT = 0.6;
const RECENCY_WEIGHT = 0.2;
const IMPORTANCE_WEIGHT = 0.2;
/** 时间衰减半衰期：30 天（指数降权不删除） */
export const MEMORY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

/** 检索默认 top-k（10.3 L2/L3 档） */
export const DEFAULT_RETRIEVAL_TOPK = 6;

/** 10.3 路由级 → 检索 top-k（L1=3 轻量 / L2/L3=6；L0 不检索） */
export function retrievalTopKForLevel(level?: string): number {
  if (level === 'L1') return 3;
  return DEFAULT_RETRIEVAL_TOPK;
}

/**
 * RRF 融合：按 memoryId 合并两组候选，score = Σ 1/(k+rank)（10.7 公式）。
 * 单列表自然退化为纯该列表排名。
 */
export function rrfFuse(
  vectorHits: RetrievedMemory[],
  ftsHits: RetrievedMemory[],
  k = RRF_K,
): Map<string, { hit: RetrievedMemory; rrf: number }> {
  const fused = new Map<string, { hit: RetrievedMemory; rrf: number }>();
  const merge = (hits: RetrievedMemory[]) => {
    hits.forEach((hit, i) => {
      const existing = fused.get(hit.memoryId);
      fused.set(hit.memoryId, {
        hit: existing?.hit ?? hit,
        rrf: (existing?.rrf ?? 0) + 1 / (k + i + 1),
      });
    });
  };
  merge(vectorHits);
  merge(ftsHits);
  return fused;
}

/** 时间衰减：指数降权不删除（半衰期后权重 0.5） */
export function timeDecay(ageMs: number, halfLifeMs = MEMORY_HALF_LIFE_MS): number {
  if (ageMs <= 0) return 1;
  return Math.pow(0.5, ageMs / halfLifeMs);
}

/**
 * 综合分 = 相关性（RRF 相对值 min-max 归一化，双臂命中显著靠前）+
 * 时间衰减（指数降权不删除）+ importance 归一化（10.7 三项可比）。
 */
export function compositeScore(
  rrf: number,
  maxRrf: number,
  ageMs: number,
  importance: number,
): number {
  const relevance = maxRrf > 0 ? rrf / maxRrf : 0;
  return (
    RELEVANCE_WEIGHT * relevance +
    RECENCY_WEIGHT * timeDecay(ageMs) +
    IMPORTANCE_WEIGHT * (Math.min(importance, 10) / 10)
  );
}

/** 召回 → 打分 → 排序 → topK（纯函数；now 可注入便于测试） */
export function fuseAndScore(
  vectorHits: RetrievedMemory[],
  ftsHits: RetrievedMemory[],
  topK: number,
  now = Date.now(),
): RetrievedMemory[] {
  const fused = rrfFuse(vectorHits, ftsHits);
  const entries = [...fused.values()];
  const maxRrf = entries.reduce((max, { rrf }) => Math.max(max, rrf), 0);
  const scored = entries.map(({ hit, rrf }) => ({
    hit,
    score: compositeScore(rrf, maxRrf, now - Date.parse(hit.createdAt), hit.importance),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => s.hit);
}

// ---- 检索节点 ----

/** 检索节点工厂：store 召回 → RRF/衰减/importance 打分 → 状态写入 */
export function retrieveMemoryNodeFactory(store?: MemoryRetrievalStore): NodeFn<ChatFlowState> {
  return async (state): Promise<Partial<ChatFlowState>> => {
    if (!store) {
      // 无检索存储（框架降级）：返回空，避免误用未实现检索
      return { retrievedMemories: [], retrievedMemoryIds: [] };
    }

    const purpose = purposeForScenario(state.scenario);
    // 10.3：路由级决定记忆条数（L1=3 / L2/L3=6），与 DEFAULT_ROUTE_TABLE.memoryRetrievalTopK 对齐
    const topK = retrievalTopKForLevel(state.routing?.level);
    const { vectorHits, ftsHits } = await store.recallMemories({
      ownerUserId: state.userId,
      query: state.userMessage,
      purpose,
      topK,
    });
    const retrievedMemories = fuseAndScore(vectorHits, ftsHits, topK);
    return {
      retrievedMemories,
      retrievedMemoryIds: retrievedMemories.map((m) => m.memoryId),
    };
  };
}
