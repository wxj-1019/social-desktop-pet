/**
 * 邮箱 OTP 服务 —— 13.2 事务邮件（OTP 登录）。
 *
 * 安全设计：
 * - code 6 位数字，只存 sha256 哈希（明文绝不下落）
 * - TTL 15 分钟；5 次尝试上限（防爆破）；60s 重发冷却
 * - 消费用乐观锁（consumeIfUnused）：并发校验同一 code 只有一个成功
 * - 过期/已消费行在 request 时顺带清理（防表膨胀）
 *
 * 邮件经注入的 MailProvider（SMTP）；未配置邮件时 OTP 仍可发放——
 * devCodeInResponse 仅限开发环境（PET_DEV_OTP_CODE_IN_RESPONSE=true），
 * 生产绝不开启（否则验证码直接泄露给调用方）。
 */
import { createHash, randomInt } from 'node:crypto';

import type { MailProvider } from '../lib/mail.js';

export interface OtpCodeRow {
  otpId: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
}

/** OTP 存储接口（pg 实现注入，逻辑保持可单测） */
export interface OtpCodeStore {
  create(email: string, codeHash: string, expiresAt: Date): Promise<void>;
  /** 最近一条（含已消费/过期，供冷却与校验） */
  findLatest(email: string): Promise<OtpCodeRow | null>;
  /** 该邮箱未消费且未过期的 OTP 数量（pending 上限防刷） */
  countPending(email: string): Promise<number>;
  incrementAttempts(otpId: string): Promise<void>;
  /** 乐观消费：仅当未消费时置 consumed_at；返回是否抢到 */
  consumeIfUnused(otpId: string): Promise<boolean>;
  /** 清理该邮箱过期/已消费行（request 时顺带） */
  cleanup(email: string): Promise<void>;
}

export interface OtpServiceOptions {
  /** 开发环境把 code 返回给调用方（e2e/联调；生产绝不开启） */
  devCodeInResponse?: boolean;
  ttlMs?: number;
  maxAttempts?: number;
  resendCooldownMs?: number;
  maxPendingPerEmail?: number;
}

export type OtpRequestResult =
  | { status: 'sent'; devCode?: string }
  | { status: 'cooldown'; retryAfterSec: number }
  | { status: 'too_many_pending' };

export type OtpVerifyResult =
  { ok: true } | { ok: false; reason: 'no_code' | 'expired' | 'attempts_exceeded' | 'invalid' };

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_MAX_PENDING = 5;
const CODE_LENGTH = 6;

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** 生成 6 位数字验证码（crypto.randomInt，非 Math.random） */
export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

export class OtpService {
  constructor(
    private readonly store: OtpCodeStore,
    private readonly mail?: MailProvider,
    private readonly options: OtpServiceOptions = {},
  ) {}

  async request(email: string): Promise<OtpRequestResult> {
    const now = Date.now();
    const ttl = this.options.ttlMs ?? DEFAULT_TTL_MS;
    const cooldown = this.options.resendCooldownMs ?? DEFAULT_COOLDOWN_MS;
    const maxPending = this.options.maxPendingPerEmail ?? DEFAULT_MAX_PENDING;

    await this.store.cleanup(email);

    // 冷却：最近一条未消费 OTP 仍在冷却窗口内 → 429
    const latest = await this.store.findLatest(email);
    if (latest && !latest.consumedAt && latest.expiresAt.getTime() > now) {
      const createdAge = now - (latest.expiresAt.getTime() - ttl);
      const waitMs = cooldown - createdAge;
      if (waitMs > 0) {
        return { status: 'cooldown', retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)) };
      }
    }

    // pending 上限（防刷爆表）
    const pending = await this.store.countPending(email);
    if (pending >= maxPending) return { status: 'too_many_pending' };

    const code = generateOtpCode();
    await this.store.create(email, sha256(code), new Date(now + ttl));

    // 邮件发送失败不阻塞发放（记录日志；dev 环境靠 devCode 自愈）
    if (this.mail) {
      await this.mail
        .send(
          email,
          '星屿登录验证码',
          `<p>你的登录验证码是：<strong>${code}</strong></p>` +
            `<p>15 分钟内有效。如果不是你本人操作，请忽略本邮件。</p>`,
        )
        .catch((e) => console.warn('[otp] 邮件发送失败：', (e as Error).message));
    }

    return {
      status: 'sent',
      ...(this.options.devCodeInResponse ? { devCode: code } : {}),
    };
  }

  async verify(email: string, code: string): Promise<OtpVerifyResult> {
    const now = Date.now();
    const maxAttempts = this.options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const latest = await this.store.findLatest(email);
    if (!latest || latest.consumedAt) return { ok: false, reason: 'no_code' };
    if (latest.expiresAt.getTime() < now) return { ok: false, reason: 'expired' };
    if (latest.attempts >= maxAttempts) return { ok: false, reason: 'attempts_exceeded' };

    if (sha256(code) !== latest.codeHash) {
      await this.store.incrementAttempts(latest.otpId);
      return { ok: false, reason: 'invalid' };
    }
    // 乐观消费：并发下只有一个请求能抢到
    const consumed = await this.store.consumeIfUnused(latest.otpId);
    if (!consumed) return { ok: false, reason: 'no_code' };
    return { ok: true };
  }
}
