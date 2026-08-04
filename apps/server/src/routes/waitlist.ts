/**
 * Waitlist 报名路由（公开，无鉴权）—— 4.3 传播循环的落地页入口。
 *
 * POST /waitlist { email }
 *   → 格式校验（基础正则 + 长度）→ 每 IP 内存限流（12.7 精神）→ 落库
 *   → 201 报名成功 / 409 已在名单（email 唯一兜底）/ 400 非法邮箱 / 429 限流
 *
 * 13.2 事务邮件：报名成功后发确认邮件（MailProvider 注入；失败仅日志，
 * 不阻塞注册——waitlist 已落库，供应商接入后回放补发）。
 */
import type { Hono } from 'hono';
import type pg from 'pg';

import type { MailProvider } from '../lib/mail.js';

export interface WaitlistDeps {
  pool: pg.Pool;
  /** 邮件发送（13.2；无注入则降级日志，不阻塞） */
  mail?: MailProvider;
}

/** 基础邮箱校验（RFC 简化：形如 a@b.c，≤254 字符） */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;

/** 每 IP 60s 窗口报名次数上限（防刷；单实例内存态，多实例升级 Redis） */
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
}
