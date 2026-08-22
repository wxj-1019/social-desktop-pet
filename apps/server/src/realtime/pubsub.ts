/**
 * 跨实例广播 —— Postgres LISTEN/NOTIFY（多实例支持，零新增服务成本）。
 *
 * 背景：RealtimeServer 的连接表是单进程内存态，多实例部署时 WS 投递与
 * presence 只覆盖本实例。此模块用 PG NOTIFY 做实例间信令：
 * - ws.delivery：投递事件到"用户实际连接所在"的实例（NOTIFY 广播，目标实例投本地连接）
 * - presence.ping：各实例周期上报本地在线用户集合，供 isOnline 聚合全局视图
 *
 * 约束：pg_notify payload ≤ 8000 字节——业务通知（gift/visit/presence/bond）远小于
 * 此限；超限时 publish 抛错由调用方降级（DB 已提交，仅通知迟到，靠 /sync 补齐）。
 * 单实例部署同样可运行：NOTIFY 自环消息由消费方按 instanceId 去重。
 */
import { randomUUID } from 'node:crypto';

import pg from 'pg';

export type PubSubHandler = (payload: unknown) => void;

export interface ClusterPubSub {
  /** 本实例 id（自环去重） */
  readonly instanceId: string;
  /** 发布逻辑频道消息（NOTIFY 广播到全部实例，含自己） */
  publish(channel: string, payload: unknown): Promise<void>;
  /** 订阅逻辑频道（start 前后均可注册） */
  on(channel: string, handler: (payload: unknown) => void): void;
  close(): Promise<void>;
}

/** NOTIFY 物理通道（单通道 + 内嵌逻辑频道，减少 listen 数量） */
const PG_CHANNEL = 'pet_cluster';

/** publish 序列化上限（pg_notify 硬限 8000，留余量） */
const MAX_PAYLOAD_CHARS = 7000;

export class PgPubSub implements ClusterPubSub {
  readonly instanceId = randomUUID();
  private client: pg.Client | null = null;
  private readonly handlers = new Map<string, PubSubHandler[]>();

  constructor(private readonly connectionString: string) {}

  /** 建立独占连接并 LISTEN（pool 连接不可用：LISTEN 需要 idle 独占会话） */
  async start(onError?: (e: Error) => void): Promise<void> {
    const client = new pg.Client({ connectionString: this.connectionString });
    this.client = client;
    client.on('notification', (msg) => {
      if (msg.channel !== PG_CHANNEL || !msg.payload) return;
      try {
        const parsed = JSON.parse(msg.payload) as { channel: string; payload: unknown };
        for (const handler of this.handlers.get(parsed.channel) ?? []) handler(parsed.payload);
      } catch {
        /* 非 JSON 载荷忽略（其它系统的 NOTIFY） */
      }
    });
    client.on('error', (e) => onError?.(e));
    await client.connect();
    await client.query(`listen ${PG_CHANNEL}`);
  }

  /** 订阅逻辑频道（start 前后均可注册） */
  on(channel: string, handler: PubSubHandler): void {
    this.handlers.set(channel, [...(this.handlers.get(channel) ?? []), handler]);
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    const body = JSON.stringify({ channel, payload });
    if (body.length > MAX_PAYLOAD_CHARS) {
      throw new Error(`pubsub payload 超限（${body.length} > ${MAX_PAYLOAD_CHARS} 字节）`);
    }
    const client = this.client;
    if (!client) return; // 未 start：静默降级为纯本地（单实例语义）
    await client.query('select pg_notify($1, $2)', [PG_CHANNEL, body]);
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.handlers.clear();
    if (client) await client.end().catch(() => undefined);
  }
}

/** 测试用内存实现（不经 PG；直接路由回本实例） */
export class InMemoryPubSub implements ClusterPubSub {
  readonly instanceId = randomUUID();
  private readonly handlers = new Map<string, PubSubHandler[]>();
  /** publish 时的旁路（测试断言广播内容用） */
  readonly published: Array<{ channel: string; payload: unknown }> = [];

  on(channel: string, handler: PubSubHandler): void {
    this.handlers.set(channel, [...(this.handlers.get(channel) ?? []), handler]);
  }

  async publish(channel: string, payload: unknown): Promise<void> {
    this.published.push({ channel, payload });
    for (const handler of this.handlers.get(channel) ?? []) handler(payload);
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}
