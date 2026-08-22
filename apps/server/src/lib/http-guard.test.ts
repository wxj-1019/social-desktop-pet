/**
 * HTTP 层防护测试（P1-4 + P2 收尾）：
 * - content-length 超限 → 413 payload_too_large
 * - 正常大小放行；GET 无 body 不校验
 * - 全局每 IP 限流：窗口内超限 → 429；/healthz 豁免
 */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { bodyLimitMiddleware, globalRateLimitMiddleware } from './http-guard.js';

function makeApp(maxBytes?: number): Hono {
  const app = new Hono();
  app.use('*', bodyLimitMiddleware(maxBytes));
  app.post('/echo', async (c) =>
    c.json({ ok: true, n: ((await c.req.json()) as { n: number }).n }),
  );
  app.get('/ping', (c) => c.json({ ok: true }));
  return app;
}

describe('bodyLimitMiddleware（P1-4）', () => {
  it('content-length 超限 → 413', async () => {
    const app = makeApp(64);
    const res = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '128' },
      body: JSON.stringify({ n: 1 }),
    });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large' });
  });

  it('正常大小放行', async () => {
    const app = makeApp(1024);
    const res = await app.request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ n: 42 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, n: 42 });
  });

  it('GET 无 body 不校验', async () => {
    const app = makeApp(8);
    const res = await app.request('/ping');
    expect(res.status).toBe(200);
  });
});

describe('globalRateLimitMiddleware（P2 防护收尾）', () => {
  it('窗口内超过限额 → 429 + retryAfterSec', async () => {
    const app = new Hono();
    app.use('*', globalRateLimitMiddleware(3, 60_000));
    app.get('/ping', (c) => c.json({ ok: true }));
    for (let i = 0; i < 3; i++) {
      expect((await app.request('/ping')).status).toBe(200);
    }
    const res = await app.request('/ping');
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'rate_limit' });
  });

  it('/healthz 豁免（探针高频不受限）', async () => {
    const app = new Hono();
    app.use('*', globalRateLimitMiddleware(2, 60_000));
    app.get('/healthz', (c) => c.json({ ok: true }));
    for (let i = 0; i < 10; i++) {
      expect((await app.request('/healthz')).status).toBe(200);
    }
  });
});
