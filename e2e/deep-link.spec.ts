/**
 * 深链端到端（6.3）：pet:// 链接 → 登录后恢复 → 接受邀请 → 好友列表出现。
 *
 * 覆盖"应用未运行时点击链接"场景：启动 argv 携带 pet:// URL
 * → main 记入 pending → 登录成功 → restorePending → 转发 payload → 自动接受。
 * （"应用已运行"场景走 second-instance，经手动原生双实例验证；Playwright 的
 *  -r loader 与单实例锁消息不兼容，无法在 e2e 中覆盖。）
 *
 * 前置：后端已启动 + alice/bob 测试账号已注册（本地 pet 库）。
 * 后端不可达时整组跳过（CI 无后端）。
 * Task 12：登录面在面板窗（surface=panel）经 helper.openPanel 进入，禁 firstWindow。
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { launchPetApp } from './helpers/electron-app.js';
import type { PetApp } from './helpers/electron-app.js';

const API_BASE = process.env['PET_API_BASE'] ?? 'http://127.0.0.1:8787';

let inviteToken: string;

async function launchApp(extraArgs: string[] = []): Promise<PetApp> {
  return launchPetApp(extraArgs);
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await expect(page.locator('.login-page')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.friends-page')).toBeVisible({ timeout: 15_000 });
}

test('alice 创建邀请链接（供 bob 深链接受）', async () => {
  try {
    const res = await fetch(`${API_BASE}/healthz`);
    if (!res.ok) test.skip(1, `后端不可达（${API_BASE}）`);
  } catch {
    test.skip(1, `后端不可达（${API_BASE}）`);
  }

  const app = await launchApp();
  try {
    const page = await app.openPanel('chat');
    await page.waitForLoadState('domcontentloaded');
    await login(page, 'alice@test.local', 'password123');

    await page.getByRole('button', { name: '创建邀请链接' }).click();
    const link = await page.locator('.invite-link code').innerText();
    inviteToken = link.split('token=')[1] ?? '';
    expect(inviteToken.length).toBeGreaterThan(20);
  } finally {
    await app.close(); // 释放单实例锁，供下一实例启动
  }
});

test('bob 启动即带 pet:// 链接 → 登录后自动接受 → 好友列表出现 alice', async () => {
  expect(inviteToken).toBeTruthy();
  // 模拟：应用未运行时 bob 点击 pet:// 链接（启动 argv 携带 URL）
  const app = await launchApp([`pet://invite?token=${inviteToken}`]);
  try {
    const page = await app.openPanel('chat');
    await page.waitForLoadState('domcontentloaded');
    page.on('console', (m) => process.stdout.write(`[renderer] ${m.text()}\n`));
    page.on('pageerror', (e) => process.stdout.write(`[pageerror] ${e.message}\n`));

    // bob 登录 → 主进程 restorePending → 自动接受邀请
    await login(page, 'bob@test.local', 'password123');

    // 好友列表出现 alice（acceptInvite 后 refreshFriends）
    await expect(page.locator('.friend-item')).toContainText('alice', { timeout: 15_000 });
  } finally {
    await app.close();
  }
});
