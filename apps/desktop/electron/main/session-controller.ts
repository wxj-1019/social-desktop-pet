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
  /** 撤销会话（登出） */
  revoke(refreshToken: string): Promise<void>;
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
      this.state = initialSession();
      return this.state;
    }
    return this.refresh(refresh);
  }

  /** 登录成功后进入 ACTIVE（保存 refresh token） */
  async activate(tokens: SessionTokens, profile: SessionProfile): Promise<SessionState> {
    this.storage.saveRefreshToken(tokens.refreshToken);
    this.state = { phase: 'ACTIVE', profile, tokens };
    return this.state;
  }

  /** access token 过期前自动刷新 */
  async refresh(refreshToken: string): Promise<SessionState> {
    this.state = { ...this.state, phase: 'REFRESHING' };
    try {
      const tokens = await this.auth.refreshAccessToken(refreshToken);
      this.state = { ...this.state, phase: 'ACTIVE', tokens };
      return this.state;
    } catch (e) {
      this.state = { ...this.state, phase: 'EXPIRED', error: (e as Error).message };
      return this.state;
    }
  }

  /** 当前 access token 是否可用（未过期且未被撤销） */
  hasValidAccessToken(): boolean {
    if (this.state.phase !== 'ACTIVE' || !this.state.tokens) return false;
    if (this.revokedAt !== null) return false; // 9.8 撤销双保险
    return this.now() < this.state.tokens.accessExpiresAt;
  }

  /** 9.8：撤销（Auth 撤销 refresh token）—— 但 access token 过期前仍有效 */
  async revoke(): Promise<void> {
    const refresh = this.state.tokens?.refreshToken;
    if (refresh) {
      try {
        await this.auth.revoke(refresh);
      } finally {
        this.revokedAt = this.now();
        this.storage.deleteRefreshToken();
        this.state = { phase: 'SIGNED_OUT', profile: null, tokens: null };
      }
    }
  }

  /** 标记撤销滞后窗口结束（access token 到期后，应用层校验应已生效） */
  get isRevoked(): boolean {
    return this.revokedAt !== null;
  }
}
