/**
 * 记忆闭环 e2e（10.6 / D-3）：
 * 1. 聊普通偏好 → "已记住"提示（自动保存闭环）
 * 2. 聊健康敏感句 → 确认卡出现 → 点"记住" → 落库（分级确认 HITL 闭环）
 * 前置：后端已启动（pnpm dev:server）；无模型密钥时走规则抽取兜底（确定性）。
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

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
  // 清空记忆表（幂等；记忆去重会让重复运行无确认卡可弹）
  await fetch(`${API_BASE}/__dev/reset-test-data`, { method: 'POST' });
  app = await launchPetApp();
});

test.afterAll(async () => {
  await app?.close();
});

/** 登录 alice 并停留在聊天 tab */
async function loginAndOpenChat(page: Page) {
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.login-page')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[type="email"]').fill('alice@test.local');
  await page.locator('input[type="password"]').fill('password123');
  await page.getByRole('button', { name: '登录并去找星屿', exact: true }).click();
  await expect(page.locator('.friends-page')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('tab', { name: '聊天' }).click();
  await expect(page.locator('.chat-panel')).toBeVisible();
}

test('普通偏好自动保存 → "已记住"提示（可撤销）', async () => {
  const page = await app.openPanel('chat');
  await loginAndOpenChat(page);

  // 发送偏好句（规则抽取：我喜欢 → preference/low → 自动保存）
  await page.locator('.chat-input-row textarea').fill('我喜欢抹茶');
  await page.getByRole('button', { name: '发送' }).click();

  // 聊天回复完成后（最多 ~8s 轮询窗口）出现"已记住"通知（60s 内自动保存被差分命中）
  await expect(page.locator('.notice--success')).toContainText('已记住', { timeout: 60_000 });
  await expect(page.locator('.notice--success')).toContainText('我喜欢抹茶');

  // 服务端已落库（recentlySaved 60s 窗口内可见）
  const summary = await getSummaryAsAlice(page);
  expect(summary.recentlySaved.some((m) => m.value === '我喜欢抹茶')).toBe(true);
});

test('健康敏感句 → 确认卡 → "记住"落库（D-3 分级确认）', async () => {
  const page = await app.openPanel('chat');
  await expect(page.locator('.chat-panel')).toBeVisible({ timeout: 15_000 });

  // 敏感句（规则抽取：health → high → 弹确认卡而非自动保存）
  await page.locator('.chat-input-row textarea').fill('我有糖尿病，每天要打胰岛素');
  await page.getByRole('button', { name: '发送' }).click();

  // 确认卡出现（异步抽取完成后轮询命中）
  await expect(page.locator('.memory-confirm-card')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.memory-confirm-card')).toContainText('我有糖尿病');

  // 点"记住" → 卡消失
  await page.getByRole('button', { name: '记住', exact: true }).click();
  await expect(page.locator('.memory-confirm-card')).toHaveCount(0, { timeout: 15_000 });

  // 服务端已落库（确认后 created_at 在 60s 窗口内 → recentlySaved 可见）
  const summary = await getSummaryAsAlice(page);
  expect(summary.recentlySaved.some((m) => m.value === '我有糖尿病，每天要打胰岛素')).toBe(true);
});

test('记忆中心：查看来源 → 修改 → 删除（11.3）', async () => {
  const page = await app.openPanel('chat');
  await expect(page.locator('.chat-panel')).toBeVisible({ timeout: 15_000 });

  // 切到"记忆"tab（第 4 个 tab）
  await page.getByRole('tab', { name: '记忆' }).click();
  await expect(page.locator('.memories-page')).toBeVisible();
  // 测试 1 自动保存的偏好记忆在列表
  const item = page.locator('.memory-item').filter({ hasText: '我喜欢抹茶' }).first();
  await expect(item).toBeVisible({ timeout: 15_000 });

  // 查看来源（11.3：source_turn 原文）
  await item.getByRole('button', { name: '来源' }).click();
  await expect(item.locator('.memory-item__source-texts')).toContainText('我喜欢抹茶');

  // 修改（10.5 纠正链：旧条置失效 + 新条 superseded）
  await item.getByRole('button', { name: '修改' }).click();
  await item.getByLabel('修改记忆内容').fill('我喜欢焙茶');
  await item.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.memory-item').filter({ hasText: '我喜欢焙茶' }).first()).toBeVisible({
    timeout: 15_000,
  });

  // 删除（置失效不物理删除）→ 二次确认后列表清空该项
  const edited = page.locator('.memory-item').filter({ hasText: '我喜欢焙茶' }).first();
  await edited.getByRole('button', { name: '删除' }).click();
  await edited.getByRole('button', { name: '确认删除？' }).click();
  await expect(page.locator('.memory-item').filter({ hasText: '我喜欢焙茶' })).toHaveCount(0, {
    timeout: 15_000,
  });
});

/**
 * 以 alice 身份调 /memories/summary（node 侧直连后端）。
 * 必须复用面板的设备 id：9.8 新设备登录会撤销其他设备会话（会把面板踢下线）。
 */
async function getSummaryAsAlice(panel: Page): Promise<{
  pending: Array<{ value: string }>;
  recentlySaved: Array<{ value: string }>;
}> {
  const deviceId = await panel.evaluate(() => localStorage.getItem('pet:deviceId') ?? '');
  const login = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'alice@test.local',
      password: 'password123',
      deviceId,
    }),
  });
  if (!login.ok) throw new Error(`login 失败: ${login.status} ${await login.text()}`);
  const { accessToken } = (await login.json()) as { accessToken: string };
  const res = await fetch(`${API_BASE}/memories/summary`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return (await res.json()) as {
    pending: Array<{ value: string }>;
    recentlySaved: Array<{ value: string }>;
  };
}
