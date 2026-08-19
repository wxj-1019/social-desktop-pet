/**
 * requireAuth 设备撤销双保险测试（9.8）：
 * active_display_device_id 有值且 ≠ 当前设备 → 403 device_revoked；
 * null/无 profile 行 → 放行（undefined 不再恒 403）；无 pool → 跳过校验。
 */
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { JwtService } from '../auth/jwt.js';

import { requireAuth, type BusinessVariables } from './business.js';

const jwt = new JwtService({ secret: 'test-secret-at-least-32-bytes-long' });

async function makeApp(pool: { query: ReturnType<typeof vi.fn> }) {
  const app = new Hono<{ Variables: BusinessVariables }>();
  app.use(requireAuth(jwt, pool as never));
  app.get('/ping', (c) =>
    c.json({ ok: true, userId: c.get('userId'), deviceId: c.get('deviceId') }),
  );
  return app;
}

async function authedRequest(app: Hono<{ Variables: BusinessVariables }>, deviceId: string) {
  const token = await jwt.sign({ sub: 'u1', deviceId });
  return app.request('/ping', {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('requireAuth 设备撤销双保险 + 暂停校验（9.8 / 管理后台）', () => {
  it('active_display_device_id 匹配当前设备 → 放行', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ active_display_device_id: 'dev-1', account_status: 'active' }],
      })),
    };
    const res = await authedRequest(await makeApp(pool), 'dev-1');
    expect(res.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('account_status'), ['u1']);
  });

  it('active_display_device_id 不匹配（旧设备被停用）→ 403 device_revoked', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ active_display_device_id: 'dev-2', account_status: 'active' }],
      })),
    };
    const res = await authedRequest(await makeApp(pool), 'dev-1');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'device_revoked' });
  });

  it('账号被暂停（suspended）→ 403 account_suspended（不等 access token 过期）', async () => {
    const pool = {
      query: vi.fn(async () => ({
        rows: [{ active_display_device_id: 'dev-1', account_status: 'suspended' }],
      })),
    };
    const res = await authedRequest(await makeApp(pool), 'dev-1');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'account_suspended' });
  });

  it('无 profile 行 / null（未激活）→ 放行（不再恒 403）', async () => {
    const variants = [
      { rows: [] },
      { rows: [{ active_display_device_id: null, account_status: 'active' }] },
    ];
    for (const rows of variants) {
      const pool = { query: vi.fn(async () => rows) };
      const res = await authedRequest(await makeApp(pool), 'dev-1');
      expect(res.status, JSON.stringify(rows)).toBe(200);
    }
  });

  it('无 pool（未启用校验）→ 放行（测试/旧调用兼容）', async () => {
    const app = new Hono<{ Variables: BusinessVariables }>();
    app.use(requireAuth(jwt));
    app.get('/ping', (c) => c.json({ ok: true }));
    const res = await authedRequest(app, 'dev-1');
    expect(res.status).toBe(200);
  });

  it('无 token → 401；token 非法 → 401', async () => {
    const pool = { query: vi.fn() };
    const app = await makeApp(pool);
    expect((await app.request('/ping')).status).toBe(401);
    expect(
      (await app.request('/ping', { headers: { authorization: 'Bearer invalid-token' } })).status,
    ).toBe(401);
    expect(pool.query).not.toHaveBeenCalled();
  });
});
