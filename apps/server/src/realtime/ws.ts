/**
 * Realtime —— 自建 WebSocket 服务（D-13，替代 Supabase Realtime Broadcast/Presence）。
 *
 * 职责（9.2/9.4）：
 * - 长连接鉴权（首个消息携带 access token；JWT 校验）
 * - 在线状态注册（Presence 等价物：user_id → 连接集合；离线自动清理）
 * - 收件箱事件投递（9.4：提交事务后调用 deliver 推给在线接收方）
 * - 心跳保活（ws ping/pong，断连清理）
 *
 * 架构：单 Node 进程内 Map 路由；多实例时升级为 Redis pub/sub（首版不引入，9.1）。
 */
import { WebSocketServer, WebSocket } from 'ws';

import type { JwtService } from '../auth/jwt.js';

import type { ClusterPubSub } from './pubsub.js';

export interface RealtimeEvents {
  /** 在线状态变化（V-10 压测 + Presence 替代） */
  onPresenceChanged?: (userId: string, online: boolean) => void;
  /** 连接鉴权成功（每次连接触发一次；用于 last_seen_at 等按连接刷新的副作用） */
  onAuthenticated?: (userId: string, deviceId: string | null) => void;
  /** 集群广播失败（仅日志降级：DB 已提交，通知迟到由 /sync 补齐） */
  onPubSubError?: (e: Error) => void;
}

export class RealtimeServer {
  private wss: WebSocketServer | null = null;
  /** user_id → 活跃连接集合 */
  private readonly conns = new Map<string, Set<WebSocket>>();
  /** 服务端心跳定时器（attach 启动，close 清理） */
  private heartbeatTimer: NodeJS.Timeout | null = null;
  /** presence/鉴权钩子（构造后注入：presence 钩子依赖本实例的 deliver） */
  private events: RealtimeEvents;
  /** 集群广播（未接入时纯本地单实例语义） */
  private pubsub: ClusterPubSub | null = null;
  /** 远端实例在线集合聚合（instanceId → 最后 ping 时间 + 用户集合） */
  private readonly remoteInstances = new Map<string, { seenAt: number; userIds: Set<string> }>();
  /** presence 心跳上报定时器（attachPubSub 启动，close 清理） */
  private presencePingTimer: ReturnType<typeof globalThis.setInterval> | null = null;

  constructor(
    private readonly jwt: JwtService,
    events: RealtimeEvents = {},
    /** 心跳间隔；测试可注入更小值或直接调 heartbeatTick() */
    private readonly heartbeatIntervalMs = 30_000,
    /** 账号暂停校验（管理后台 suspend 后已认证连接立即拒绝，不等 access token 过期） */
    private readonly checkUserSuspended?: (userId: string) => Promise<boolean>,
  ) {
    this.events = events;
  }

  /** 注入/替换事件钩子（构造后调用；presence 钩子需要本实例的 deliver） */
  setEvents(events: RealtimeEvents): void {
    this.events = events;
  }

  /**
   * 接入集群广播（多实例支持；PgPubSub 见 pubsub.ts）：
   * - deliver → 同时 NOTIFY，远端实例投本地连接（自环按 instanceId 去重）
   * - 周期上报本实例在线集合（presence.ping），isOnline 聚合全局视图
   * - 心跳 tick 顺带清理失联实例的陈旧在线集合（远端实例崩溃无法发下线通知）
   */
  attachPubSub(pubsub: ClusterPubSub): void {
    this.pubsub = pubsub;
    pubsub.on('ws.delivery', (msg) => {
      const { from, userId, event } = msg as { from: string; userId: string; event: unknown };
      if (from === pubsub.instanceId) return;
      this.deliverLocal(userId, event);
    });
    pubsub.on('presence.ping', (msg) => {
      const { from, userIds } = msg as { from: string; userIds: string[] };
      if (from === pubsub.instanceId) return;
      this.remoteInstances.set(from, {
        seenAt: Date.now(),
        userIds: new Set(userIds),
      });
    });
    this.presencePingTimer = globalThis.setInterval(() => void this.publishPresencePing(), 60_000);
    this.presencePingTimer.unref?.();
    void this.publishPresencePing();
  }

  private async publishPresencePing(): Promise<void> {
    const pubsub = this.pubsub;
    if (!pubsub) return;
    await pubsub
      .publish('presence.ping', {
        from: pubsub.instanceId,
        userIds: [...this.conns.keys()],
      })
      .catch((e) => this.events.onPubSubError?.(e as Error));
  }

  /** 清理失联远端实例的在线集合（3 分钟无 ping 视为下线；挂 heartbeatTick 周期执行） */
  cleanupStaleRemoteInstances(now = Date.now()): void {
    for (const [instanceId, remote] of this.remoteInstances) {
      if (now - remote.seenAt > 180_000) this.remoteInstances.delete(instanceId);
    }
  }

  /** 附加到 HTTP 服务器（@hono/node-server 的 server 实例） */
  attach(server: {
    on(event: 'upgrade', cb: (req: unknown, socket: unknown, head: unknown) => void): void;
  }): void {
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      // 路径过滤：仅 /realtime 走 WS
      const url = new URL((req as { url: string }).url, 'http://localhost');
      if (url.pathname !== '/realtime') {
        (socket as { destroy(): void }).destroy();
        return;
      }
      this.wss?.handleUpgrade(req as never, socket as never, head as never, (ws) => {
        this.wss?.emit('connection', ws, req);
      });
    });

    this.wss.on('connection', (ws) => {
      // 8.x 稳定性：未监听 'error' 时 EventEmitter 会把 socket 错误（ECONNRESET 等）
      // 直接抛出 → 单个客户端异常即可让整个服务进程崩溃。error 后交给 close 清理。
      ws.on('error', () => ws.close());
      // 服务端心跳标记：本轮 tick 前未收到 pong 视为僵尸连接，terminate 清理
      const sock = ws as WebSocket & { isAlive?: boolean };
      sock.isAlive = true;
      ws.on('pong', () => {
        sock.isAlive = true;
      });
      // 鉴权握手：首条消息 { type: 'auth', token }
      ws.once('message', (data) => void this.handleAuth(ws, data));
      ws.on('close', () => this.remove(ws));
    });

    // 服务端心跳：周期性 ping，未响应（断网未发 FIN 的僵尸连接）terminate
    this.heartbeatTimer = setInterval(() => this.heartbeatTick(), this.heartbeatIntervalMs);
  }

  /**
   * 心跳 tick（可单独调用便于测试）：对每个连接 ping；
   * 上一轮 tick 置 false 后本轮仍为 false（即未收到 pong）→ terminate 清理。
   */
  heartbeatTick(): void {
    this.cleanupStaleRemoteInstances();
    for (const set of this.conns.values()) {
      for (const ws of set) {
        const sock = ws as WebSocket & { isAlive?: boolean };
        if (sock.isAlive === false) {
          ws.terminate();
          this.remove(ws);
          continue;
        }
        sock.isAlive = false;
        if (ws.readyState === WebSocket.OPEN) ws.ping();
      }
    }
  }

  private async handleAuth(ws: WebSocket, data: unknown): Promise<void> {
    try {
      const msg = JSON.parse(String(data)) as { type?: string; token?: string };
      if (msg.type !== 'auth' || typeof msg.token !== 'string') {
        ws.close(4401, 'auth required');
        return;
      }
      const payload = await this.jwt.verify(msg.token);
      // 账号暂停：管理后台 suspend 后已登录连接立即断开（kickUser 断开现有连接，
      // 此处挡住被踢后重连；与 requireAuth 的 account_status 校验同语义）
      if (this.checkUserSuspended && (await this.checkUserSuspended(payload.sub))) {
        ws.close(4403, 'suspended');
        return;
      }
      this.register(payload.sub, ws);
      this.events.onAuthenticated?.(payload.sub, payload.deviceId ?? null);
      // 鉴权通过后：心跳保活（客户端 ping → pong；V-10 压测依赖）
      ws.on('message', (heartbeat) => {
        try {
          const m = JSON.parse(String(heartbeat)) as { type?: string };
          if (m.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
          }
        } catch {
          /* 非 JSON 消息忽略 */
        }
      });
      ws.send(JSON.stringify({ type: 'auth_ok', userId: payload.sub }));
    } catch {
      ws.close(4401, 'invalid token');
    }
  }

  private register(userId: string, ws: WebSocket): void {
    let set = this.conns.get(userId);
    if (!set) {
      set = new Set();
      this.conns.set(userId, set);
      this.events.onPresenceChanged?.(userId, true);
    }
    set.add(ws);
    ws.on('close', () => this.remove(ws));
  }

  private remove(ws: WebSocket): void {
    for (const [userId, set] of this.conns) {
      if (set.delete(ws)) {
        if (set.size === 0) {
          this.conns.delete(userId);
          this.events.onPresenceChanged?.(userId, false);
        }
        return;
      }
    }
  }

  /** 投递事件给在线用户（9.4：提交事务后调用；离线用户靠 /sync 补齐）。
   *  多实例：同时广播到集群（用户实际连接所在实例投递本地连接；自环去重） */
  deliver(userId: string, event: unknown): number {
    const delivered = this.deliverLocal(userId, event);
    const pubsub = this.pubsub;
    if (pubsub) {
      void pubsub
        .publish('ws.delivery', { from: pubsub.instanceId, userId, event })
        .catch((e) => this.events.onPubSubError?.(e as Error));
    }
    return delivered;
  }

  /** 本实例连接投递（远端消息到达时使用，不再回广播） */
  private deliverLocal(userId: string, event: unknown): number {
    const set = this.conns.get(userId);
    if (!set) return 0;
    const payload = JSON.stringify(event);
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
    return set.size;
  }

  /** 查询在线状态（Presence 快照；本实例连接 ∪ 远端实例上报的在线集合） */
  isOnline(userId: string): boolean {
    if (this.conns.has(userId)) return true;
    for (const remote of this.remoteInstances.values()) {
      if (remote.userIds.has(userId)) return true;
    }
    return false;
  }

  /** 强制断开某用户全部连接（账号暂停等管理操作；close 事件自然清理 conns） */
  kickUser(userId: string): void {
    const set = this.conns.get(userId);
    if (!set) return;
    for (const ws of set) ws.close();
  }

  /** 在线用户数（V-10 压测指标） */
  get onlineUsers(): number {
    return this.conns.size;
  }

  close(): void {
    if (this.presencePingTimer !== null) {
      clearInterval(this.presencePingTimer);
      this.presencePingTimer = null;
    }
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.wss?.close();
    this.conns.clear();
  }
}
