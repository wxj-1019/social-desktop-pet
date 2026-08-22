/**
 * 结构化日志 —— JSON lines 输出（stdout/stderr），零依赖。
 *
 * 企业级观测地基：每条日志带 ts/level/msg/requestId；requestId 由
 * requestIdMiddleware 经 AsyncLocalStorage 贯穿单次请求的所有日志，
 * 响应头回传 x-request-id 便于客户端对账。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { MiddlewareHandler } from 'hono';

import { recordRequest } from './metrics.js';

const requestContext = new AsyncLocalStorage<{ requestId: string }>();

/** 当前请求 id（无请求上下文时 undefined；供业务代码附加到日志） */
export function currentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}

type LogField = Record<string, unknown>;

function write(level: 'info' | 'warn' | 'error', msg: string, fields?: LogField): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    requestId: currentRequestId() ?? null,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  info(msg: string, fields?: LogField): void {
    write('info', msg, fields);
  },
  warn(msg: string, fields?: LogField): void {
    write('warn', msg, fields);
  },
  error(msg: string, fields?: LogField): void {
    write('error', msg, fields);
  },
};

/**
 * request-id 中间件：客户端 x-request-id（透传）或服务端生成；
 * 注入响应头并进入 AsyncLocalStorage（业务日志自动携带）。
 */
export function requestIdMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const id = c.req.header('x-request-id') ?? randomUUID();
    c.header('x-request-id', id);
    await requestContext.run({ requestId: id }, () => next());
  };
}

/**
 * 访问日志中间件：方法/路径/状态/耗时（与 metrics 指标同源采集，一次遍历两份输出）。
 * 挂在 requestIdMiddleware 之后（同一 requestId）。
 * SSE 长连接（/chat）只记到响应头发出；流式耗时由 chat 路由自行记录。
 */
export function accessLogMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const started = Date.now();
    await next();
    const status = c.res.status;
    const path = c.req.path;
    const durationMs = Date.now() - started;
    logger.info('http.request', { method: c.req.method, path, status, durationMs });
    recordRequest(path, c.req.method, status, durationMs);
  };
}
