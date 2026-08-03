/**
 * e2e globalSetup —— 本地环境自愈（新建 pet 库后无需手工建号/建好友）。
 *
 * 职责：后端可达时幂等预置本地测试账号 alice/bob 及好友关系；
 * 后端不可达时静默跳过（CI 无后端，相关 spec 会整组 skip，与既有语义一致）。
 *
 * 注意：只预置"环境"，不重置业务数据（gift_events/chat_usage/user_inbox
 * 由 gift-pet.spec.ts 通过 /__dev/reset-test-data 自行清理）。
 */
import { randomUUID } from 'node:crypto';

import type { FullConfig } from '@playwright/test';

const API_BASE = process.env['PET_API_BASE'] ?? 'http://127.0.0.1:8787';
const PASSWORD = 'password123';

async function j(
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

async function ensureUser(email: string, nickname: string): Promise<void> {
  const res = await j('/auth/register', {
    method: 'POST',
    body: { email, password: PASSWORD, deviceId: randomUUID(), platform: 'windows', nickname },
  });
  if (res.ok) {
    console.info(`[e2e] + 注册 ${email}`);
    return;
  }
  // 注册非幂等：重复 email 触发 auth.users 的 UNIQUE 约束，服务端未映射 409，
  // 冲突表现为 500——两种状态都视为"账号已存在"。
  // 其余失败必须显式报错（否则静默吞掉后，后续 login 以更难懂的方式失败）。
  if (res.status === 409 || res.status === 500) return;
  throw new Error(`注册 ${email} 失败: HTTP ${res.status} ${JSON.stringify(res.data)}`);
}

async function login(email: string): Promise<{ accessToken: string }> {
  const res = await j('/auth/login', {
    method: 'POST',
    body: { email, password: PASSWORD, deviceId: randomUUID(), platform: 'windows' },
  });
  if (!res.ok)
    throw new Error(`登录 ${email} 失败: HTTP ${res.status} ${JSON.stringify(res.data)}`);
  return res.data as { accessToken: string };
}

async function ensureFriendship(): Promise<void> {
  const alice = await login('alice@test.local');
  const bob = await login('bob@test.local');

  const invite = await j('/invite', { method: 'POST', token: alice.accessToken, body: {} });
  if (!invite.ok)
    throw new Error(`创建邀请失败: HTTP ${invite.status} ${JSON.stringify(invite.data)}`);

  const accept = await j('/invite/accept', {
    method: 'POST',
    token: bob.accessToken,
    body: { token: (invite.data as { token: string }).token },
  });
  if (accept.ok) {
    console.info('[e2e] + 好友关系已建立: alice ↔ bob');
    return;
  }
  if (accept.status === 409) return; // 已是好友
  throw new Error(`接受邀请失败: HTTP ${accept.status} ${JSON.stringify(accept.data)}`);
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/healthz`);
    if (!res.ok) throw new Error(`healthz HTTP ${res.status}`);
  } catch {
    console.info(`[e2e] 后端不可达（${API_BASE}）——跳过账号预置，相关 spec 将整组 skip`);
    return;
  }

  await ensureUser('alice@test.local', 'alice');
  await ensureUser('bob@test.local', 'bob');
  await ensureFriendship();
}
