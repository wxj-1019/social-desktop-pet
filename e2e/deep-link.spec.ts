/**
 * 深链端到端（6.3）：pet:// 链接 → 登录后恢复 → 接受邀请 → 好友列表出现。
 *
 * 覆盖"应用未运行时点击链接"场景：启动 argv 携带 pet:// URL
 * → main 记入 pending → 登录成功 → restorePending → 转发 payload → 自动接受。
 * （"应用已运行"场景走 second-instance，经手动原生双实例验证；Playwright 的
 *  -r loader 与单实例锁消息不兼容，无法在 e2e 中覆盖。）
 *
 * Fresh 账号（C1 审查修复）：每次运行经后端 API 注册一对一次性账号
 * （POST /auth/register），邀请 token 服务端一次性（used 状态），
 * 不依赖本地 pet 库既有账号/残留好友关系，重复运行互不影响。
 * 后端不可达时整组跳过（CI 无后端）。
 * Task 12：登录面在面板窗（surface=panel）经 helper.openPanel 进入，禁 firstWindow。
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { launchPetApp } from './helpers/electron-app.js';
import type { PetApp } from './helpers/electron-app.js';

const API_BASE = process.env['PET_API_BASE'] ?? 'http://127.0.0.1:8787';

const PASSWORD = 'password123';
// 每次运行唯一的账号对（email 前缀即昵称，供好友列表断言）
const runId = Date.now().toString(36);
const inviterEmail = `inviter-${runId}@test.local`;
const inviterNickname = `inviter-${runId}`;
const acceptorEmail = `acceptor-${runId}@test.local`;
const acceptorNickname = `acceptor-${runId}`;

let inviteToken: string;

/** 经后端 API 注册 fresh 账号（不依赖本地库既有账号） */
async function registerFreshUser(email: string, nickname: string): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      deviceId: crypto.randomUUID(),
      platform: 'windows',
      nickname,
    }),
  });
  if (!res.ok) throw new Error(`注册 fresh 账号 ${email} 失败: HTTP ${res.status}`);
}

async function launchApp(extraArgs: string[] = []): Promise<PetApp> {
  return launchPetApp(extraArgs);
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await expect(page.locator('.login-page')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: '登录并去找星屿', exact: true }).click();
  await expect(page.locator('.friends-page')).toBeVisible({ timeout: 15_000 });
}

test('inviter（fresh 账号）创建邀请链接（供 acceptor 深链接受）', async () => {
  try {
    const res = await fetch(`${API_BASE}/healthz`);
    if (!res.ok) test.skip(1, `后端不可达（${API_BASE}）`);
  } catch {
    test.skip(1, `后端不可达（${API_BASE}）`);
  }

  await registerFreshUser(inviterEmail, inviterNickname);

  const app = await launchApp();
  try {
    const page = await app.openPanel('chat');
    await page.waitForLoadState('domcontentloaded');
    await login(page, inviterEmail, PASSWORD);

    await page.getByRole('button', { name: '邀请好友' }).click();
    const link = await page.locator('.invite-link code').innerText();
    inviteToken = link.split('token=')[1] ?? '';
    expect(inviteToken.length).toBeGreaterThan(20);
  } finally {
    await app.close(); // 释放单实例锁，供下一实例启动
  }
});

test('acceptor（fresh 账号）启动即带 pet:// 链接 → 登录后自动接受 → 好友列表出现 inviter', async () => {
  try {
    const res = await fetch(`${API_BASE}/healthz`);
    if (!res.ok) test.skip(1, `后端不可达（${API_BASE}）`);
  } catch {
    test.skip(1, `后端不可达（${API_BASE}）`);
  }
  expect(inviteToken).toBeTruthy();
  await registerFreshUser(acceptorEmail, acceptorNickname);

  // 模拟：应用未运行时 acceptor 点击 pet:// 链接（启动 argv 携带 URL）
  const app = await launchApp([`pet://invite?token=${inviteToken}`]);
  try {
    const page = await app.openPanel('chat');
    await page.waitForLoadState('domcontentloaded');
    page.on('console', (m) => process.stdout.write(`[renderer] ${m.text()}\n`));
    page.on('pageerror', (e) => process.stdout.write(`[pageerror] ${e.message}\n`));

    // acceptor 登录 → 主进程 restorePending → 自动接受邀请（fresh 账号，无残留依赖）
    await login(page, acceptorEmail, PASSWORD);

    // 好友列表出现 inviter（acceptInvite 成功后 refreshFriends）
    await expect(page.locator('.friend-item')).toContainText(inviterNickname, {
      timeout: 15_000,
    });
  } finally {
    await app.close();
  }
});
