/**
 * 关系查询 —— 好友/房间/拉黑/配额/幂等的 SQL 薄层。
 * 判定规则集中在 lib/business-rules.ts（纯函数）。
 */
import type pg from 'pg';

import { bondStageFor } from './business-rules.js';

/** 连接类型：Pool 或事务中的 PoolClient（两者都有 .query） */
export type Db = pg.Pool | pg.PoolClient;

export interface FriendshipRow {
  friendship_id: string;
  user_low_id: string;
  user_high_id: string;
  status: string;
}

/** 查 active 好友关系（任意方向） */
export async function findActiveFriendship(
  db: Db,
  a: string,
  b: string,
): Promise<FriendshipRow | null> {
  const { rows } = await db.query(
    `select friendship_id, user_low_id, user_high_id, status
     from friendships
     where status = 'active'
       and ((user_low_id = $1 and user_high_id = $2) or (user_low_id = $2 and user_high_id = $1))
     limit 1`,
    [a, b],
  );
  return (rows[0] as FriendshipRow | undefined) ?? null;
}

/** 是否存在拉黑（任意方向） */
export async function isBlocked(db: Db, a: string, b: string): Promise<boolean> {
  const { rows } = await db.query(
    'select 1 from blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1) limit 1',
    [a, b],
  );
  return rows.length > 0;
}

/** 该用户今天已送出的免费点心数（9.4 每日配额） */
export async function todayGiftCount(db: Db, userId: string): Promise<number> {
  const { rows } = await db.query(
    `select count(*)::int as n from gift_events
     where from_user = $1 and created_at >= date_trunc('day', now())`,
    [userId],
  );
  return Number(rows[0]?.n ?? 0);
}

/** 幂等键读取：返回已有回执（重放场景），无则 null */
export async function findReceipt(
  db: Db,
  userId: string,
  deviceId: string,
  clientEventId: string,
): Promise<{ event_id: string | null; result: unknown } | null> {
  const { rows } = await db.query(
    'select event_id, result from command_receipts where user_id = $1 and device_id = $2 and client_event_id = $3',
    [userId, deviceId, clientEventId],
  );
  const row = rows[0];
  if (!row) return null;
  return { event_id: row.event_id as string | null, result: row.result as unknown };
}

/** 好友关系的共享房间：恰好包含两位成员的 friend 房间，不存在则创建。
 *  幂等（migration 0014）：rooms.member_key 唯一索引 + insert on conflict，
 *  并发互送礼/拜访不会建重复房间。 */
export async function findOrCreateRoom(
  client: pg.PoolClient,
  userA: string,
  userB: string,
): Promise<string> {
  const memberKey = [userA, userB].sort().join(':');
  // 先查（常规路径一次查询）
  const { rows: found } = await client.query(
    `select room_id from rooms where type = 'friend' and member_key = $1 limit 1`,
    [memberKey],
  );
  if (found[0]) return String(found[0].room_id);

  // 幂等创建：并发下只有一个 insert 成功（on conflict do nothing）
  const { rows: created } = await client.query(
    `insert into rooms (type, member_key) values ('friend', $1)
     on conflict (member_key) where type = 'friend' and member_key is not null
     do nothing returning room_id`,
    [memberKey],
  );
  if (created[0]) {
    const roomId = String(created[0].room_id);
    await client.query(
      'insert into room_members (room_id, user_id) values ($1, $2), ($1, $3) on conflict do nothing',
      [roomId, userA, userB],
    );
    return roomId;
  }
  // 并发下对方已创建：再查一次返回既有房间
  const { rows: retry } = await client.query(
    `select room_id from rooms where type = 'friend' and member_key = $1 limit 1`,
    [memberKey],
  );
  return String(retry[0]?.room_id);
}

/** 用户的默认宠物（bonds 外键前提；注册不建 pets 行，此处 lazy init：
 *  character_id 默认 star-isle，name 取 profiles.nickname——桌面端皮肤同步后续接 pet 上报）。 */
export async function findOrCreatePet(client: pg.PoolClient, userId: string): Promise<string> {
  const { rows: found } = await client.query(
    'select pet_id from pets where owner_user_id = $1 order by pet_id limit 1',
    [userId],
  );
  if (found[0]) return String(found[0].pet_id);
  const { rows: created } = await client.query(
    `insert into pets (owner_user_id, character_id, name)
     select $1, 'star-isle', coalesce(nickname, '星屿') from profiles where user_id = $1
     returning pet_id`,
    [userId],
  );
  if (created[0]) return String(created[0].pet_id);
  // profiles 不存在（理论不可达：外键链路保证）——兜底直接建
  const { rows: fallback } = await client.query(
    `insert into pets (owner_user_id, character_id, name) values ($1, 'star-isle', '星屿') returning pet_id`,
    [userId],
  );
  return String(fallback[0].pet_id);
}

export interface BondRow {
  bond_id: string;
  stage: 'first_meet' | 'familiar' | 'trusted';
  progress: number;
}

/** 查/建羁绊（0005：visits.bond_id 由此回填）；pet_a 对应 user_low、pet_b 对应 user_high */
export async function findOrCreateBond(
  client: pg.PoolClient,
  friendship: FriendshipRow,
): Promise<BondRow> {
  const { rows: found } = await client.query(
    `select bond_id, stage, progress from bonds
     where friendship_id = $1 and status = 'active' limit 1`,
    [friendship.friendship_id],
  );
  if (found[0]) {
    const r = found[0];
    return { bond_id: String(r.bond_id), stage: r.stage, progress: Number(r.progress) };
  }
  const petA = await findOrCreatePet(client, friendship.user_low_id);
  const petB = await findOrCreatePet(client, friendship.user_high_id);
  const { rows: created } = await client.query(
    `insert into bonds (friendship_id, pet_a_id, pet_b_id)
     values ($1, $2, $3) returning bond_id, stage, progress`,
    [friendship.friendship_id, petA, petB],
  );
  const r = created[0];
  return { bond_id: String(r.bond_id), stage: r.stage, progress: Number(r.progress) };
}

export interface BondAdvanceResult extends BondRow {
  /** 本次互动是否触发阶段升级（first_meet→familiar→trusted） */
  stageUpgraded: boolean;
}

/** 羁绊推进（7.4 有效共同事件累计 +1）：送礼/拜访事务内调用；阶段阈值见 business-rules */
export async function advanceBond(
  client: pg.PoolClient,
  friendship: FriendshipRow,
): Promise<BondAdvanceResult> {
  const bond = await findOrCreateBond(client, friendship);
  const progress = bond.progress + 1;
  const stage = bondStageFor(progress);
  await client.query('update bonds set progress = $2, stage = $3 where bond_id = $1', [
    bond.bond_id,
    progress,
    stage,
  ]);
  return { ...bond, progress, stage, stageUpgraded: stage !== bond.stage };
}
