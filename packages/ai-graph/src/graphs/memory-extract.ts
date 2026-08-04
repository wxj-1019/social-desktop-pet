/**
 * memory-extract 子图 —— 设计稿 10.6（mem0 式去重管道）。
 *
 * 异步触发（chat-flow 的 approve_action 后）：
 *   START→extract_candidates→injection_check→dedupe_arbitrate→tiered_confirm→persist→END
 *
 * 10.6 关键约束：
 * - 仅从 owner 本人 turn 抽取（source_turn_ids 服务端校验）
 * - 命令性文本/Prompt Injection 不进入（injection_check 对 LLM/规则双路径生效）
 * - LLM 裁决 ADD/UPDATE/DELETE/NOOP（去重/冲突消解）；无 LLM 精确匹配兜底
 * - 分级确认（D-3）：敏感（high/medium）确认卡 HITL / 普通自动保存+撤销
 * - 落库 + 审计日志（11.2）经注入的 MemoryExtractStore（本包保持纯净，无 DB 依赖）
 */
import {
  MemoryCandidateSchema,
  MemoryDedupeActionSchema,
  type MemoryCandidate,
  type MemoryCategory,
  type MemoryDedupeAction,
  type MemorySourceType,
} from '@pet/protocol';

import type { LlmClient, LlmMessage } from '../llm/types.js';
import type { CompiledGraph } from '../runtime/state-graph.js';
import { StateGraph } from '../runtime/state-graph.js';
import { END, START, type NodeFn } from '../runtime/types.js';

import { filterInjectedCandidates, ruleExtractCandidates } from './memory-rules.js';

export interface MemoryExtractState {
  threadId: string;
  ownerUserId: string;
  /** 仅供抽取的 owner 本人 turn 文本 */
  ownerTurns: string[];
  /** 来源 turn 的 DB id（chat_messages.message_id；服务端校验属于 owner 本人） */
  sourceTurnIds: string[];
  candidates?: MemoryCandidate[];
  /** 去重裁决结果 */
  dedupeActions?: Array<{
    candidate: MemoryCandidate;
    action: MemoryDedupeAction;
    targetMemoryId?: string;
  }>;
  /** 待确认（敏感类，HITL 中断点 D-3） */
  pendingConfirmation?: MemoryCandidate[];
  /** 本次已落库条数（不含待确认） */
  persistedCount: number;
  /** 本次已落库的 memoryId（可观测/测试） */
  persistedMemoryIds?: string[];
}

/** D-3 分级确认模式（对应 packages/config memoryConfirmation feature flag） */
export type MemoryConfirmationMode = 'tiered' | 'always' | 'never';

/** 相似记忆摘要（去重裁决输入） */
export interface SimilarMemory {
  memoryId: string;
  value: string;
  category: MemoryCategory;
  sourceType: MemorySourceType;
}

/** 待写入记忆（10.5 字段裁剪；supersedeMemoryId 用于 UPDATE 纠正链） */
export interface PersistMemoryInput {
  ownerUserId: string;
  category: MemoryCategory;
  value: string;
  importance: number;
  sourceType: MemorySourceType;
  sensitivity: 'low' | 'medium' | 'high';
  sourceTurnIds: string[];
  supersedeMemoryId?: string;
}

/** 待确认草稿（D-3 HITL；确认后由服务端落库） */
export interface ConfirmationDraft {
  ownerUserId: string;
  category: MemoryCategory;
  value: string;
  importance: number;
  sourceType: MemorySourceType;
  sensitivity: 'low' | 'medium' | 'high';
  sourceTurnIds: string[];
  /**
   * 纠正链（10.5）：候选是对旧记忆的 UPDATE 纠正。确认前**不**置失效旧记忆
   * （拒绝确认时旧记忆保留，避免信息丢失）；确认时由服务端置失效旧条 +
   * 新条 superseded_by 链接。
   */
  supersedeMemoryId?: string;
}

/** 11.2 记忆审计条目 */
export interface AuditEntry {
  ownerUserId: string;
  action:
    | 'auto_save'
    | 'pending_confirm'
    | 'user_confirmed'
    | 'user_rejected'
    | 'invalidate'
    | 'dedupe_noop';
  memoryId?: string;
  value: string;
  sourceTurnIds: string[];
}

/**
 * MemoryExtractStore —— 服务端 pg 实现注入（仿 LlmClient 注入模式）。
 * ai-graph 只定义接口，保证状态图运行时纯净、可单测。
 */
export interface MemoryExtractStore {
  /** 检索相似记忆（top-K；embedding 就绪前用 FTS，服务端实现） */
  findSimilar(ownerUserId: string, value: string, topK: number): Promise<SimilarMemory[]>;
  /** 落库（10.5 字段 + namespace/visibility/purpose 由服务端补充默认） */
  persistMemory(input: PersistMemoryInput): Promise<{ memoryId: string }>;
  /** 纠正/删除：旧记忆置 invalidated（10.5 不物理删除）；owner 显式传参便于应用层校验 */
  invalidateMemory(ownerUserId: string, memoryId: string): Promise<void>;
  /** 敏感候选 → 确认队列（D-3 HITL） */
  createConfirmation(input: ConfirmationDraft): Promise<{ confirmationId: string }>;
  /** 审计日志（11.2） */
  logAudit(entry: AuditEntry): Promise<void>;
}

// ---- 抽取 ----

/** LLM 抽取 prompt：单行 JSON 数组契约（与 generateNode 同一容错解析哲学） */
const EXTRACT_SYSTEM_PROMPT =
  '你是记忆抽取器。从用户话语中抽取值得长期记住的事实，不含临时闲聊。' +
  '输出严格 JSON 数组（不要 Markdown、不要额外文字）：' +
  '[{"value":"记忆内容（简洁，保留关键细节，≤200字符）",' +
  '"category":"preference|commitment|event|fact",' +
  '"importance":1-10的整数,' +
  '"sourceType":"user_stated|inferred",' +
  '"sensitivity":"low|medium|high"}]' +
  '规则：只抽用户明确说出的内容（inferred 为推断，不可当作已确认事实）；' +
  '健康/财务/亲密关系/身份类 sensitivity 必须 high 或 medium；不要输出空数组之外的东西。';

/** 候选数量上限（防 LLM 一次刷爆） */
const MAX_CANDIDATES = 8;

/** 提取文本中的数组字面量（容错：代码块/前缀杂讯） */
function extractArrayLiteral(raw: string): string | null {
  const m = /\[[\s\S]*\]/.exec(raw);
  return m ? m[0] : null;
}

/**
 * 容错解析 LLM 候选输出为 MemoryCandidate[]。
 * 永远不抛异常：逐项 schema 过滤，非法项丢弃，失败回退空数组。
 */
export function parseCandidatesJson(raw: string): MemoryCandidate[] {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const extracted = extractArrayLiteral(raw);
    if (extracted !== null) {
      try {
        parsed = JSON.parse(extracted);
      } catch {
        parsed = null;
      }
    }
  }
  if (!Array.isArray(parsed)) return [];
  const out: MemoryCandidate[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    const r = MemoryCandidateSchema.safeParse(item);
    if (r.success && !seen.has(r.data.value)) {
      seen.add(r.data.value);
      out.push(r.data);
    }
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

/** 抽取节点工厂：有 llm 走模型，无 llm 走规则兜底（确定性路径） */
export function extractCandidatesNodeFactory(llm?: LlmClient): NodeFn<MemoryExtractState> {
  return async (state): Promise<Partial<MemoryExtractState>> => {
    if (state.ownerTurns.length === 0) return { candidates: [] };

    if (!llm) {
      return { candidates: ruleExtractCandidates(state.ownerTurns) };
    }

    const messages: LlmMessage[] = [
      { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
      { role: 'user', content: `用户话语：\n${state.ownerTurns.join('\n')}` },
    ];
    let buffer = '';
    await llm.streamChat(messages, (t) => {
      buffer += t;
    });
    return { candidates: parseCandidatesJson(buffer) };
  };
}

// ---- 注入过滤 ----

/** 注入/命令性文本过滤（规则在 memory-rules.ts，双路径统一生效） */
export const injectionCheckNode: NodeFn<MemoryExtractState> = async (
  state,
): Promise<Partial<MemoryExtractState>> => {
  const candidates = state.candidates ?? [];
  return { candidates: filterInjectedCandidates(candidates) };
};

// ---- 去重裁决 ----

/** LLM 去重 prompt：裁决单条候选与已有记忆的关系 */
const DEDUPE_SYSTEM_PROMPT =
  '你是记忆去重裁决器。判断新候选与已有记忆的关系，输出严格 JSON（不要 Markdown）：' +
  '{"action":"ADD|UPDATE|DELETE|NOOP","targetMemoryId":"已有记忆id或null","reason":"一句话"}' +
  '规则：语义完全重复→NOOP；新信息补充/纠正旧记忆→UPDATE 并填 targetMemoryId；' +
  '无关→ADD；新陈述明确推翻旧记忆、且本身不值得落库→DELETE 旧记忆（置失效，候选不保存）。';

export interface DedupeDecision {
  action: MemoryDedupeAction;
  targetMemoryId?: string;
}

/** 容错解析去重裁决；解析失败回退 ADD（宁可重复不漏存） */
export function parseDedupeDecision(raw: string): DedupeDecision {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = /\{[\s\S]*\}/.exec(raw);
    if (m !== null) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        parsed = null;
      }
    }
  }
  const obj = parsed as Record<string, unknown> | null;
  const action = MemoryDedupeActionSchema.safeParse(obj?.action);
  if (!action.success) return { action: 'ADD' };
  const targetMemoryId =
    typeof obj?.targetMemoryId === 'string' && obj.targetMemoryId.length > 0
      ? obj.targetMemoryId
      : undefined;
  // UPDATE/DELETE 必须有目标记忆；缺失则降级 ADD（不丢候选）
  if ((action.data === 'UPDATE' || action.data === 'DELETE') && targetMemoryId === undefined) {
    return { action: 'ADD' };
  }
  return { action: action.data, targetMemoryId };
}

/** 去重裁决节点工厂：store.findSimilar → LLM 裁决；无 LLM 精确匹配兜底 */
export function dedupeArbitrateNodeFactory(llm?: LlmClient, store?: MemoryExtractStore) {
  return async (state: MemoryExtractState): Promise<Partial<MemoryExtractState>> => {
    const candidates = state.candidates ?? [];
    const dedupeActions: Array<{
      candidate: MemoryCandidate;
      action: MemoryDedupeAction;
      targetMemoryId?: string;
    }> = [];

    for (const candidate of candidates) {
      const similar = store ? await store.findSimilar(state.ownerUserId, candidate.value, 10) : [];

      let decision: DedupeDecision = { action: 'ADD' };
      if (similar.length > 0 && llm) {
        const list = similar
          .map((m) => `- ${m.memoryId}: ${m.value}（${m.category}/${m.sourceType}）`)
          .join('\n');
        let buffer = '';
        await llm.streamChat(
          [
            { role: 'system', content: DEDUPE_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `已有记忆：\n${list}\n\n新候选：${candidate.value}\n（category=${candidate.category}, sourceType=${candidate.sourceType}）`,
            },
          ],
          (t) => {
            buffer += t;
          },
        );
        decision = parseDedupeDecision(buffer);
      } else if (similar.some((m) => m.value === candidate.value)) {
        // 无 LLM 兜底：精确重复 → NOOP
        decision = { action: 'NOOP' };
      }
      dedupeActions.push({
        candidate,
        action: decision.action,
        targetMemoryId: decision.targetMemoryId,
      });
    }
    return { dedupeActions };
  };
}

// ---- 分级确认（D-3）----

/**
 * 分级确认节点工厂：tiered = 敏感(high/medium) 弹确认卡 / low 自动；
 * always = 全部确认；never = 全部自动（feature flag memoryConfirmation）。
 * 仅 ADD/UPDATE 需要确认；DELETE 属纠正（10.5 置失效），直接执行。
 */
export function tieredConfirmNodeFactory(mode: MemoryConfirmationMode = 'tiered') {
  return async (state: MemoryExtractState): Promise<Partial<MemoryExtractState>> => {
    const actions = state.dedupeActions ?? [];
    const pending: MemoryCandidate[] = [];
    for (const { candidate, action } of actions) {
      if (action !== 'ADD' && action !== 'UPDATE') continue;
      const needsConfirm =
        mode === 'always' || (mode === 'tiered' && candidate.sensitivity !== 'low');
      if (needsConfirm) pending.push(candidate);
    }
    return { pendingConfirmation: pending };
  };
}

// ---- 落库 + 审计 ----

/**
 * 落库节点工厂（经 MemoryExtractStore；无 store 时为 dry-run，persistedCount=0）。
 * ADD：pending 中的进确认队列，其余自动保存；UPDATE：自动保存=旧条置失效 +
 * supersede 链，pending（敏感纠正）= 不置失效，确认后由服务端完成纠正；
 * DELETE：旧记忆置失效；全部写审计（NOOP 跳过）。
 */
export function persistNodeFactory(store?: MemoryExtractStore): NodeFn<MemoryExtractState> {
  return async (state): Promise<Partial<MemoryExtractState>> => {
    const actions = state.dedupeActions ?? [];
    if (!store || actions.length === 0) {
      return { persistedCount: 0, persistedMemoryIds: [] };
    }

    const pendingKeys = new Set((state.pendingConfirmation ?? []).map((c) => candidateKey(c)));
    const persistedMemoryIds: string[] = [];
    let persistedCount = 0;

    for (const { candidate, action, targetMemoryId } of actions) {
      const draft = {
        ownerUserId: state.ownerUserId,
        category: candidate.category,
        value: candidate.value,
        importance: candidate.importance,
        sourceType: candidate.sourceType,
        sensitivity: candidate.sensitivity,
        sourceTurnIds: state.sourceTurnIds ?? [],
      };

      switch (action) {
        case 'ADD': {
          if (pendingKeys.has(candidateKey(candidate))) {
            await store.createConfirmation(draft);
            await store.logAudit({
              ownerUserId: state.ownerUserId,
              action: 'pending_confirm',
              value: candidate.value,
              sourceTurnIds: draft.sourceTurnIds,
            });
          } else {
            const { memoryId } = await store.persistMemory(draft);
            persistedMemoryIds.push(memoryId);
            persistedCount += 1;
            await store.logAudit({
              ownerUserId: state.ownerUserId,
              action: 'auto_save',
              memoryId,
              value: candidate.value,
              sourceTurnIds: draft.sourceTurnIds,
            });
          }
          break;
        }
        case 'UPDATE': {
          // 敏感纠正（进确认队列）：不立即置失效旧记忆——确认后由服务端
          // 统一置失效 + superseded_by 链；用户拒绝则旧记忆保留（不丢数据）。
          if (pendingKeys.has(candidateKey(candidate))) {
            await store.createConfirmation({ ...draft, supersedeMemoryId: targetMemoryId });
            await store.logAudit({
              ownerUserId: state.ownerUserId,
              action: 'pending_confirm',
              value: candidate.value,
              sourceTurnIds: draft.sourceTurnIds,
            });
            break;
          }
          // 自动保存纠正：即时置失效 + 新条 supersede 链（10.5）
          if (targetMemoryId !== undefined) {
            await store.invalidateMemory(state.ownerUserId, targetMemoryId);
            await store.logAudit({
              ownerUserId: state.ownerUserId,
              action: 'invalidate',
              memoryId: targetMemoryId,
              value: candidate.value,
              sourceTurnIds: draft.sourceTurnIds,
            });
          }
          const { memoryId } = await store.persistMemory({
            ...draft,
            supersedeMemoryId: targetMemoryId,
          });
          persistedMemoryIds.push(memoryId);
          persistedCount += 1;
          await store.logAudit({
            ownerUserId: state.ownerUserId,
            action: 'auto_save',
            memoryId,
            value: candidate.value,
            sourceTurnIds: draft.sourceTurnIds,
          });
          break;
        }
        case 'DELETE': {
          if (targetMemoryId !== undefined) {
            await store.invalidateMemory(state.ownerUserId, targetMemoryId);
            await store.logAudit({
              ownerUserId: state.ownerUserId,
              action: 'invalidate',
              memoryId: targetMemoryId,
              value: candidate.value,
              sourceTurnIds: draft.sourceTurnIds,
            });
          }
          break;
        }
        case 'NOOP':
          break;
      }
    }
    return { persistedCount, persistedMemoryIds };
  };
}

/** 候选稳定键（pending 集合判同用） */
function candidateKey(c: MemoryCandidate): string {
  return `${c.value}|${c.sourceType}|${c.category}`;
}

export interface MemoryExtractFlowOptions {
  llm?: LlmClient;
  store?: MemoryExtractStore;
  /** D-3 分级确认模式，默认 tiered（对齐 feature flag memoryConfirmation） */
  memoryConfirmation?: MemoryConfirmationMode;
}

export function buildMemoryExtractFlow(
  options: MemoryExtractFlowOptions = {},
): CompiledGraph<MemoryExtractState> {
  const mode = options.memoryConfirmation ?? 'tiered';
  return new StateGraph<MemoryExtractState>()
    .addNode('extract_candidates', extractCandidatesNodeFactory(options.llm))
    .addNode('injection_check', injectionCheckNode)
    .addNode('dedupe_arbitrate', dedupeArbitrateNodeFactory(options.llm, options.store))
    .addNode('tiered_confirm', tieredConfirmNodeFactory(mode))
    .addNode('persist', persistNodeFactory(options.store))
    .addEdge(START, 'extract_candidates')
    .addEdge('extract_candidates', 'injection_check')
    .addEdge('injection_check', 'dedupe_arbitrate')
    .addEdge('dedupe_arbitrate', 'tiered_confirm')
    .addEdge('tiered_confirm', 'persist')
    .addEdge('persist', END)
    .compile();
}
