/**
 * 管理后台 API e2e —— 安全基线真库验证（P0/P1 修复的端到端回归）。
 *
 * 覆盖：登录失败 401 → 登录 200（no-store + HttpOnly cookie）→ 用户 token 越权 401 →
 * 总览 → 暂停账号（用户 refresh 即时失效）→ 恢复 → 敏感一次性授权
 * （读取 200 no-store / 复读 410 / 跨度上限 422）→ 审计留痕 → 登出后 refresh 401。
 *
 * 依赖：服务端已启动 + 管理员账号已初始化。
 * CI：启动前执行 admin:create（e2e-admin@pet.dev / E2eAdmin@123456）。
 * 本地：ADMIN_PASSWORD='...' pnpm --filter @pet/server admin:create <email>，
 * 并用 E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD 指定。未初始化时跳过。
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

const API_BASE = process.env['PET_API_BASE'] ?? 'http://127.0.0.1:8787';
const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'e2e-admin@pet.dev';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'] ?? 'E2eAdmin@123456';

async function api(
  path: string,
  {
    method = 'GET',
    token,
    body,
    cookie,
    grantToken,
  }: { method?: string; token?: string; body?: unknown; cookie?: string; grantToken?: string } = {},
): Promise<{ status: number; res: Response; data: unknown }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { cookie } : {}),
      ...(grantToken ? { 'x-grant-token': grantToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: res.status, res, data };
}

test.beforeAll(async () => {
  try {
    const health = await fetch(`${API_BASE}/healthz`);
    if (!health.ok) test.skip(true, '后端未就绪（/healthz 非 200）');
  } catch {
    test.skip(true, '后端不可达（/healthz 请求失败）');
  }
});

test('管理后台安全基线：登录 → 越权 → 暂停/恢复 → 敏感授权 → 审计 → 登出', async () => {
  // 0. 管理员账号未初始化（本地未跑 admin:create）→ 跳过而非误报
  const probe = await api('/admin/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: 'definitely-wrong-password' },
  });
  if (probe.status === 401) {
    const retry = await api('/admin/auth/login', {
      method: 'POST',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });
    if (retry.status === 401) test.skip(true, '管理员账号未初始化（admin:create）');
  }

  // 1. 错误密码 → 401
  const bad = await api('/admin/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: 'wrong-password' },
  });
  expect(bad.status).toBe(401);

  // 2. 正确登录 → 200；token 响应 no-store；refresh cookie HttpOnly + Path=/admin
  const login = await api('/admin/auth/login', {
    method: 'POST',
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(login.status).toBe(200);
  expect(login.res.headers.get('cache-control')).toBe('no-store');
  const adminToken = (login.data as { accessToken: string }).accessToken;
  const setCookie = login.res.headers.getSetCookie()?.[0] ?? '';
  expect(setCookie).toContain('admin_refresh=');
  expect(setCookie).toContain('HttpOnly');
  expect(setCookie).toContain('Path=/admin');

  // 3. 造一个一次性用户；其用户 token 不可访问 /admin/*（越权 401）
  const email = `admin-e2e-${Date.now()}@test.local`;
  const reg = await api('/auth/register', {
    method: 'POST',
    body: { email, password: 'password123', deviceId: randomUUID(), platform: 'windows' },
  });
  expect(reg.status).toBe(201);
  const {
    accessToken: userToken,
    refreshToken: userRefresh,
    userId,
  } = reg.data as {
    accessToken: string;
    refreshToken: string;
    userId: string;
  };
  const cross = await api('/admin/users', { token: userToken });
  expect(cross.status).toBe(401);

  // 4. 总览可用
  const overview = await api('/admin/overview', { token: adminToken });
  expect(overview.status).toBe(200);

  // 5. 暂停账号 → 用户 refresh 立即失效（会话全撤）
  const suspend = await api(`/admin/users/${userId}/suspend`, {
    method: 'POST',
    token: adminToken,
    body: { reason: 'e2e 管理后台安全基线验证' },
  });
  expect(suspend.status).toBe(200);
  const userRefreshAfterSuspend = await api('/auth/refresh', {
    method: 'POST',
    body: { refreshToken: userRefresh },
  });
  expect(userRefreshAfterSuspend.status).toBe(401);

  // 6. 恢复账号（只恢复登录能力）
  const restore = await api(`/admin/users/${userId}/restore`, {
    method: 'POST',
    token: adminToken,
  });
  expect(restore.status).toBe(200);

  // 7. 敏感授权：跨度超限 422 → 正常授权 201 → 读取 200（no-store）→ 复读 410
  const today = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const oversize = await api('/admin/sensitive-access', {
    method: 'POST',
    token: adminToken,
    body: {
      targetUserId: userId,
      resourceType: 'chat',
      reason: 'e2e 敏感授权验证（超限）',
      scope: { from: yearAgo, to: today },
    },
  });
  expect(oversize.status).toBe(422);

  const grant = await api('/admin/sensitive-access', {
    method: 'POST',
    token: adminToken,
    body: {
      targetUserId: userId,
      resourceType: 'chat',
      reason: 'e2e 敏感授权验证',
      scope: { from: today },
    },
  });
  expect(grant.status).toBe(201);
  const g = grant.data as { grantId: string; token: string };
  const read = await api(`/admin/sensitive-access/${g.grantId}/content`, {
    token: adminToken,
    grantToken: g.token,
  });
  expect(read.status).toBe(200);
  expect(read.res.headers.get('cache-control')).toBe('no-store');
  const reread = await api(`/admin/sensitive-access/${g.grantId}/content`, {
    token: adminToken,
    grantToken: g.token,
  });
  expect(reread.status).toBe(410);

  // 8. 审计留痕：登录 / 暂停 / 敏感授权 / 敏感读取全部可查
  const audit = await api('/admin/audit-log?pageSize=100', { token: adminToken });
  expect(audit.status).toBe(200);
  const actions = new Set(
    ((audit.data as { items: Array<{ action: string }> }).items ?? []).map((r) => r.action),
  );
  for (const expected of [
    'admin.login',
    'user.suspend',
    'user.restore',
    'sensitive.grant',
    'sensitive.read',
  ]) {
    expect(actions.has(expected), `审计缺少 ${expected}`).toBe(true);
  }

  // 9. 登出 → 旧 refresh cookie 不可再续期
  const logout = await api('/admin/auth/revoke', { method: 'POST', cookie: setCookie });
  expect(logout.status).toBe(200);
  const refreshAfterLogout = await api('/admin/auth/refresh', {
    method: 'POST',
    cookie: setCookie,
  });
  expect(refreshAfterLogout.status).toBe(401);
});
