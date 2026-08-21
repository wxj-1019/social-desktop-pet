/**
 * 登录流程 e2e（本地验证用）：桌面端 ↔ 自建后端（D-13）。
 *
 * 前置：后端已启动（pnpm dev:server）+ pet 库已有测试账号。
 * 后端不可达时整组跳过（CI 无后端，自动跳过；本地跑通验证）。
 *
 * 覆盖：本地模式 → 登录 → 好友页 → 邀请好友；重启后保持登录；退出登录。
 * Task 12：登录面在面板窗（surface=panel），经 helper.openPanel 进入，禁 firstWindow。
 * I1 行为：未登录时 open-chat 直达本地聊天（登录页经"登录后解锁好友与云端记忆"进入）。
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { launchPetApp } from './helpers/electron-app.js';
import type { PetApp } from './helpers/electron-app.js';

const API_BASE = process.env['PET_API_BASE'] ?? 'http://127.0.0.1:8787';

let app: PetApp;

test.beforeAll(async () => {
  // 后端可达性探测：不可达 → 跳过整组
  try {
    const res = await fetch(`${API_BASE}/healthz`);
    if (!res.ok) test.skip(1, `后端不可达（${API_BASE}）`);
  } catch {
    test.skip(1, `后端不可达（${API_BASE}）`);
  }
  app = await launchPetApp();
});

test.afterAll(async () => {
  await app?.close();
});

/** 已登录判定：header 显示"和 X 在一起"（本地模式 header 是"轻轻陪在你身边"，
 *  登录态/本地态据此区分；不依赖昵称内容——alice 的档案昵称是"新朋友"） */
async function isLoggedIn(page: Page): Promise<boolean> {
  const header = page.locator('.app-header');
  if (!(await header.isVisible().catch(() => false))) return false;
  return (await header.innerText().catch(() => '')).includes('在一起');
}

/** 确保 alice 已登录：本地模式 → 登录入口 → 登录页 → 提交（幂等） */
async function loginAsAlice(page: Page): Promise<void> {
  if (await isLoggedIn(page)) return;
  if (
    !(await page
      .locator('.login-page')
      .isVisible()
      .catch(() => false))
  ) {
    // 本地模式 → 先点登录入口
    await page.getByRole('button', { name: '登录后解锁好友与云端记忆' }).click();
    await expect(page.locator('.login-page')).toBeVisible({ timeout: 10_000 });
  }
  await page.locator('input[type="email"]').fill('alice@test.local');
  await page.locator('input[type="password"]').fill('password123');
  await page.getByRole('button', { name: '登录并去找星屿', exact: true }).click();
  await expect(page.locator('.friends-page')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.app-header')).toContainText('alice');
}

test('登录 → 好友页 → 创建邀请（桌面 ↔ 后端全链路）', async () => {
  const page = await app.openPanel('chat');
  await page.waitForLoadState('domcontentloaded');

  // I1：未登录 open-chat → 本地模式聊天页（非登录页）
  await expect(page.locator('.local-chat')).toBeVisible({ timeout: 15_000 });

  // 经本地模式登录入口进入登录页 → 登录既有测试账号
  await loginAsAlice(page);

  // 创建邀请 → 邀请链接出现（pet://invite?token=…）
  await page.getByRole('button', { name: '邀请好友' }).click();
  await expect(page.locator('.invite-link code')).toContainText('pet://invite?token=');
});

test('重启后保持登录（safeStorage 恢复 + refresh 轮换，不出现登录页）', async () => {
  let page = await app.openPanel('chat');
  await page.waitForLoadState('domcontentloaded');

  // 自包含：未登录则先登录（上个用例若已登出）
  await loginAsAlice(page);

  // 重启（复用 userDataDir → session-token.bin 加密落盘保留）
  await app.restart();
  page = await app.openPanel('chat');
  await page.waitForLoadState('domcontentloaded');

  // 启动恢复：直接进入已登录界面（应用壳 header 可见），不出现登录页。
  // 注：alice 的档案昵称是"新朋友"（global-setup 注册未设昵称），
  // 因此不按邮箱字符串断言，以"登录页不出现 + 应用壳出现"为稳定信号。
  await expect(page.locator('.login-page')).not.toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.app-header')).toBeVisible();
});

test('退出登录 → 回到登录页', async () => {
  // 自包含：打开面板并确保已登录（不依赖前序用例的面板/会话状态）
  const page = await app.openPanel('chat');
  await page.waitForLoadState('domcontentloaded');
  await loginAsAlice(page);

  await page.getByRole('button', { name: '账号菜单' }).click();
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.locator('.login-page')).toBeVisible({ timeout: 10_000 });
});
