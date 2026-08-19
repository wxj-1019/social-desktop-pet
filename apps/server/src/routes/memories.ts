/**
 * 记忆路由 —— 10.6 / D-3 分级确认的 HITL 收口 + 11.3 记忆中心数据层。
 *
 * GET   /memories/summary            → 待确认列表 + 60s 内自动保存（"已记住"提示）
 * GET   /memories?limit=             → 记忆中心：owner 的 active 记忆 + 来源原文
 * POST  /memories/confirm            → 确认卡"记住"（可携带修改后的 value）
 * POST  /memories/reject             → 确认卡"仅本次聊天"
 * POST  /memories/:memoryId/edit     → 修改记忆（10.5 纠正：旧条置失效 + superseded 链）
 * POST  /memories/:memoryId/invalidate → 撤销/删除（10.5 置失效不删除）
 *
 * 全部事务内 set_config('request.jwt.claims')（应用层校验 owner + RLS 兜底），
 * 写操作同步记 memory_audit_log（11.2）。
 */
import { type Hono } from 'hono';
import type pg from 'pg';

import type { MemoryExtractStore } from '@pet/ai-graph';
import { LIMITS } from '@pet/config';
import {
  MemoryConfirmationSchema,
  MemoryListItemSchema,
  SavedMemoryBriefSchema,
} from '@pet/protocol';

import type { JwtService } from '../auth/jwt.js';
import { rlsClaimsJson } from '../db/pool.js';

import type { BusinessVariables } from './business.js';
import { requireAuth } from './business.js';

export interface MemoryRoutesDeps {
  pool: pg.Pool;
  jwt: JwtService;
  /** 记忆存储（10.7 向量臂：确认/编辑落库补 embedding；缺失 → FTS-only） */
  memoryStore?: MemoryExtractStore;
}

/** 自动保存提示窗口：最近 60s 落库的 active 记忆（客户端轮询时差分去重） */
const RECENTLY_SAVED_WINDOW_SEC = 60;
const RECENTLY_SAVED_LIMIT = 5;

export function registerMemoriesRoutes(
  app: Hono<{ Variables: BusinessVariables }>,
  deps: MemoryRoutesDeps,
): void {
  const auth = requireAuth(deps.jwt, deps.pool);

  // 待确认 + 最近自动保存（10.6/D-3；"已记住"提示数据源）
  app.get('/memories/summary', auth, async (c) => {
    const userId = c.get('userId');
    const client = await deps.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        rlsClaimsJson(userId),
      ]);
      const { rows: pendingRows } = await client.query(
        `select confirmation_id, category, value, importance, source_type, sensitivity,
                source_turn_ids, created_at
         from memory_confirmations
         where owner_user_id = $1 and status = 'pending'
         order by created_at asc`,
        [userId],
      );
      const { rows: savedRows } = await client.query(
        `select memory_id, value, created_at
         from private_memories
         where owner_user_id = $1 and memory_status = 'active'
           and created_at > now() - make_interval(secs => $2)
         order by created_at desc
         limit $3`,
        [userId, RECENTLY_SAVED_WINDOW_SEC, RECENTLY_SAVED_LIMIT],
      );
      await client.query('commit');

      const pending = pendingRows.map((r) =>
        MemoryConfirmationSchema.parse({
          confirmationId: String(r.confirmation_id),
          category: String(r.category),
          value: String(r.value),
          importance: Number(r.importance),
          sourceType: String(r.source_type),
          sensitivity: String(r.sensitivity),
          sourceTurnIds: (r.source_turn_ids ?? []).map(String),
          createdAt: (r.created_at as Date).toISOString(),
        }),
      );
      const recentlySaved = savedRows.map((r) =>
        SavedMemoryBriefSchema.parse({
          memoryId: String(r.memory_id),
          value: String(r.value),
          savedAt: (r.created_at as Date).toISOString(),
        }),
      );
      return c.json({ pending, recentlySaved });
    } catch (e) {
      await client.query('rollback');
      console.error('[memories] summary 失败：', e);
      return c.json({ error: '内部错误' }, 500);
    } finally {
      client.release();
    }
  });

  // 确认"记住"（可带修改后的 value；编辑过 → source_type=user_confirmed）
  app.post('/memories/confirm', auth, async (c) => {
    const userId = c.get('userId');
    const { confirmationId, value } = (await c.req.json()) as {
      confirmationId?: string;
      value?: string;
    };
    if (typeof confirmationId !== 'string' || confirmationId.length === 0) {
      return c.json({ error: '缺少 confirmationId' }, 400);
    }
    const edited = typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
    if (edited !== null && edited.length > LIMITS.memoryValueMaxChars) {
      return c.json({ error: `value 过长（≤${LIMITS.memoryValueMaxChars}）` }, 400);
    }

    const client = await deps.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        rlsClaimsJson(userId),
      ]);
      const { rows } = await client.query(
        `select confirmation_id, category, value, importance, source_type, sensitivity,
                source_turn_ids, superseded_memory_id
         from memory_confirmations
         where confirmation_id = $1 and owner_user_id = $2 and status = 'pending'
         for update`,
        [confirmationId, userId],
      );
      const confirm = rows[0];
      if (!confirm) {
        await client.query('rollback');
        return c.json({ error: 'confirmation 不存在或已处理' }, 410);
      }

      const finalValue = edited ?? String(confirm.value);
      // 编辑过 → 用户在确认卡确认（10.5 sourceType 语义）
      const sourceType = edited !== null ? 'user_confirmed' : String(confirm.source_type);

      // 敏感纠正（superseded_memory_id 非空，10.5 纠正链）：确认即置失效旧条 +
      // 新条 superseded_by 链接。此前 persist 阶段已置失效——拒绝确认会丢数据，
      // 现在改到确认时执行（拒绝则旧记忆保留）。审计写 invalidate + user_confirmed。
      const superseded = confirm.superseded_memory_id ? String(confirm.superseded_memory_id) : null;
      if (superseded) {
        const { rows: oldRows } = await client.query(
          `update private_memories set memory_status = 'invalidated', updated_at = now()
           where memory_id = $1 and owner_user_id = $2 and memory_status = 'active'
           returning value, source_turn_ids`,
          [superseded, userId],
        );
        if (oldRows[0]) {
          await client.query(
            `insert into memory_audit_log (owner_user_id, action, memory_id, value, source_turn_ids)
             values ($1, 'invalidate', $2, $3, $4)`,
            [
              userId,
              superseded,
              String(oldRows[0].value),
              (oldRows[0].source_turn_ids ?? []).map(String),
            ],
          );
        }
      }
      // 10.7 向量臂：确认落库补 embedding（provider 缺失 → null，FTS-only）
      const embedding = deps.memoryStore
        ? ((await deps.memoryStore.embedValue?.(finalValue)) ?? null)
        : null;
      const { rows: memRows } = await client.query(
        `insert into private_memories (
           owner_user_id, category, value, source_turn_ids, confidence, user_confirmed,
           sensitivity, visibility, purpose, importance, memory_status, superseded_by,
           source_type, namespace, embedding
         ) values ($1, $2, $3, $4, 1, true, $5, 'private', 'private_chat', $6, 'active', $7, $8, $9, $10::vector)
         returning memory_id`,
        [
          userId,
          String(confirm.category),
          finalValue,
          (confirm.source_turn_ids ?? []).map(String),
          String(confirm.sensitivity),
          Number(confirm.importance),
          superseded,
          sourceType,
          'star-isle:private_chat',
          embedding !== null ? JSON.stringify(embedding) : null,
        ],
      );
      const memoryId = String(memRows[0]?.memory_id);
      await client.query(
        `update memory_confirmations set status = 'confirmed' where confirmation_id = $1`,
        [confirmationId],
      );
      await client.query(
        `insert into memory_audit_log (owner_user_id, action, memory_id, value, source_turn_ids)
         values ($1, 'user_confirmed', $2, $3, $4)`,
        [userId, memoryId, finalValue, (confirm.source_turn_ids ?? []).map(String)],
      );
      await client.query('commit');
      return c.json({ memoryId });
    } catch (e) {
      await client.query('rollback');
      console.error('[memories] confirm 失败：', e);
      return c.json({ error: '内部错误' }, 500);
    } finally {
      client.release();
    }
  });

  // "仅本次聊天"：拒绝该候选（D-3；不落库）
  app.post('/memories/reject', auth, async (c) => {
    const userId = c.get('userId');
    const { confirmationId } = (await c.req.json()) as { confirmationId?: string };
    if (typeof confirmationId !== 'string' || confirmationId.length === 0) {
      return c.json({ error: '缺少 confirmationId' }, 400);
    }
    const client = await deps.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        rlsClaimsJson(userId),
      ]);
      const { rows } = await client.query(
        `select value, source_turn_ids from memory_confirmations
         where confirmation_id = $1 and owner_user_id = $2 and status = 'pending'
         for update`,
        [confirmationId, userId],
      );
      if (!rows[0]) {
        await client.query('rollback');
        return c.json({ error: 'confirmation 不存在或已处理' }, 410);
      }
      await client.query(
        `update memory_confirmations set status = 'rejected' where confirmation_id = $1`,
        [confirmationId],
      );
      await client.query(
        `insert into memory_audit_log (owner_user_id, action, value, source_turn_ids)
         values ($1, 'user_rejected', $2, $3)`,
        [userId, String(rows[0].value), (rows[0].source_turn_ids ?? []).map(String)],
      );
      await client.query('commit');
      return c.json({ ok: true });
    } catch (e) {
      await client.query('rollback');
      return c.json({ error: (e as Error).message }, 500);
    } finally {
      client.release();
    }
  });

  // 撤销自动保存（D-3"已记住·撤销"；10.5 置失效不删除）
  // 纠正链语义：撤销的是被纠正的新条（superseded_by 非空）时，同时把被纠正的
  // 旧条恢复 active——回到纠正前状态，避免"撤销"把整条纠正链都抹掉（信息丢失）。
  app.post('/memories/:memoryId/invalidate', auth, async (c) => {
    const userId = c.get('userId');
    const memoryId = c.req.param('memoryId');
    const client = await deps.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        rlsClaimsJson(userId),
      ]);
      const { rows } = await client.query(
        `update private_memories set memory_status = 'invalidated', updated_at = now()
         where memory_id = $1 and owner_user_id = $2 and memory_status = 'active'
         returning value, source_turn_ids, superseded_by`,
        [memoryId, userId],
      );
      if (!rows[0]) {
        await client.query('rollback');
        return c.json({ error: '记忆不存在或已撤销' }, 404);
      }
      const supersededBy = rows[0].superseded_by ? String(rows[0].superseded_by) : null;
      if (supersededBy) {
        await client.query(
          `update private_memories set memory_status = 'active', updated_at = now()
           where memory_id = $1 and owner_user_id = $2 and memory_status = 'invalidated'`,
          [supersededBy, userId],
        );
      }
      await client.query(
        `insert into memory_audit_log (owner_user_id, action, memory_id, value, source_turn_ids)
         values ($1, 'invalidate', $2, $3, $4)`,
        [userId, memoryId, String(rows[0].value), (rows[0].source_turn_ids ?? []).map(String)],
      );
      await client.query('commit');
      return c.json({ ok: true });
    } catch (e) {
      await client.query('rollback');
      console.error('[memories] invalidate 失败：', e);
      return c.json({ error: '内部错误' }, 500);
    } finally {
      client.release();
    }
  });

  // 记忆中心列表（11.3）：owner 的 active 记忆 + 来源原文（source_turn_ids → chat_messages）
  app.get('/memories', auth, async (c) => {
    const userId = c.get('userId');
    // 畸形/负数 limit 钳制为合法范围，避免 NaN 直传 SQL 报 500
    const raw = Number(c.req.query('limit') ?? 100);
    const limit = Number.isFinite(raw) ? Math.max(1, Math.min(Math.trunc(raw), 200)) : 100;
    const client = await deps.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        rlsClaimsJson(userId),
      ]);
      const { rows } = await client.query(
        `select m.memory_id, m.category, m.value, m.importance, m.sensitivity,
                m.source_type, m.user_confirmed, m.created_at, m.updated_at,
                coalesce((
                  select array_agg(c.content order by c.created_at desc)
                  from chat_messages c
                  where c.message_id = any(m.source_turn_ids)
                ), '{}') as source_texts
         from private_memories m
         where m.owner_user_id = $1 and m.memory_status = 'active'
         order by m.created_at desc
         limit $2`,
        [userId, limit],
      );
      await client.query('commit');
      const memories = rows.map((r) =>
        MemoryListItemSchema.parse({
          memoryId: String(r.memory_id),
          category: String(r.category),
          value: String(r.value),
          importance: Number(r.importance),
          sensitivity: String(r.sensitivity),
          sourceType: String(r.source_type),
          userConfirmed: Boolean(r.user_confirmed),
          sourceTexts: (r.source_texts ?? []).map(String),
          createdAt: (r.created_at as Date).toISOString(),
          updatedAt: (r.updated_at as Date).toISOString(),
        }),
      );
      return c.json({ memories });
    } catch (e) {
      await client.query('rollback');
      console.error('[memories] list 失败：', e);
      return c.json({ error: '内部错误' }, 500);
    } finally {
      client.release();
    }
  });

  // 修改记忆（11.3；10.5 纠正语义：旧条置失效 + 新条 superseded_by 链接，不物理删除）
  app.post('/memories/:memoryId/edit', auth, async (c) => {
    const userId = c.get('userId');
    const memoryId = c.req.param('memoryId');
    const { value } = (await c.req.json()) as { value?: string };
    const finalValue = typeof value === 'string' ? value.trim() : '';
    if (finalValue.length === 0 || finalValue.length > LIMITS.memoryValueMaxChars) {
      return c.json({ error: `value 非法（1-${LIMITS.memoryValueMaxChars} 字符）` }, 400);
    }

    const client = await deps.pool.connect();
    try {
      await client.query('begin');
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        rlsClaimsJson(userId),
      ]);
      const { rows } = await client.query(
        `select category, importance, sensitivity, source_turn_ids, purpose, visibility, namespace
         from private_memories
         where memory_id = $1 and owner_user_id = $2 and memory_status = 'active'
         for update`,
        [memoryId, userId],
      );
      const old = rows[0];
      if (!old) {
        await client.query('rollback');
        return c.json({ error: '记忆不存在或已删除' }, 404);
      }

      // 10.5：旧条置失效（不物理删除），新条以 superseded_by 链接
      await client.query(
        `update private_memories set memory_status = 'invalidated', updated_at = now()
         where memory_id = $1`,
        [memoryId],
      );
      // 10.7 向量臂：编辑落库补 embedding（provider 缺失 → null，FTS-only）
      const embedding = deps.memoryStore
        ? ((await deps.memoryStore.embedValue?.(finalValue)) ?? null)
        : null;
      const { rows: newRows } = await client.query(
        `insert into private_memories (
           owner_user_id, category, value, source_turn_ids, confidence, user_confirmed,
           sensitivity, visibility, purpose, importance, memory_status, superseded_by,
           source_type, namespace, embedding
         ) values ($1, $2, $3, $4, 1, true, $5, $6, $7, $8, 'active', $9, 'user_confirmed', $10, $11::vector)
         returning memory_id`,
        [
          userId,
          String(old.category),
          finalValue,
          (old.source_turn_ids ?? []).map(String),
          String(old.sensitivity),
          String(old.visibility),
          String(old.purpose),
          Number(old.importance),
          memoryId,
          String(old.namespace),
          embedding !== null ? JSON.stringify(embedding) : null,
        ],
      );
      const newMemoryId = String(newRows[0]?.memory_id);
      await client.query(
        `insert into memory_audit_log (owner_user_id, action, memory_id, value, source_turn_ids)
         values ($1, 'user_confirmed', $2, $3, $4)`,
        [userId, newMemoryId, finalValue, (old.source_turn_ids ?? []).map(String)],
      );
      await client.query('commit');
      return c.json({ memoryId: newMemoryId, supersededMemoryId: memoryId });
    } catch (e) {
      await client.query('rollback');
      console.error('[memories] edit 失败：', e);
      return c.json({ error: '内部错误' }, 500);
    } finally {
      client.release();
    }
  });
}
