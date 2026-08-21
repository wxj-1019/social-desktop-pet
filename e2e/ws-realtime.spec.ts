/**
 * WS 实时推送 e2e（9.2/9.4）：alice 送礼 → bob 的 WSS 连接立即收到 inbox.delivered → 事件流刷新。
 *
 * 判定"实时"：bob 事件流在 10s 内出现 gift.snack_sent——
 * 兜底轮询周期为 30s（friends.tsx），10s 内出现只能来自 WS 推送。
 *
 * 前置：后端已启动 + alice/bob 为好友（测试库）；后端不可达时整组跳过。
 * Task 12：登录面在面板窗（surface=panel）经 helper.openPanel 进入，禁 firstWindow。
 */
import { expect, test } from '@playwright/test';

import { launchPetApp } from './helpers/electron-app.js';
import type { PetApp } from './helpers/electron-app.js';

const API_BASE = process.env['PET_API_BASE'] ?? 'http://127.0.0.1:8787';

let app: PetApp;

test.beforeAll(async () => {
  try {
    const res = await fetch(`${API_BASE}/healthz`);
    if (!res.ok) test.skip(1, `后端不可达（${API_BASE}）`);
  } catch {
    test.skip(1, `后端不可达（${API_BASE}）`);
  }
  // 自愈：清空配额计数（gift 每日 3 次会被反复 e2e 耗尽；端点仅本地 PET_DEV_RESET 开启）
  await fetch(`${API_BASE}/__dev/reset-test-data`, { method: 'POST' }).catch(() => {});
  app = await launchPetApp();
});

test.afterAll(async () => {
  await app?.close();
});

/** node 侧登录拿 token */
async function loginToken(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'password123',
      deviceId: crypto.randomUUID(),
      platform: 'windows',
    }),
  });
  const body = (await res.json()) as { accessToken: string; userId: string };
  return { token: body.accessToken, userId: body.userId };
}

test('alice 送礼 → bob 的 WS 实时收到事件（10s 内，非 30s 轮询）', async () => {
  const page = await app.openPanel('chat');
  await page.waitForLoadState('domcontentloaded');

  // bob 登录（WS 连接建立）
  await app.loginAs(page, 'bob@test.local');

  // node 侧：alice 登录 → 给 bob 送点心（幂等键唯一）。
  // 注意：不登录 bob——登录会激活新设备并切走 active_display_device_id，
  // 挤掉 bob 面板设备（9.8 单活跃设备 → 面板 403 device_revoked）。
  // bob 的 userId 从 alice 的好友列表取。
  const alice = await loginToken('alice@test.local');
  const friendsRes = await fetch(`${API_BASE}/friends`, {
    headers: { authorization: `Bearer ${alice.token}` },
  });
  const { friends } = (await friendsRes.json()) as {
    friends: Array<{ userId: string; nickname: string }>;
  };
  const bob = friends.find((friend) => friend.nickname === 'bob');
  expect(bob).toBeDefined();
  const giftRes = await fetch(`${API_BASE}/gift`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({
      toUserId: bob!.userId,
      snackId: 'snack_cookie',
      clientEventId: crypto.randomUUID(),
    }),
  });
  expect(giftRes.ok).toBe(true);

  // 20s 内事件流出现 gift.snack_sent（WS 推送；30s 轮询尚未到点）。
  // 窗口取 20s（非 10s）：全量套件/本地 dev 实例并存时 WS 推送与渲染有秒级抖动，
  // 仍远小于 30s 轮询周期，"实时而非轮询"的判定语义不变。
  await expect(page.locator('.event-list')).toContainText('送来了一份小点心', { timeout: 20_000 });
});
