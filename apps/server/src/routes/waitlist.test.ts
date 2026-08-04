/**
 * /waitlist 报名路由测试 —— 201/409/400/429 + 邮箱校验。
 */
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { checkWaitlistRateLimit, registerWaitlistRoutes } from './waitlist.js';

function makePool(rowCount: number | null = 1) {
  return {
    query: vi.fn(async () => ({ rowCount })),
  };
}

function makeApp(pool: unknown) {
  const app = new Hono();
  registerWaitlistRoutes(app, { pool: pool as never });
  return app;
}

async function post(app: Hono, body: unknown, ip?: string) {
  return app.request('/waitlist', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /waitlist（4.3 公开报名）', () => {
  it('合法邮箱 → 201 落库（小写归一）', async () => {
    const pool = makePool(1);
    const app = makeApp(pool);
    const res = await post(app, { email: 'Alice@Example.com' }, '1.1.1.1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('on conflict (email) do nothing'),
      ['alice@example.com'],
    );
  });

  it('重复邮箱（唯一冲突）→ 409 already_registered', async () => {
    const pool = makePool(0);
    const app = makeApp(pool);
    const res = await post(app, { email: 'a@b.com' }, '1.1.1.2');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_registered' });
  });

  it('非法邮箱/缺邮箱 → 400', async () => {
    const app = makeApp(makePool(1));
    expect((await post(app, { email: 'not-an-email' }, '1.1.1.3')).status).toBe(400);
    expect((await post(app, {}, '1.1.1.3')).status).toBe(400);
    expect((await post(app, { email: '' }, '1.1.1.3')).status).toBe(400);
  });

  it('每 IP 限流：窗口内第 6 次 → 429', async () => {
    const app = makeApp(makePool(1));
    for (let i = 0; i < 5; i++) {
      const res = await post(app, { email: `u${i}@b.com` }, '2.2.2.2');
      expect(res.status).toBe(200);
    }
    const blocked = await post(app, { email: 'u5@b.com' }, '2.2.2.2');
    expect(blocked.status).toBe(429);
    // 不同 IP 不受影响
    const other = await post(app, { email: 'v@b.com' }, '3.3.3.3');
    expect(other.status).toBe(200);
  });
});

describe('checkWaitlistRateLimit（纯函数）', () => {
  it('窗口滑动：超限后返回 retryAfterSec，窗口过期后放行', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    for (let i = 0; i < 5; i++) {
      expect(checkWaitlistRateLimit('ip-a').allowed).toBe(true);
    }
    const blocked = checkWaitlistRateLimit('ip-a');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);

    vi.setSystemTime(1_000_000 + 61_000);
    expect(checkWaitlistRateLimit('ip-a').allowed).toBe(true);
    vi.useRealTimers();
  });
});
