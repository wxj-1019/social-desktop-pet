/**
 * Waitlist 邀请状态机 e2e —— 4.3（pending → invited → joined → 注册绑定）。
 *
 * 全链路：报名 → 运营 invite（Bearer adminToken；响应含明文兑换码）→
 * 错误码 401 → 正确码 claim 200 → 重复兑换 already_joined →
 * 注册后该邮箱不再可重复邀请（joined 推进）。
 *
 * 依赖：服务端配置 WAITLIST_ADMIN_TOKEN=e2e-waitlist-admin（.env.local）。
 * 用独立邮箱，不干扰 alice/bob。
 */
import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

const API_BASE = process.env['PET_API_BASE'] ?? 'http://127.0.0.1:8787';
const ADMIN_TOKEN = 'e2e-waitlist-admin';
const EMAIL = `invite-${Date.now()}@test.local`;

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

test('邀请状态机全链路：报名 → invite → claim → 注册绑定（4.3）', async () => {
  // 1. 报名（pending）
  const signup = await api('/waitlist', { method: 'POST', body: { email: EMAIL } });
  expect(signup.status).toBe(200);

  // 2. 运营发放邀请（invited；响应含明文兑换码——adminToken 保护）
  const invite = await api('/waitlist/invite', {
    method: 'POST',
    token: ADMIN_TOKEN,
    body: { emails: [EMAIL] },
  });
  expect(invite.status).toBe(200);
  const invited = (invite.data as { invited: Array<{ email: string; code: string }> }).invited;
  expect(invited[0]?.email).toBe(EMAIL);
  const code = invited[0]?.code as string;
  expect(code).toMatch(/^[A-Z2-9]{8}$/);

  // 3. 错误码 → 401 invalid_code
  const wrong = await api('/waitlist/claim', {
    method: 'POST',
    body: { email: EMAIL, code: 'WRONG123' },
  });
  expect(wrong.status).toBe(401);
  expect((wrong.data as { error?: string }).error).toBe('invalid_code');

  // 4. 正确码兑换（joined）
  const claim = await api('/waitlist/claim', {
    method: 'POST',
    body: { email: EMAIL, code },
  });
  expect(claim.status).toBe(200);

  // 5. 重复兑换 → already_joined（兑换码单次有效语义）
  const replay = await api('/waitlist/claim', {
    method: 'POST',
    body: { email: EMAIL, code },
  });
  expect(replay.status).toBe(401);
  expect((replay.data as { error?: string }).error).toBe('already_joined');

  // 6. 注册绑定：joined 邮箱注册后不再可重复邀请（状态推进闭环）
  const reg = await api('/auth/register', {
    method: 'POST',
    body: { email: EMAIL, password: 'password123', deviceId: randomUUID(), platform: 'windows' },
  });
  if (![201, 409, 500].includes(reg.status)) {
    throw new Error(`注册 ${EMAIL} 失败: HTTP ${reg.status} ${JSON.stringify(reg.data)}`);
  }
  const reinvite = await api('/waitlist/invite', {
    method: 'POST',
    token: ADMIN_TOKEN,
    body: { emails: [EMAIL] },
  });
  expect(reinvite.status).toBe(200);
  const reinvited = (reinvite.data as { invited: unknown[]; skipped: string[] }).invited;
  expect(reinvited).toHaveLength(0); // joined 不再受邀
});
