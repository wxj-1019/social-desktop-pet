/**
 * 可靠写入核心 —— 9.4：事务写 events + 双方收件箱 → 提交后 WebSocket 通知。
 *
 * 9.4 流程（免费点心为例）：
 *   1. 客户端提交命令（鉴权在路由层）
 *   2. 服务端从 JWT 取身份，不信任 Payload
 *   3. 路由层验证关系/配额/幂等键
 *   4. deliverEvent：同一事务写 events + 双方 user_inbox
 *   5. 提交后 Realtime 通知（提交才代表成功，WS 只是低延迟通知）
 *   6. HTTP 响应与 WS 事件使用同一 eventId
 */
import type pg from 'pg';

import type { RealtimeServer } from '../realtime/ws.js';

export interface DeliverEventInput {
  pool: pg.Pool;
  realtime: RealtimeServer;
  /** 共享房间（9.3 roomSeq 顺序）；null = 无房间事件 */
  roomId: string | null;
  type: string;
  payload: unknown;
  reliability: 'A' | 'B' | 'C';
  expiresAt?: Date;
  /** 收件人 user ids（各写入独立 inboxSeq） */
  recipients: string[];
  /** 外部事务连接（如命令与幂等回执同事务）；缺省时自开事务 */
  client?: pg.PoolClient;
}

export interface DeliverEventResult {
  eventId: string;
  roomSeq: number | null;
  inboxSeqs: Record<string, number>;
}

export async function deliverEvent(input: DeliverEventInput): Promise<DeliverEventResult> {
  const ownsTxn = !input.client;
  const client = input.client ?? (await input.pool.connect());
  try {
    if (ownsTxn) await client.query('begin');

    // room_seq：rooms 表原子自增（并发安全，9.6）
    let roomSeq: number | null = null;
    if (input.roomId) {
      const { rows } = await client.query(
        'update rooms set next_room_seq = next_room_seq + 1 where room_id = $1 returning next_room_seq',
        [input.roomId],
      );
      roomSeq = Number(rows[0]?.next_room_seq) ?? null;
      if (roomSeq === null) throw new Error(`room 不存在: ${input.roomId}`);
    }

    const { rows: evRows } = await client.query(
      `insert into events (room_id, room_seq, type, payload, reliability, expires_at)
       values ($1, $2, $3, $4::jsonb, $5, $6)
       returning event_id`,
      [
        input.roomId,
        roomSeq,
        input.type,
        JSON.stringify(input.payload),
        input.reliability,
        input.expiresAt ?? null,
      ],
    );
    const eventId = String(evRows[0]?.event_id);

    // 每收件人独立 inboxSeq（全局序列，9.6 单调递增）
    const inboxSeqs: Record<string, number> = {};
    for (const userId of input.recipients) {
      const { rows } = await client.query(
        `insert into user_inbox (user_id, inbox_seq, event_id)
         values ($1, nextval('user_inbox_seq'), $2)
         returning inbox_seq`,
        [userId, eventId],
      );
      inboxSeqs[userId] = Number(rows[0]?.inbox_seq);
    }

    if (ownsTxn) await client.query('commit');

    // 提交后通知（9.4 第 5 步）；离线用户靠 /sync 补齐（9.5 慢路径）
    const serverTimestamp = new Date().toISOString();
    for (const userId of input.recipients) {
      input.realtime.deliver(userId, {
        v: 1,
        type: 'inbox.delivered',
        eventId,
        inboxSeq: inboxSeqs[userId],
        roomSeq,
        serverTimestamp,
        payload: input.payload,
      });
    }

    return { eventId, roomSeq, inboxSeqs };
  } catch (e) {
    if (ownsTxn) await client.query('rollback');
    throw e;
  } finally {
    if (ownsTxn) client.release();
  }
}
