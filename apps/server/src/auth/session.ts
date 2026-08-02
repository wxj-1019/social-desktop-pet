/**
 * 会话管理 —— 自建 Auth 的 refresh token 生命周期（9.8 多设备/撤销）。
 *
 * - 每设备一个 refresh token（devices 表 + 独立 refresh_sessions 记账）
 * - 刷新即轮换（refresh token rotation）：旧 token 一次有效
 * - 激活新设备 → 撤销旧设备的 refresh 会话 + 更新 active_display_device_id（9.8）
 * - 撤销双保险（应用层）：命令落库时校验 active_display_device_id（routes 层实施）
 *
 * 纯逻辑 + 存储接口注入（可单测；pg 实现见 db/sessions.sql 或路由层）。
 */
import { randomBytes, createHash } from 'node:crypto';

export interface RefreshSession {
  tokenHash: string;
  userId: string;
  deviceId: string;
  expiresAt: number;
  revokedAt: number | null;
}

export type SessionRotationErrorCode = 'invalid' | 'revoked' | 'expired';

export class SessionRotationError extends Error {
  constructor(
    readonly code: SessionRotationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SessionRotationError';
  }
}

export interface SessionStore {
  /** 保存 refresh 会话（upsert：同一设备只留最新） */
  save(session: RefreshSession): Promise<void>;
  /** 按 token 哈希取会话；不存在返回 null */
  load(tokenHash: string): Promise<RefreshSession | null>;
  /** 精确撤销单个 refresh token */
  revokeToken(tokenHash: string): Promise<void>;
  /** 原子消费旧 token 并插入下一代 token；竞争失败返回 false */
  rotateToken(tokenHash: string, nextSession: RefreshSession, now: number): Promise<boolean>;
  /** 撤销设备下全部会话（9.8 激活新设备） */
  revokeDevice(userId: string, deviceId: string): Promise<void>;
  /** 设置 active_display_device_id（9.8 单活跃设备） */
  setActiveDisplayDevice(userId: string, deviceId: string): Promise<void>;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class SessionManager {
  constructor(
    private readonly store: SessionStore,
    private readonly refreshTtlMs = 30 * 24 * 60 * 60_000, // 30 天
    private readonly now: () => number = () => Date.now(),
  ) {}

  private createRefreshSession(userId: string, deviceId: string, now: number) {
    const refreshToken = randomBytes(48).toString('base64url');
    const session: RefreshSession = {
      tokenHash: hashRefreshToken(refreshToken),
      userId,
      deviceId,
      expiresAt: now + this.refreshTtlMs,
      revokedAt: null,
    };
    return { refreshToken, session };
  }

  /** 登录成功：签发 refresh token 并记账（每个 token 只存哈希） */
  async createRefreshToken(userId: string, deviceId: string): Promise<string> {
    const created = this.createRefreshSession(userId, deviceId, this.now());
    await this.store.save(created.session);
    return created.refreshToken;
  }

  /**
   * 刷新 access token：校验 → 轮换（旧 token 作废，发新 refresh）。
   * @returns 新的 refresh token；无效/过期/已撤销抛错
   */
  async rotate(token: string): Promise<{ refreshToken: string; userId: string; deviceId: string }> {
    const tokenHash = hashRefreshToken(token);
    const session = await this.store.load(tokenHash);
    if (!session) throw new SessionRotationError('invalid', 'invalid refresh token');
    if (session.revokedAt !== null) {
      throw new SessionRotationError('revoked', 'refresh token revoked');
    }
    const now = this.now();
    if (now >= session.expiresAt) {
      throw new SessionRotationError('expired', 'refresh token expired');
    }

    const next = this.createRefreshSession(session.userId, session.deviceId, now);
    const rotated = await this.store.rotateToken(tokenHash, next.session, now);
    if (!rotated) throw new SessionRotationError('revoked', 'refresh token revoked');
    return {
      refreshToken: next.refreshToken,
      userId: session.userId,
      deviceId: session.deviceId,
    };
  }

  /** 精确撤销 refresh token；未知 token 仍幂等成功。 */
  async revokeToken(refreshToken: string): Promise<void> {
    await this.store.revokeToken(hashRefreshToken(refreshToken));
  }

  /** 撤销设备下全部会话（9.8：切换活跃设备时使用） */
  async revokeDevice(userId: string, deviceId: string): Promise<void> {
    await this.store.revokeDevice(userId, deviceId);
  }
}
