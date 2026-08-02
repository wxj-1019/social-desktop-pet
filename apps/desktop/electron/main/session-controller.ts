/**
 * SessionController —— 对应设计稿 9.8 多设备 + 8.3 令牌安全存储。
 *
 * 会话状态机（纯逻辑，可单测）：
 *   SIGNED_OUT → SIGNING_IN → ACTIVE ⇄ REFRESHING → EXPIRED → SIGNED_OUT
 *                  └────────────→ ERROR
 *
 * 职责：
 * - 管理 access token / refresh token 生命周期（access TTL 短，9.8 撤销滞后窗口）
 * - 设备标识（device_id）+ active_display_device 概念（9.8）
 * - 令牌经 SecureStorageController（safeStorage）加密存储，绝不落明文
 * - 撤销：Auth 撤销 + 应用层 active_display_device_id 校验双保险（9.8 修订）
 */

export type SessionPhase =
  'SIGNED_OUT' | 'SIGNING_IN' | 'ACTIVE' | 'REFRESHING' | 'EXPIRED' | 'ERROR';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  /** access token 到期时间（ms epoch）—— TTL 短（9.8 建议 15 分钟） */
  accessExpiresAt: number;
}

export interface SessionProfile {
  userId: string;
  deviceId: string;
  nickname?: string;
}

export interface SessionState {
  phase: SessionPhase;
  profile: SessionProfile | null;
  tokens: SessionTokens | null;
  error?: string;
}

export interface SessionStorage {
  /** 读取 refresh token（安全存储，8.3） */
  loadRefreshToken(): string | null;
  /** 保存 refresh token */
  saveRefreshToken(token: string): void;
  /** 删除 refresh token（登出/撤销） */
  deleteRefreshToken(): void;
}

export interface SessionAuthApi {
  /** 刷新 access token；失败抛错 */
  refreshAccessToken(refreshToken: string): Promise<SessionTokens>;
  /** 加载当前设备的用户资料；失败抛错 */
  loadProfile(accessToken: string): Promise<SessionProfile>;
  /** 撤销会话（登出） */
  revoke(refreshToken: string): Promise<void>;
}

/** refresh rotation 的可判别错误：仅 invalidToken=true 时清除安全存储。 */
export class SessionRefreshError extends Error {
  constructor(
    message: string,
    readonly invalidToken: boolean,
  ) {
    super(message);
    this.name = 'SessionRefreshError';
  }
}

interface RefreshOperationContext {
  generation: number;
  refreshToken: string;
  operationId: symbol;
}

interface RefreshOperation extends RefreshOperationContext {
  promise: Promise<SessionState>;
}

/** 创建初始状态 */
export function initialSession(): SessionState {
  return { phase: 'SIGNED_OUT', profile: null, tokens: null };
}

/**
 * 会话控制器（纯逻辑 + 注入存储/Auth API，main 进程组装真实实现）。
 */
export class SessionController {
  private state: SessionState = initialSession();
  private generation = 0;
  private readonly refreshOperations = new Map<string, RefreshOperation>();
  private currentRefreshKey: string | null = null;
  /** 9.8 撤销滞后窗口：Auth 撤销后 access token 过期前仍有效，需应用层校验 */
  private revokedAt: number | null = null;

  constructor(
    private readonly storage: SessionStorage,
    private readonly auth: SessionAuthApi,
    private readonly accessTtlMs = 15 * 60_000, // 9.8：TTL 短，缩小撤销滞后窗口
    private readonly now: () => number = () => Date.now(),
  ) {}

  get snapshot(): SessionState {
    return this.state;
  }

  /** 启动时恢复：有 refresh token → 刷新进入 ACTIVE */
  async restore(): Promise<SessionState> {
    const refresh = this.storage.loadRefreshToken();
    if (!refresh) {
      this.advanceGeneration();
      this.revokedAt = null;
      this.state = initialSession();
      return this.state;
    }
    return this.refresh(refresh);
  }

  /** 登录成功后进入 ACTIVE（保存 refresh token） */
  async activate(tokens: SessionTokens, profile: SessionProfile): Promise<SessionState> {
    this.advanceGeneration();
    this.revokedAt = null;
    this.storage.saveRefreshToken(tokens.refreshToken);
    this.state = { phase: 'ACTIVE', profile, tokens };
    return this.state;
  }

  /** access token 过期前自动刷新；相同代际和 refresh token 共享独立 operation */
  refresh(refreshToken?: string): Promise<SessionState> {
    const token =
      refreshToken ?? this.state.tokens?.refreshToken ?? this.storage.loadRefreshToken() ?? '';
    const generation = this.generation;
    const key = this.refreshKey(generation, token);
    this.currentRefreshKey = key;
    this.state = { ...this.state, phase: 'REFRESHING' };

    const existing = this.refreshOperations.get(key);
    if (existing) return existing.promise;

    const context: RefreshOperationContext = {
      generation,
      refreshToken: token,
      operationId: Symbol('session-refresh'),
    };
    const promise = this.performRefresh(context, key).finally(() => {
      if (this.refreshOperations.get(key)?.operationId === context.operationId) {
        this.refreshOperations.delete(key);
      }
    });
    this.refreshOperations.set(key, { ...context, promise });
    return promise;
  }

  private refreshKey(generation: number, refreshToken: string): string {
    return `${generation}\0${refreshToken}`;
  }

  private advanceGeneration(): void {
    this.generation += 1;
    this.currentRefreshKey = null;
    this.refreshOperations.clear();
  }

  private isCurrentRefresh(context: RefreshOperationContext, key: string): boolean {
    return (
      this.generation === context.generation &&
      this.currentRefreshKey === key &&
      this.refreshOperations.get(key)?.operationId === context.operationId
    );
  }

  private revokeStaleRefreshToken(token: string): void {
    void this.auth.revoke(token).catch(() => undefined);
  }

  private async performRefresh(
    context: RefreshOperationContext,
    key: string,
  ): Promise<SessionState> {
    const { refreshToken } = context;
    let tokens: SessionTokens;
    try {
      tokens = await this.auth.refreshAccessToken(refreshToken);
    } catch (e) {
      if (!this.isCurrentRefresh(context, key)) return this.state;

      const error = e instanceof Error ? e.message : String(e);
      const invalidToken =
        typeof e === 'object' && e !== null && 'invalidToken' in e && e.invalidToken === true;
      if (invalidToken) {
        this.storage.deleteRefreshToken();
        this.state = { phase: 'EXPIRED', profile: null, tokens: null, error };
      } else {
        this.state = { ...this.state, phase: 'ERROR', error };
      }
      return this.state;
    }

    if (!this.isCurrentRefresh(context, key)) {
      this.revokeStaleRefreshToken(tokens.refreshToken);
      return this.state;
    }
    this.storage.saveRefreshToken(tokens.refreshToken);
    this.state = { phase: 'REFRESHING', profile: this.state.profile, tokens };

    try {
      const profile = await this.auth.loadProfile(tokens.accessToken);
      if (!this.isCurrentRefresh(context, key)) {
        this.revokeStaleRefreshToken(tokens.refreshToken);
        return this.state;
      }

      this.state = { phase: 'ACTIVE', profile, tokens };
      return this.state;
    } catch (e) {
      if (!this.isCurrentRefresh(context, key)) {
        this.revokeStaleRefreshToken(tokens.refreshToken);
        return this.state;
      }

      this.state = {
        phase: 'ERROR',
        profile: this.state.profile,
        tokens,
        error: e instanceof Error ? e.message : String(e),
      };
      return this.state;
    }
  }

  /** 当前 access token 是否可用（未过期且未被撤销） */
  hasValidAccessToken(): boolean {
    if (this.state.phase !== 'ACTIVE' || !this.state.tokens) return false;
    if (this.revokedAt !== null) return false; // 9.8 撤销双保险
    return this.now() < this.state.tokens.accessExpiresAt;
  }

  /** 9.8：撤销远端会话并立即完成本地登出，不等待网络响应 */
  async revoke(): Promise<void> {
    this.advanceGeneration();
    const refresh = this.state.tokens?.refreshToken ?? this.storage.loadRefreshToken();

    this.revokedAt = this.now();
    this.storage.deleteRefreshToken();
    this.state = { phase: 'SIGNED_OUT', profile: null, tokens: null };

    if (refresh) this.revokeStaleRefreshToken(refresh);
  }

  /** 标记撤销滞后窗口结束（access token 到期后，应用层校验应已生效） */
  get isRevoked(): boolean {
    return this.revokedAt !== null;
  }
}
