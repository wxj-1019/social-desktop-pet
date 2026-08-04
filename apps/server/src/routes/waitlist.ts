/**
 * Waitlist 报名路由（公开，无鉴权）—— 4.3 传播循环的落地页入口。
 *
 * POST /waitlist { email }
 *   → 格式校验（基础正则 + 长度）→ 每 IP 内存限流（12.7 精神）→ 落库
 *   → 201 报名成功 / 409 已在名单（email 唯一兜底）/ 400 非法邮箱 / 429 限流
 *
 * 13.2 邀请邮件（pending → invited）待邮件供应商接入后在此触发。
 */
import type { Hono } from 'hono';
import type pg from 'pg';

export interface WaitlistDeps {
  pool: pg.Pool;
}

/** 基础邮箱校验（RFC 简化：形如 a@b.c，≤254 字符） */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;

/** 每 IP 60s 窗口报名次数上限（防刷；单实例内存态，多实例升级 Redis） */
const RATE_LIMIT_MAX = 5;
const RATE_WINDOW_MS = 60_000;
const rateWindows = new Map<string, number[]>();

/** 限流：超限返回剩余等待秒数 */
export function checkWaitlistRateLimit(
  ip: string,
  max = RATE_LIMIT_MAX,
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
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
    return c.json({ ok: true });
  });
}
