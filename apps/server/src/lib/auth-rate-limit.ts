/**
 * 认证限流（9.8 / 13.2 防爆破）—— 登录/注册/OTP 的 IP + 账号级防护。
 * - 滑动窗口限流（惰性清扫，防 Map 无限膨胀）
 * - 连续失败锁定 + 指数退避（达阈值触发，锁定时间随失败次数翻倍）
 *
 * 内存态（单实例够用；多实例部署升级 Redis —— 与 chat.ts 速率限制同策略）。
 */

export interface AuthRateLimiterOptions {
  /** 滑动窗口长度 */
  windowMs: number;
  /** 每窗口最大请求数 */
  maxPerWindow: number;
  /** 连续失败多少次触发锁定 */
  lockThreshold: number;
  /** 首次锁定基数（达阈值时）；此后每次失败翻倍，封顶 lockMaxMs */
  lockBaseMs: number;
  lockMaxMs: number;
}

const DEFAULT_OPTS: AuthRateLimiterOptions = {
  windowMs: 60_000,
  maxPerWindow: 20,
  lockThreshold: 5,
  lockBaseMs: 30_000,
  lockMaxMs: 15 * 60_000,
};

export class AuthRateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();
  private lastSweepAt = 0;

  constructor(private readonly opts: AuthRateLimiterOptions = DEFAULT_OPTS) {}

  /** 滑动窗口限流：超限返回剩余等待秒数，否则记录并放行 */
  check(key: string): { allowed: boolean; retryAfterSec: number } {
    const now = Date.now();
    this.sweep(now);
    const window = (this.windows.get(key) ?? []).filter((t) => now - t < this.opts.windowMs);
    if (window.length >= this.opts.maxPerWindow) {
      const oldest = window[0] ?? now;
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((oldest + this.opts.windowMs - now) / 1000)),
      };
    }
    window.push(now);
    this.windows.set(key, window);
    return { allowed: true, retryAfterSec: 0 };
  }

  /** 是否处于失败锁定：返回剩余秒数 */
  lockStatus(key: string): { locked: boolean; retryAfterSec: number } {
    const f = this.failures.get(key);
    if (!f) return { locked: false, retryAfterSec: 0 };
    const wait = f.lockedUntil - Date.now();
    if (wait > 0) return { locked: true, retryAfterSec: Math.max(1, Math.ceil(wait / 1000)) };
    return { locked: false, retryAfterSec: 0 };
  }

  /** 记录一次失败：达阈值触发锁定，锁定时间随失败次数指数增长 */
  recordFailure(key: string): void {
    const f = this.failures.get(key);
    const count = (f?.count ?? 0) + 1;
    if (count >= this.opts.lockThreshold) {
      // 第 N 次失败锁定 base×2^(N-threshold)，封顶 lockMaxMs
      const delay = Math.min(
        this.opts.lockBaseMs * 2 ** (count - this.opts.lockThreshold),
        this.opts.lockMaxMs,
      );
      this.failures.set(key, { count, lockedUntil: Date.now() + delay });
    } else {
      this.failures.set(key, { count, lockedUntil: 0 });
    }
  }

  /** 成功登录清除失败计数 */
  clear(key: string): void {
    this.failures.delete(key);
  }

  /** 惰性清扫：窗口内至少一个请求仍活跃的 key 保留，其余清除 */
  private sweep(now: number): void {
    if (now - this.lastSweepAt < this.opts.windowMs) return;
    this.lastSweepAt = now;
    for (const [key, times] of this.windows) {
      if (times.every((t) => now - t >= this.opts.windowMs)) this.windows.delete(key);
    }
    for (const [key, f] of this.failures) {
      if (now > f.lockedUntil) this.failures.delete(key);
    }
  }

  /** 测试辅助：清空全部状态 */
  reset(): void {
    this.windows.clear();
    this.failures.clear();
    this.lastSweepAt = 0;
  }
}

/** 客户端 IP：优先 x-forwarded-for 首段（生产反代注入），否则 local（与 waitlist 同策略） */
export function clientIpOf(c: { req: { header(name: string): string | undefined } }): string {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}
