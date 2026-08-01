/**
 * 登录流程 e2e（本地验证用）：桌面端 ↔ 自建后端（D-13）。
 *
 * 前置：后端已启动（pnpm dev:server）+ pet 库已有测试账号。
 * 后端不可达时整组跳过（CI 无后端，自动跳过；本地跑通验证）。
 *
 * 覆盖：登录页 → 登录 → 好友页 → 创建邀请链接。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const APP_DIR = join(__dirname, '..', 'apps', 'desktop');
const API_BASE = process.env['PET_API_BASE'] ?? 'http://127.0.0.1:8787';

let app: ElectronApplication;

test.beforeAll(async () => {
  // 后端可达性探测：不可达 → 跳过整组
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

test('登录 → 好友页 → 创建邀请（桌面 ↔ 后端全链路）', async () => {
  const page: Page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  // 启动恢复失败（无 refresh token）→ 登录页
  await expect(page.locator('.login-page')).toBeVisible({ timeout: 15_000 });

  // 登录既有测试账号（本机 pet 库：alice@test.local）
  await page.locator('input[type="email"]').fill('alice@test.local');
  await page.locator('input[type="password"]').fill('password123');
  await page.getByRole('button', { name: '登录', exact: true }).click();

  // 好友页出现（会话 ACTIVE）
  await expect(page.locator('.friends-page')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.app-header')).toContainText('alice');

  // 创建邀请 → 邀请链接出现（pet://invite?token=…）
  await page.getByRole('button', { name: '创建邀请链接' }).click();
  await expect(page.locator('.invite-link code')).toContainText('pet://invite?token=');
});

test('退出登录 → 回到登录页', async () => {
  const page: Page = await app.firstWindow();
  await page.getByRole('button', { name: '退出' }).click();
  await expect(page.locator('.login-page')).toBeVisible({ timeout: 10_000 });
});
