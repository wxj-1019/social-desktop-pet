/**
 * WS 实时推送 e2e（9.2/9.4）：alice 送礼 → bob 的 WSS 连接立即收到 inbox.delivered → 事件流刷新。
 *
 * 判定"实时"：bob 事件流在 10s 内出现 gift.snack_sent——
 * 兜底轮询周期为 30s（friends.tsx），10s 内出现只能来自 WS 推送。
 *
 * 前置：后端已启动 + alice/bob 为好友（测试库）；后端不可达时整组跳过。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const APP_DIR = join(__dirname, '..', 'apps', 'desktop');
const API_BASE = process.env['PET_API_BASE'] ?? 'http://127.0.0.1:8787';

let app: ElectronApplication;

test.beforeAll(async () => {
  try {
    const res = await fetch(`${API_BASE}/healthz`);
    if (!res.ok) test.skip(1, `后端不可达（${API_BASE}）`);
  } catch {
    test.skip(1, `后端不可达（${API_BASE}）`);
  }
  const mainEntry = join(APP_DIR, 'out', 'main', 'index.js');
  if (!existsSync(mainEntry)) {
    throw new Error(`未找到 ${mainEntry} —— 请先运行 pnpm --filter @pet/desktop build`);
  }
  app = await electron.launch({ args: ['.'], cwd: APP_DIR });
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
  const page: Page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // bob 登录（WS 连接建立）
  await expect(page.locator('.login-page')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[type="email"]').fill('bob@test.local');
  await page.locator('input[type="password"]').fill('password123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.locator('.friends-page')).toBeVisible({ timeout: 15_000 });

  // node 侧：alice 登录 → 给 bob 送点心（幂等键唯一）
  const alice = await loginToken('alice@test.local');
  const bob = await loginToken('bob@test.local');
  const giftRes = await fetch(`${API_BASE}/gift`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({
      toUserId: bob.userId,
      snackId: 'snack_cookie',
      clientEventId: crypto.randomUUID(),
    }),
  });
  expect(giftRes.ok).toBe(true);

  // 10s 内事件流出现 gift.snack_sent（WS 推送；30s 轮询尚未到点）
  await expect(page.locator('.event-list')).toContainText('gift.snack_sent', { timeout: 10_000 });
});
