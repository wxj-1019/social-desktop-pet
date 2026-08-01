import { LIMITS } from '@pet/config';
import { describe, expect, it, vi } from 'vitest';

import { checkRateLimit, enterConcurrency, leaveConcurrency } from './chat.js';

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
