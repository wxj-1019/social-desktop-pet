/**
 * 管理 API —— 宠物与羁绊（P0）。
 *
 * 数据源：pets（角色/性格/命名）+ bonds（stage/progress/status）。
 * 全部只读聚合查询——pets/bonds 由业务侧建立好友与羁绊时写入，
 * 本路由只做运营视角的分布统计与单用户明细，不改羁绊数值
 *（主稿 7.4 原则：羁绊只由双方有效事件增长，运营不直接调整）。
 *
 * 三个端点：
 *   GET /pets/stats   —— 宠物名册统计（总数/角色分布/性格分布/自定义命名占比）
 *   GET /bonds/stats  —— 羁绊分布（stage 占比/平均进度/active 数）+ TOP 羁绊榜
 *   GET /users/:userId/pets —— 单用户宠物与羁绊明细
 */
import { Hono } from 'hono';
import type pg from 'pg';

import type { JwtService } from '../auth/jwt.js';
import type { PgAdminUserStore } from '../db/admin-stores.js';
import { isValidUuid } from '../lib/validate.js';

import type { AdminVariables } from './admin.js';
import { requireAdminAuth } from './admin.js';

/** 默认角色显示名（character-registry 的 displayName）——用于"自定义命名"判定 */
const DEFAULT_PET_NAMES = ['星屿', 'CodeNoNo', '奶盖'] as const;

export interface AdminPetsDeps {
  pool: pg.Pool;
  jwt: JwtService;
  adminUsers: PgAdminUserStore;
}

export function createAdminPetsRouter(deps: AdminPetsDeps): Hono<{ Variables: AdminVariables }> {
  const app = new Hono<{ Variables: AdminVariables }>();
  const auth = requireAdminAuth(deps.jwt, deps.adminUsers);

  // ---- 宠物名册统计 ----
  app.get('/pets/stats', auth, async (c) => {
    const total = await deps.pool.query(
      `select count(*)::int as total,
              count(*) filter (where character_id = 'star-isle')::int as star_isle,
              count(*) filter (where character_id = 'codenono')::int as codenono,
              count(*) filter (where character_id = 'cream-kitten')::int as cream_kitten,
              count(*) filter (where name <> all($1::text[]))::int as custom_named
       from pets`,
      [[...DEFAULT_PET_NAMES]],
    );
    const personalities = await deps.pool.query(
      `select personality_mode, count(*)::int as count
       from pets group by personality_mode order by count desc`,
    );
    const r = (total.rows[0] ?? {}) as {
      total?: number;
      star_isle?: number;
      codenono?: number;
      cream_kitten?: number;
      custom_named?: number;
    };
    return c.json({
      total: Number(r.total ?? 0),
      byCharacter: {
        'star-isle': Number(r.star_isle ?? 0),
        codenono: Number(r.codenono ?? 0),
        'cream-kitten': Number(r.cream_kitten ?? 0),
      },
      byPersonality: personalities.rows.map((p) => ({
        mode: p.personality_mode as string,
        count: Number(p.count),
      })),
      customNamed: Number(r.custom_named ?? 0),
    });
  });

  // ---- 羁绊分布 + TOP 羁绊榜 ----
  app.get('/bonds/stats', auth, async (c) => {
    const stats = await deps.pool.query(
      `select count(*)::int as total,
              count(*) filter (where status = 'active')::int as active,
              count(*) filter (where stage = 'first_meet')::int as first_meet,
              count(*) filter (where stage = 'familiar')::int as familiar,
              count(*) filter (where stage = 'trusted')::int as trusted,
              coalesce(round(avg(progress) filter (where status = 'active'), 1), 0) as avg_progress
       from bonds`,
    );
    const top = await deps.pool.query(
      `select b.bond_id, b.stage, b.progress,
              pa.name as pet_a_name, pb.name as pet_b_name,
              ua.email as user_a_email, ub.email as user_b_email
       from bonds b
       join pets pa on pa.pet_id = b.pet_a_id
       join pets pb on pb.pet_id = b.pet_b_id
       join auth.users ua on ua.id = pa.owner_user_id
       join auth.users ub on ub.id = pb.owner_user_id
       where b.status = 'active'
       order by b.progress desc
       limit 20`,
    );
    const s = (stats.rows[0] ?? {}) as {
      total?: number;
      active?: number;
      first_meet?: number;
      familiar?: number;
      trusted?: number;
      avg_progress?: number;
    };
    return c.json({
      total: Number(s.total ?? 0),
      active: Number(s.active ?? 0),
      byStage: {
        first_meet: Number(s.first_meet ?? 0),
        familiar: Number(s.familiar ?? 0),
        trusted: Number(s.trusted ?? 0),
      },
      avgProgress: Number(s.avg_progress ?? 0),
      topBonds: top.rows.map((r) => ({
        bondId: String(r.bond_id),
        stage: r.stage as string,
        progress: Number(r.progress),
        petAName: r.pet_a_name as string,
        petBName: r.pet_b_name as string,
        userAEmail: r.user_a_email as string,
        userBEmail: r.user_b_email as string,
      })),
    });
  });

  // ---- 单用户宠物与羁绊明细 ----
  app.get('/users/:userId/pets', auth, async (c) => {
    const userId = c.req.param('userId');
    if (!isValidUuid(userId)) return c.json({ error: 'invalid_input' }, 422);

    const pets = await deps.pool.query(
      `select pet_id, character_id, name, personality_mode
       from pets where owner_user_id = $1`,
      [userId],
    );
    // 该用户作为羁绊任一方的明细（双向归一为 own/friend 视角）
    const bonds = await deps.pool.query(
      `select b.bond_id, b.stage, b.progress, b.status,
              pa.name as own_pet_name, pb.name as friend_pet_name,
              ub.email as friend_email
       from bonds b
       join pets pa on pa.pet_id = b.pet_a_id
       join pets pb on pb.pet_id = b.pet_b_id
       join auth.users ub on ub.id = pb.owner_user_id
       where pa.owner_user_id = $1
       union all
       select b.bond_id, b.stage, b.progress, b.status,
              pb.name, pa.name, ua.email
       from bonds b
       join pets pa on pa.pet_id = b.pet_a_id
       join pets pb on pb.pet_id = b.pet_b_id
       join auth.users ua on ua.id = pa.owner_user_id
       where pb.owner_user_id = $1
       order by progress desc`,
      [userId],
    );

    return c.json({
      pets: pets.rows.map((r) => ({
        petId: String(r.pet_id),
        characterId: r.character_id as string,
        name: r.name as string,
        personalityMode: r.personality_mode as string,
      })),
      bonds: bonds.rows.map((r) => ({
        bondId: String(r.bond_id),
        stage: r.stage as string,
        progress: Number(r.progress),
        status: r.status as string,
        ownPetName: r.own_pet_name as string,
        friendPetName: r.friend_pet_name as string,
        friendEmail: r.friend_email as string,
      })),
    });
  });

  return app;
}
