/**
 * HTTP 层防护中间件（P1-4）—— 全局兜底，路由层业务校验仍是主防线。
 *
 * - bodyLimit：content-length 超限即 413（拒绝超大请求体）；
 *   chunked（无 content-length）场景由各路由自身长度校验兜底
 *   （如 /chat message 2000 字符、/gift 小 payload）。
 * - globalRateLimit：每 IP 滑动窗口限流（默认 600 次/分，桌面端单用户场景宽裕；
 *   超限 429 + retryAfterSec）。/healthz 豁免（LB/探针高频）。
 * - 入站超时与安全头由 hono 内置 timeout / secureHeaders 在服务入口挂载。
 */
import type { MiddlewareHandler } from 'hono';

/** 默认请求体上限：256KB（聊天正文上限 2000 字符，正常业务远小于此） */
export const MAX_BODY_BYTES = 256 * 1024;

/** 有请求体的方法才做 content-length 校验（GET 无 body） */
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export function bodyLimitMiddleware(maxBytes = MAX_BODY_BYTES): MiddlewareHandler {
  return async (c, next) => {
    if (BODY_METHODS.has(c.req.method)) {
      const len = Number(c.req.header('content-length') ?? 0);
      if (Number.isFinite(len) && len > maxBytes) {
        return c.json({ error: 'payload_too_large' }, 413);
      }
    }
    await next();
  };
}

/** 客户端 IP：PET_TRUST_PROXY=true 时信 X-Forwarded-For（反代后），否则 socket 地址 */
function clientIpOf(c: {
  req: { header(name: string): string | undefined };
  env?: { incoming?: { socket?: { remoteAddress?: string } } };
}): string {
  if (process.env['PET_TRUST_PROXY'] === 'true') {
    const xff = c.req.header('x-forwarded-for');
    if (xff) return xff.split(',')[0]!.trim();
  }
  return c.env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

/** 全局每 IP 滑动窗口限流（内存态；单实例语义，多实例时上移至 Redis） */
export function globalRateLimitMiddleware(limit = 600, windowMs = 60_000): MiddlewareHandler {
  const hits = new Map<string, number[]>();
  // 定期清过期键，防 IP 基数累积泄漏
  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, ts] of hits) {
      const alive = ts.filter((t) => t > cutoff);
      if (alive.length === 0) hits.delete(ip);
      else hits.set(ip, alive);
    }
  }, windowMs);
  sweep.unref();

  return async (c, next) => {
    if (c.req.path === '/healthz') return next();
    const ip = clientIpOf(c);
    const now = Date.now();
    const cutoff = now - windowMs;
    const ts = (hits.get(ip) ?? []).filter((t) => t > cutoff);
    if (ts.length >= limit) {
      return c.json({ error: 'rate_limit', retryAfterSec: Math.ceil(windowMs / 1000) }, 429);
    }
    ts.push(now);
    hits.set(ip, ts);
    await next();
  };
}
