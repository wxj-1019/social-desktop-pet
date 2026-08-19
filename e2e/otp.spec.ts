/**
 * 邮箱 OTP 登录 e2e —— 13.2 事务邮件。
 *
 * 流程：注册 otp@test.local（密码注册，与面板登录同路径）→ POST /auth/otp/request
 * → 响应带 devCode（服务端 PET_DEV_OTP_CODE_IN_RESPONSE=true，仅本地开发）
 * → POST /auth/otp/login 用 devCode 换取 access/refresh token。
 *
 * 服务端未开 dev 模式（响应无 devCode）→ 整组 skip（生产语义：验证码只进邮件）。
 * 用独立账号，不干扰 alice/bob 的面板会话（9.8 新设备登录会撤销旧会话）。
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

const API_BASE = process.env['PET_API_BASE'] ?? 'http://127.0.0.1:8787';
const EMAIL = 'otp@test.local';
const PASSWORD = 'password123';

async function api(
  path: string,
  { method = 'GET', token, body }: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; ok: boolean; data: unknown }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: res.status, ok: res.ok, data };
}

test.beforeAll(async () => {
  try {
    const health = await fetch(`${API_BASE}/healthz`);
    if (!health.ok) test.skip(true, '后端未就绪（/healthz 非 200）');
  } catch {
    test.skip(true, '后端不可达（/healthz 请求失败）');
  }
});

test('邮箱 OTP 登录：request 拿 devCode → login 出 token（13.2 全链路）', async () => {
  // 注册独立账号（已存在则 500/409 视为成功，幂等）
  const reg = await api('/auth/register', {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD, deviceId: randomUUID(), platform: 'windows' },
  });
  if (![201, 409, 500].includes(reg.status)) {
    throw new Error(`注册 ${EMAIL} 失败: HTTP ${reg.status} ${JSON.stringify(reg.data)}`);
  }

  // 请求验证码
  const request = await api('/auth/otp/request', {
    method: 'POST',
    body: { email: EMAIL },
  });
  expect(request.status).toBe(200);
  const devCode = (request.data as { devCode?: string }).devCode;
  if (!devCode) {
    test.skip(true, '服务端未开启 PET_DEV_OTP_CODE_IN_RESPONSE（验证码只进邮件）');
    return;
  }
  expect(devCode).toMatch(/^\d{6}$/);

  // 用验证码登录（新设备 id，9.8 语义与密码登录一致）
  const login = await api('/auth/otp/login', {
    method: 'POST',
    body: { email: EMAIL, code: devCode, deviceId: randomUUID(), platform: 'windows' },
  });
  expect(login.status).toBe(200);
  const tokens = login.data as { accessToken: string; refreshToken: string; userId: string };
  expect(tokens.accessToken).toBeTruthy();
  expect(tokens.refreshToken).toBeTruthy();
  expect(tokens.userId).toBeTruthy();

  // 验证码单次有效：重复使用 → 401
  const replay = await api('/auth/otp/login', {
    method: 'POST',
    body: { email: EMAIL, code: devCode, deviceId: randomUUID(), platform: 'windows' },
  });
  expect(replay.status).toBe(401);

  // 错误验证码 → 401
  const wrong = await api('/auth/otp/login', {
    method: 'POST',
    body: { email: EMAIL, code: '000000', deviceId: randomUUID(), platform: 'windows' },
  });
  expect(wrong.status).toBe(401);

  // token 可用于受保护端点（记忆摘要，验证会话可用）
  const summary = await api('/memories/summary', { token: tokens.accessToken });
  expect(summary.status).toBe(200);
});
