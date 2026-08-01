/**
 * RealtimeClient —— 9.2/9.4：WSS 收事件（替代/兜底轮询）。
 *
 * 协议（与服务端 realtime/ws.ts 对应）：
 *   连接 → { type:'auth', token } → auth_ok
 *   之后：客户端 { type:'ping' } → 服务端 { type:'pong' }
 *   服务端推送：{ type:'inbox.delivered', eventId, inboxSeq, ... }
 *
 * 9.7 重连：指数退避（0.5/1/2/4/8s，最大 30s）+ 抖动；重连成功后由调用方走 /sync 补缺。
 */

/** 9.7 重连退避（纯函数，可单测）：attempt=0 → 500ms，上限 30s */
export function retryDelayMs(attempt: number): number {
  const base = 500 * 2 ** Math.min(attempt, 6); // 0.5→1→2→4→8→16→32，第 6 次起封顶
  return Math.min(base, 30_000);
}

export type RealtimeStatus = 'disconnected' | 'connecting' | 'connected';

export interface RealtimeHandlers {
  /** 服务端推送事件（inbox.delivered 等） */
  onEvent?: (event: Record<string, unknown>) => void;
  onStatus?: (status: RealtimeStatus) => void;
  onReconnected?: () => void;
}

/** ws 地址：http:// → ws://，https:// → wss:// */
export function toWsUrl(apiBase: string, path = '/realtime'): string {
  return apiBase.replace(/^http/, 'ws') + path;
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private status: RealtimeStatus = 'disconnected';
  private attempt = 0;
  private everConnected = false;
  private closedByUser = false;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly url: string,
    private readonly getToken: () => string | null,
    private readonly handlers: RealtimeHandlers = {},
    private readonly clock: () => number = Date.now,
  ) {}

  /** 建立连接（断线自动重连，9.7） */
  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  /** 主动关闭（登出时调用） */
  close(): void {
    this.closedByUser = true;
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
    this.setStatus('disconnected');
  }

  get currentStatus(): RealtimeStatus {
    return this.status;
  }

  private open(): void {
    const token = this.getToken();
    if (!token) return; // 无 token 不连接（未登录）
    this.setStatus('connecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      // 鉴权握手（服务端首个消息必须是 auth）
      ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (ev) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (msg.type === 'auth_ok') {
        const wasConnected = this.everConnected;
        this.everConnected = true;
        this.attempt = 0;
        this.setStatus('connected');
        this.startHeartbeat(ws);
        // 重连成功（非首次）→ 调用方走 /sync 补缺（9.7）
        if (wasConnected) this.handlers.onReconnected?.();
        return;
      }
      if (msg.type === 'pong') return;
      this.handlers.onEvent?.(msg);
    };

    ws.onclose = () => {
      this.stopHeartbeat();
      this.ws = null;
      if (!this.closedByUser) this.scheduleReconnect();
    };
    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect(): void {
    this.setStatus('disconnected');
    const delay = retryDelayMs(this.attempt++);
    setTimeout(() => {
      if (!this.closedByUser) this.open();
    }, delay);
    // 引用 clock 保持测试可注入（未直接使用则忽略）
    void this.clock;
  }

  private startHeartbeat(ws: WebSocket): void {
    this.stopHeartbeat();
    // 10s 心跳（与服务端 ping→pong 协议对应）
    this.heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 10_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private setStatus(s: RealtimeStatus): void {
    this.status = s;
    this.handlers.onStatus?.(s);
  }
}
