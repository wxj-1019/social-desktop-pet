/**
 * 管理员会话 —— refresh token 生命周期（与用户 SessionManager 同语义：
 * 只存哈希、刷新即轮换、全量撤销）。存储注入便于单测。
 */
import { randomBytes } from 'node:crypto';

import { hashRefreshToken, SessionRotationError } from './session.js';

export interface AdminSession {
  tokenHash: string;
  adminId: string;
  expiresAt: number;
  revokedAt: number | null;
}

export interface AdminSessionStore {
  save(session: AdminSession): Promise<void>;
  load(tokenHash: string): Promise<AdminSession | null>;
  /** 原子消费旧 token 并插入下一代；竞争失败返回 false */
  rotateToken(tokenHash: string, next: AdminSession, now: number): Promise<boolean>;
  revokeToken(tokenHash: string): Promise<void>;
  revokeAllForAdmin(adminId: string): Promise<void>;
}

export { SessionRotationError };

export class AdminSessionManager {
  constructor(
    private readonly store: AdminSessionStore,
    private readonly refreshTtlMs = 30 * 24 * 60 * 60_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private createSession(
    adminId: string,
    now: number,
  ): { refreshToken: string; session: AdminSession } {
    const refreshToken = randomBytes(48).toString('base64url');
    return {
      refreshToken,
      session: {
        tokenHash: hashRefreshToken(refreshToken),
        adminId,
        expiresAt: now + this.refreshTtlMs,
        revokedAt: null,
      },
    };
  }

  async createRefreshToken(adminId: string): Promise<string> {
    const { refreshToken, session } = this.createSession(adminId, this.now());
    await this.store.save(session);
    return refreshToken;
  }

  async rotate(token: string): Promise<{ refreshToken: string; adminId: string }> {
    const tokenHash = hashRefreshToken(token);
    const session = await this.store.load(tokenHash);
    if (!session) throw new SessionRotationError('invalid', 'invalid refresh token');
    if (session.revokedAt !== null)
      throw new SessionRotationError('revoked', 'refresh token revoked');
    const now = this.now();
    if (now >= session.expiresAt)
      throw new SessionRotationError('expired', 'refresh token expired');
    const next = this.createSession(session.adminId, now);
    const rotated = await this.store.rotateToken(tokenHash, next.session, now);
    if (!rotated) throw new SessionRotationError('revoked', 'refresh token revoked');
    return { refreshToken: next.refreshToken, adminId: session.adminId };
  }

  async revokeToken(refreshToken: string): Promise<void> {
    await this.store.revokeToken(hashRefreshToken(refreshToken));
  }

  async revokeAllForAdmin(adminId: string): Promise<void> {
    await this.store.revokeAllForAdmin(adminId);
  }
}
