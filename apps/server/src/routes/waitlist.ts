/**
 * Waitlist 路由与邀请状态机 —— 4.3 传播循环 / 13.2 事务邮件。
 *
 * 公开端点：
 *   POST /waitlist           报名（pending；格式校验 + 每 IP 限流 + 唯一冲突 409）
 *   POST /waitlist/claim     兑换邀请码（invited → joined；公开，每 IP 限流）
 * 运营端点（Bearer WAITLIST_ADMIN_TOKEN；未配置时 404 不暴露）：
 *   POST /waitlist/invite    发放邀请（pending → invited：生成 8 位兑换码 +
 *                            邀请邮件 + 30 天过期；支持 emails 列表或 limit 批量）
 *
 * 状态机：
 *   pending --invite--> invited --claim--> joined --register 绑定--> claimed_by
 *   invited --超期未兑换--> expired（惰性判定：claim/查询时检查）
 * 兑换码只存 sha256 哈希（AGENTS.md 第 8 条精神）。
 */
import { createHash, randomInt } from 'node:crypto';

import type { Hono } from 'hono';
import type pg from 'pg';

import type { MailProvider } from '../lib/mail.js';

export interface WaitlistDeps {
  pool: pg.Pool;
  /** 邮件发送（13.2；无注入则降级日志，不阻塞） */
  mail?: MailProvider;
  /** 运营邀请端点密钥（WAITLIST_ADMIN_TOKEN；未配置则 /waitlist/invite 404） */
  adminToken?: string;
  /** 邀请邮件中的兑换链接前缀（如 https://starisle.example/claim；缺省只发码） */
  claimUrlBase?: string;
}

/** 基础邮箱校验（RFC 简化：形如 a@b.c，≤254 字符） */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;

// ---- 兑换码（纯函数，可单测） ----

/** 兑换码字符表：去易混淆 0/O/1/I（8 位 → 34^8 ≈ 1.7e12 空间） */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/** 生成 8 位兑换码（crypto.randomInt，非 Math.random） */
export function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return code;
}

/** 兑换码哈希（落库；明文只在邮件中出现一次） */
export function hashInviteCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

// ---- 邀请状态机 ----

export type ClaimResult =
  | { ok: true }
  | { ok: false; reason: 'not_invited' | 'invalid_code' | 'expired' | 'already_joined' };

export interface InviteResult {
  /** 已发放：明文兑换码只返回给运营端（adminToken 鉴权）；落库为 sha256 */
  invited: Array<{ email: string; code: string }>;
  skipped: string[];
}

const DEFAULT_INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class WaitlistService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly mail?: MailProvider,
    private readonly options: { inviteTtlMs?: number; claimUrlBase?: string } = {},
  ) {}

  /**
   * 发放邀请：pending → invited（生成兑换码 + 邀请邮件 + 过期时间）。
   * 已非 pending 的邮箱跳过（不重复发码）。邮件失败仅日志，状态推进不受影响
   * （邮件供应商接入后由运营重跑补发）。
   */
  async invite(emails: string[]): Promise<InviteResult> {
    const ttl = this.options.inviteTtlMs ?? DEFAULT_INVITE_TTL_MS;
    const invited: InviteResult['invited'] = [];
    const skipped: string[] = [];
    for (const raw of emails) {
      const email = raw.toLowerCase().trim();
      if (!EMAIL_PATTERN.test(email) || email.length > EMAIL_MAX_LENGTH) {
        skipped.push(email);
        continue;
      }
      const code = generateInviteCode();
      const { rowCount } = await this.pool.query(
        `update waitlist set
           status = 'invited',
           invite_code_hash = $2,
           invited_at = now(),
           invite_expires_at = now() + make_interval(secs => $3)
         where email = $1 and status = 'pending'
         returning email`,
        [email, hashInviteCode(code), Math.ceil(ttl / 1000)],
      );
      if (rowCount === 0) {
        skipped.push(email);
        continue;
      }
      invited.push({ email, code });
      // 邀请邮件：兑换码明文只进邮件；失败仅日志（状态已推进，可补发）
      if (this.mail) {
        const claimUrl = this.options.claimUrlBase
          ? `${this.options.claimUrlBase}?code=${code}&email=${encodeURIComponent(email)}`
          : null;
        void this.mail
          .send(
            email,
            '星屿邀请码',
            `<p>你被邀请加入星屿（Star Isle）！</p>` +
              `<p>兑换码：<strong>${code}</strong>（30 天内有效）</p>` +
              (claimUrl ? `<p>前往兑换：<a href="${claimUrl}">${claimUrl}</a></p>` : ''),
          )
          .catch((e) => console.warn('[waitlist] 邀请邮件发送失败：', (e as Error).message));
      }
    }
    return { invited, skipped };
  }

  /** 公开兑换：invited → joined（校验码 + 邮箱匹配；惰性过期判定） */
  async claim(email: string, code: string): Promise<ClaimResult> {
    const { rows } = await this.pool.query(
      `select status, invite_code_hash, invite_expires_at from waitlist where email = $1`,
      [email.toLowerCase()],
    );
    const row = rows[0];
    if (!row || row.status === 'pending') return { ok: false, reason: 'not_invited' };

    // 惰性过期：invited 且已超期 → 置 expired（查询时顺带推进）
    if (
      row.status === 'invited' &&
      row.invite_expires_at !== null &&
      (row.invite_expires_at as Date).getTime() < Date.now()
    ) {
      await this.pool.query(
        `update waitlist set status = 'expired' where email = $1 and status = 'invited'`,
        [email.toLowerCase()],
      );
      return { ok: false, reason: 'expired' };
    }
    if (row.status === 'expired') return { ok: false, reason: 'expired' };
    if (row.status === 'joined') return { ok: false, reason: 'already_joined' };

    // status = invited：校验码
    if (String(row.invite_code_hash ?? '') !== hashInviteCode(code)) {
      return { ok: false, reason: 'invalid_code' };
    }
    await this.pool.query(
      `update waitlist set status = 'joined', claimed_at = now()
       where email = $1 and status = 'invited'`,
      [email.toLowerCase()],
    );
    return { ok: true };
  }

  /** 注册绑定：joined/invited → joined + claimed_by（幂等；register 成功后调用） */
  async bindJoinedUser(email: string, userId: string): Promise<void> {
    await this.pool.query(
      `update waitlist set status = 'joined', claimed_by = $2
       where email = $1 and status in ('invited', 'joined') and claimed_by is null`,
      [email.toLowerCase(), userId],
    );
  }
}

/** 每 IP 60s 窗口报名/兑换次数上限（防刷；单实例内存态，多实例升级 Redis） */
const RATE_LIMIT_MAX = 5;
const RATE_WINDOW_MS = 60_000;
/** 内部限流状态（导出仅供测试观察；窗口过期即清理 key，防无限膨胀） */
export const rateWindows = new Map<string, number[]>();
/** 上次清扫时间（惰性清扫：仅在有请求时推进） */
let lastSweepAt = 0;

/** 测试辅助：重置限流状态（模块级状态跨测试共享，防时间回拨干扰清扫守卫） */
export function resetWaitlistRateLimitForTest(): void {
  rateWindows.clear();
  lastSweepAt = 0;
}

/**
 * 惰性清扫：每 RATE_WINDOW_MS 至多扫一次，删除所有记录已全部过期的 key。
 * 否则 Map 会随"历史见过但不再回访的 IP"无限膨胀（每条 key 永驻内存）。
 */
function sweepRateWindows(now: number): void {
  if (now - lastSweepAt < RATE_WINDOW_MS) return;
  lastSweepAt = now;
  for (const [ip, times] of rateWindows) {
    if (times.every((t) => now - t >= RATE_WINDOW_MS)) rateWindows.delete(ip);
  }
}

/** 限流：超限返回剩余等待秒数 */
export function checkWaitlistRateLimit(
  ip: string,
  max = RATE_LIMIT_MAX,
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  sweepRateWindows(now);
  const window = (rateWindows.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (window.length >= max) {
    const oldest = window[0] ?? now;
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((oldest + RATE_WINDOW_MS - now) / 1000)),
    };
  }
  window.push(now);
  rateWindows.set(ip, window);
  return { allowed: true, retryAfterSec: 0 };
}

export function registerWaitlistRoutes(app: Hono, deps: WaitlistDeps): void {
  const service = new WaitlistService(deps.pool, deps.mail, {
    claimUrlBase: deps.claimUrlBase,
  });

  app.post('/waitlist', async (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    const { email } = (await c.req.json().catch(() => ({}))) as { email?: string };
    if (typeof email !== 'string' || email.length === 0 || email.length > EMAIL_MAX_LENGTH) {
      return c.json({ error: 'email 非法' }, 400);
    }
    if (!EMAIL_PATTERN.test(email)) {
      return c.json({ error: 'email 格式非法' }, 400);
    }

    const rate = checkWaitlistRateLimit(ip);
    if (!rate.allowed) {
      return c.json({ error: 'rate_limit', retryAfterSec: rate.retryAfterSec }, 429);
    }

    try {
      const { rowCount } = await deps.pool.query(
        `insert into waitlist (email) values ($1) on conflict (email) do nothing`,
        [email.toLowerCase()],
      );
      // 唯一约束兜底：重复报名 → 409（客户端按"已在名单"处理）
      if (rowCount === 0) {
        return c.json({ error: 'already_registered' }, 409);
      }
    } catch {
      return c.json({ error: '报名失败，请稍后再试' }, 500);
    }
    // 13.2 确认邮件：失败仅记日志不阻塞注册（waitlist 已落库，可回放补发）
    if (deps.mail) {
      void deps.mail
        .send(
          email.toLowerCase(),
          '欢迎加入星屿等待名单',
          `<p>你的邮箱 ${email.toLowerCase()} 已加入星屿（Star Isle）等待名单。</p>` +
            '<p>正式开放时我们会第一时间通知你，保持期待～</p>',
        )
        .catch((e) => {
          console.warn('[waitlist] 确认邮件发送失败：', (e as Error).message);
        });
    }
    return c.json({ ok: true });
  });

  // 运营端点：发放邀请（pending → invited）。未配置 adminToken → 404 不暴露。
  app.post('/waitlist/invite', async (c) => {
    if (!deps.adminToken) return c.json({ error: 'not_found' }, 404);
    if (c.req.header('authorization') !== `Bearer ${deps.adminToken}`) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const { emails, limit } = (await c.req.json().catch(() => ({}))) as {
      emails?: string[];
      limit?: number;
    };
    let targets: string[];
    if (Array.isArray(emails) && emails.length > 0) {
      targets = emails.slice(0, 100);
    } else {
      const n = Math.min(Math.max(Number(limit ?? 10), 1), 100);
      const { rows } = await deps.pool.query(
        `select email from waitlist where status = 'pending' order by created_at asc limit $1`,
        [n],
      );
      targets = rows.map((r) => String(r.email));
    }
    const result = await service.invite(targets);
    return c.json({ ok: true, ...result });
  });

  // 公开兑换：invited → joined（码校验 + 邮箱匹配；每 IP 限流防爆破）
  app.post('/waitlist/claim', async (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    const { email, code } = (await c.req.json().catch(() => ({}))) as {
      email?: string;
      code?: string;
    };
    if (typeof email !== 'string' || typeof code !== 'string' || code.length !== 8) {
      return c.json({ error: 'email/code 非法' }, 400);
    }
    if (!EMAIL_PATTERN.test(email)) return c.json({ error: 'email 格式非法' }, 400);

    const rate = checkWaitlistRateLimit(ip);
    if (!rate.allowed) {
      return c.json({ error: 'rate_limit', retryAfterSec: rate.retryAfterSec }, 429);
    }

    const result = await service.claim(email, code);
    if (!result.ok) {
      return c.json({ error: result.reason }, 401);
    }
    return c.json({ ok: true });
  });
}
