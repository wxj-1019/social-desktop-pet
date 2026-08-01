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

export interface RealtimeEvents {
  /** 在线状态变化（V-10 压测 + Presence 替代） */
  onPresenceChanged?: (userId: string, online: boolean) => void;
}

export class RealtimeServer {
  private wss: WebSocketServer | null = null;
  /** user_id → 活跃连接集合 */
  private readonly conns = new Map<string, Set<WebSocket>>();

  constructor(
    private readonly jwt: JwtService,
    private readonly events: RealtimeEvents = {},
  ) {}

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
      // 鉴权握手：首条消息 { type: 'auth', token }
      ws.once('message', (data) => void this.handleAuth(ws, data));
      // 心跳保活
      ws.on('pong', () => undefined);
      ws.on('close', () => this.remove(ws));
    });
  }

  private async handleAuth(ws: WebSocket, data: unknown): Promise<void> {
    try {
      const msg = JSON.parse(String(data)) as { type?: string; token?: string };
      if (msg.type !== 'auth' || typeof msg.token !== 'string') {
        ws.close(4401, 'auth required');
        return;
      }
      const payload = await this.jwt.verify(msg.token);
      this.register(payload.sub, ws);
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

  /** 投递事件给在线用户（9.4：提交事务后调用；离线用户靠 /sync 补齐） */
  deliver(userId: string, event: unknown): number {
    const set = this.conns.get(userId);
    if (!set) return 0;
    const payload = JSON.stringify(event);
    for (const ws of set) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
    return set.size;
  }

  /** 在线用户数（V-10 压测指标） */
  get onlineUsers(): number {
    return this.conns.size;
  }

  close(): void {
    this.wss?.close();
    this.conns.clear();
  }
}
