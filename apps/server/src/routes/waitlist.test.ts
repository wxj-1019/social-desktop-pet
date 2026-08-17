/**
 * /waitlist 报名路由测试 —— 201/409/400/429 + 邮箱校验。
 */
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkWaitlistRateLimit,
  hashInviteCode,
  rateWindows,
  registerWaitlistRoutes,
  resetWaitlistRateLimitForTest,
  WaitlistService,
} from './waitlist.js';

// 6.4 flaky 治理：假定时器必须兜底恢复（中途断言失败不再泄漏到后续用例）
afterEach(() => {
  vi.useRealTimers();
});

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

  it('惰性清扫：窗口过期后不再回访的 IP 的 key 被清理（Map 不随任意 IP 无限膨胀）', () => {
    resetWaitlistRateLimitForTest(); // 模块级状态，避免前序测试污染
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    checkWaitlistRateLimit('ip-gone');
    expect(rateWindows.size).toBe(1);

    // 61s 后其他 IP 请求触发清扫：ip-gone 记录已全部过期 → 被删除
    vi.setSystemTime(1_000_000 + 61_000);
    checkWaitlistRateLimit('ip-other');
    expect(rateWindows.has('ip-gone')).toBe(false);
    expect(rateWindows.has('ip-other')).toBe(true);
    expect(rateWindows.size).toBe(1);
    vi.useRealTimers();
  });
});

describe('邀请状态机（4.3：pending → invited → joined/expired）', () => {
  /** 脚本化 pool：按调用序执行 handler（返回 rows/rowCount） */
  function makeScriptedPool(
    script: Array<(sql: string, params?: unknown[]) => { rows?: unknown[]; rowCount?: number }>,
  ) {
    let i = 0;
    return {
      query: vi.fn(async (sql: string, params?: unknown[]) =>
        (script[i++] ?? (() => ({ rows: [] })))(sql, params),
      ),
    };
  }

  // 模块级共享 MAIL mock：每用例前清计数（顺序相关断言不跨用例泄漏）
  const MAIL = { send: vi.fn(async () => undefined) };
  beforeEach(() => {
    MAIL.send.mockClear();
  });

  describe('WaitlistService.invite（pending → invited）', () => {
    it('生成 8 位兑换码 + sha256 落库 + 邀请邮件；非 pending 跳过', async () => {
      const calls: Array<{ sql: string; params?: unknown[] }> = [];
      const pool = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          calls.push({ sql, params });
          // 第一个邮箱 pending（推进），第二个非 pending（跳过）
          return { rowCount: String(params?.[0]) === 'a@b.com' ? 1 : 0 };
        }),
      };
      const service = new WaitlistService(pool as never, MAIL, {
        claimUrlBase: 'https://x.example/claim',
      });

      const result = await service.invite(['A@b.com', 'already@b.com']);

      // 运营端拿回明文兑换码（adminToken 鉴权端点）；落库是 sha256
      expect(result.invited).toHaveLength(1);
      const { email, code } = result.invited[0] as { email: string; code: string };
      expect(email).toBe('a@b.com');
      expect(code).toMatch(/^[A-Z2-9]{8}$/);
      expect(result.skipped).toEqual(['already@b.com']);
      expect(MAIL.send).toHaveBeenCalledTimes(1);
      const [to, subject, html] = MAIL.send.mock.calls[0] as unknown as [string, string, string];
      expect(to).toBe('a@b.com');
      expect(subject).toContain('邀请');
      // 落库的是 sha256 哈希，不是明文
      const updateCall = calls.find((c) => c.sql.includes("status = 'invited'"));
      const params = updateCall?.params as [string, string, number];
      expect(params[1]).toBe(hashInviteCode(code));
      expect(params[1]).not.toContain(code);
      // 邮件带兑换码与链接
      expect(html).toContain(code);
      expect(html).toContain('https://x.example/claim');
    });

    it('非法邮箱直接跳过（不落库不发信）', async () => {
      const pool = makeScriptedPool([]);
      const service = new WaitlistService(pool as never, MAIL);
      const result = await service.invite(['not-an-email']);
      expect(result).toEqual({ invited: [], skipped: ['not-an-email'] });
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('WaitlistService.claim（invited → joined）', () => {
    const INVITED_ROW = {
      status: 'invited',
      invite_code_hash: hashInviteCode('ABCD2345'),
      invite_expires_at: new Date(Date.now() + 60_000),
    };

    it('正确码 → ok；错误码 → invalid_code', async () => {
      const pool = makeScriptedPool([
        () => ({ rows: [INVITED_ROW] }), // select
        () => ({ rows: [] }), // update joined
      ]);
      const service = new WaitlistService(pool as never);
      expect(await service.claim('a@b.com', 'ABCD2345')).toEqual({ ok: true });
      const updateSql = pool.query.mock.calls[1]?.[0] as string;
      expect(updateSql).toContain("status = 'joined'");

      const poolBad = makeScriptedPool([() => ({ rows: [INVITED_ROW] })]);
      const serviceBad = new WaitlistService(poolBad as never);
      expect(await serviceBad.claim('a@b.com', 'WRONG123')).toEqual({
        ok: false,
        reason: 'invalid_code',
      });
    });

    it('超期 → 惰性置 expired 并返回 expired', async () => {
      const expiredRow = {
        ...INVITED_ROW,
        invite_expires_at: new Date(Date.now() - 1000),
      };
      const pool = makeScriptedPool([
        () => ({ rows: [expiredRow] }),
        () => ({ rows: [] }), // update expired
      ]);
      const service = new WaitlistService(pool as never);
      expect(await service.claim('a@b.com', 'ABCD2345')).toEqual({ ok: false, reason: 'expired' });
      const updateSql = pool.query.mock.calls[1]?.[0] as string;
      expect(updateSql).toContain("status = 'expired'");
    });

    it('pending → not_invited；joined → already_joined', async () => {
      const service = new WaitlistService(
        makeScriptedPool([() => ({ rows: [{ status: 'pending' }] })]) as never,
      );
      expect(await service.claim('p@b.com', 'ABCD2345')).toEqual({
        ok: false,
        reason: 'not_invited',
      });

      const joined = new WaitlistService(
        makeScriptedPool([() => ({ rows: [{ status: 'joined' }] })]) as never,
      );
      expect(await joined.claim('j@b.com', 'ABCD2345')).toEqual({
        ok: false,
        reason: 'already_joined',
      });
    });
  });

  describe('WaitlistService.bindJoinedUser（注册绑定）', () => {
    it('仅 invited/joined 绑定 claimed_by（幂等）', async () => {
      const pool = makeScriptedPool([]);
      const service = new WaitlistService(pool as never);
      await service.bindJoinedUser('a@b.com', 'u1');
      const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("status in ('invited', 'joined')");
      expect(sql).toContain('claimed_by is null');
      expect(params).toEqual(['a@b.com', 'u1']);
    });
  });

  describe('路由端点', () => {
    it('/waitlist/invite：未配置 adminToken → 404；错 token → 401；对 token → 200', async () => {
      // 未配置 adminToken：端点不暴露（404）
      const hiddenApp = new Hono();
      registerWaitlistRoutes(hiddenApp, { pool: makePool(1) as never });
      const hidden = await hiddenApp.request('/waitlist/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ emails: ['a@b.com'] }),
      });
      expect(hidden.status).toBe(404);

      const app = new Hono();
      registerWaitlistRoutes(app, { pool: makePool(1) as never, adminToken: 'op-secret' });
      const noAuth = await app.request('/waitlist/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
        body: JSON.stringify({ emails: ['a@b.com'] }),
      });
      expect(noAuth.status).toBe(401);

      const pool = {
        query: vi.fn(async () => ({ rowCount: 1 })),
      };
      const appOk = new Hono();
      registerWaitlistRoutes(appOk, {
        pool: pool as never,
        adminToken: 'op-secret',
      });
      const ok = await appOk.request('/waitlist/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer op-secret' },
        body: JSON.stringify({ emails: ['a@b.com'] }),
      });
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { invited: Array<{ email: string; code: string }> };
      expect(body.invited[0]?.email).toBe('a@b.com');
      expect(body.invited[0]?.code).toMatch(/^[A-Z2-9]{8}$/);
    });

    it('/waitlist/claim：成功 200；错误码 401；格式 400', async () => {
      const pool = {
        query: vi.fn(async (sql: string) => {
          if (sql.includes('select status')) {
            return {
              rows: [
                {
                  status: 'invited',
                  invite_code_hash: hashInviteCode('ABCD2345'),
                  invite_expires_at: new Date(Date.now() + 60_000),
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };
      const app = new Hono();
      registerWaitlistRoutes(app, { pool: pool as never });

      const ok = await app.request('/waitlist/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com', code: 'ABCD2345' }),
      });
      expect(ok.status).toBe(200);

      const bad = await app.request('/waitlist/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com', code: 'WRONG123' }),
      });
      expect(bad.status).toBe(401);
      expect(await bad.json()).toEqual({ error: 'invalid_code' });

      const malformed = await app.request('/waitlist/claim', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.com', code: 'short' }),
      });
      expect(malformed.status).toBe(400);
    });
  });
});
