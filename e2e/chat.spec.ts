/**
 * 聊天 SSE e2e（10.1）：登录 → 聊天 tab → 输入 → 收到流式回复。
 * 前置：后端已启动（pnpm dev:server）；后端不可达时整组跳过。
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

test('登录 → 聊天 tab → SSE 流式回复', async () => {
  const page: Page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // 登录（本地 pet 库测试账号）
  await expect(page.locator('.login-page')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[type="email"]').fill('alice@test.local');
  await page.locator('input[type="password"]').fill('password123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.locator('.friends-page')).toBeVisible({ timeout: 15_000 });

  // 切到聊天 tab
  await page.getByRole('button', { name: '聊天' }).click();
  await expect(page.locator('.chat-panel')).toBeVisible();

  // 发送消息 → 收到骨架流式回复（token 逐字填充，最终完整）
  await page.locator('.chat-input-row input').fill('你好呀');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.locator('.chat-msg.pet .chat-bubble')).toContainText('你刚才说：你好呀', {
    timeout: 15_000,
  });
});
