/**
 * 关系查询 —— 好友/房间/拉黑/配额/幂等的 SQL 薄层。
 * 判定规则集中在 lib/business-rules.ts（纯函数）。
 */
import type pg from 'pg';

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
