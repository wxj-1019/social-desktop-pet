/**
 * HTTP 层防护中间件（P1-4）—— 全局兜底，路由层业务校验仍是主防线。
 *
 * - bodyLimit：content-length 超限即 413（拒绝超大请求体）；
 *   chunked（无 content-length）场景由各路由自身长度校验兜底
 *   （如 /chat message 2000 字符、/gift 小 payload）。
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
