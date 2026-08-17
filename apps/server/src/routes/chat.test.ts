import { LIMITS } from '@pet/config';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';

import type { BusinessVariables } from './business.js';
import { checkRateLimit, enterConcurrency, leaveConcurrency, registerChatRoutes } from './chat.js';

describe('chat 速率限制（12.7 每设备 60s 窗口）', () => {
  it('允许窗口内前 N 次，之后 429（retryAfterSec 合理）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const max = LIMITS.chatRateLimitPerMinute;
    for (let i = 0; i < max; i++) {
      expect(checkRateLimit('dev-1', max).allowed).toBe(true);
    }
    const blocked = checkRateLimit('dev-1', max);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);

    // 60s 后窗口滚动 → 放行
    vi.setSystemTime(1_000_000 + 61_000);
    expect(checkRateLimit('dev-1', max).allowed).toBe(true);
    vi.useRealTimers();
  });

  it('不同设备互不影响', () => {
    expect(checkRateLimit('dev-a', 2).allowed).toBe(true);
    expect(checkRateLimit('dev-a', 2).allowed).toBe(true);
    expect(checkRateLimit('dev-a', 2).allowed).toBe(false);
    expect(checkRateLimit('dev-b', 2).allowed).toBe(true);
  });
});

describe('chat 并发限制（12.7 每设备 ≤2 流式）', () => {
  it('并发槽位占用与释放', () => {
    const max = LIMITS.concurrencyPerDevice;
    expect(enterConcurrency('dev-1', max)).toBe(true);
    expect(enterConcurrency('dev-1', max)).toBe(true);
    expect(enterConcurrency('dev-1', max)).toBe(false); // 第 3 个被拒
    leaveConcurrency('dev-1');
    expect(enterConcurrency('dev-1', max)).toBe(true); // 释放后可进
    leaveConcurrency('dev-1');
    leaveConcurrency('dev-1');
  });
});

describe('POST /chat 输出审核注入（12.5）', () => {
  const jwt = new JwtService({ secret: 'test-secret' });
  const USER_ID = 'user-1';

  /** 最小 pool：每日预算返回 request_count=1（未超限），其余查询空结果 */
  function makePool() {
    const client = {
      query: vi.fn(async (sql: string) => {
        const first = sql.trim().toLowerCase();
        if (first.startsWith('insert into chat_usage')) return { rows: [{ request_count: 1 }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn(async () => client),
      query: vi.fn(async () => ({ rows: [] })),
    };
    return { pool, client };
  }

  async function postChat(app: Hono<{ Variables: BusinessVariables }>, message: string) {
    const token = await jwt.sign({ sub: USER_ID, deviceId: 'dev-1' });
    const res = await app.request('/chat', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message, threadId: 't-1' }),
    });
    await res.text(); // 泵完整 SSE 流（streamSSE 回调在流消费时执行）
    return res;
  }

  it('注入 outputModerator：图内 moderate 被真实调用（阻断路径）', async () => {
    const { pool } = makePool();
    const moderator = {
      moderate: vi.fn(async () => ({
        passed: false,
        blockedCategories: ['pii_credential'],
        crisisLevel: 'none',
      })),
    };
    const honoApp = new Hono<{ Variables: BusinessVariables }>();
    registerChatRoutes(honoApp, {
      jwt,
      pool: pool as never,
      outputModerator: moderator as never,
    });

    const res = await postChat(honoApp, '我的银行卡号是 6222 0000 1234 5678');

    expect(res.status).toBe(200);
    // 注入未生效时规则版 moderateOutputNode 直接内置跑，mock 不会被调用——
    // 此断言即"接线成功"的证据（index.ts:101-108 曾漏传 outputModerator）
    expect(moderator.moderate).toHaveBeenCalledTimes(1);
    expect(moderator.moderate).toHaveBeenCalledWith(expect.any(String), expect.any(Array));
  });
});
