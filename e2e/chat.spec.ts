/**
 * 聊天 SSE e2e（10.1）：登录 → 聊天 tab → 输入 → 收到流式回复。
 * 前置：后端已启动（pnpm dev:server）；后端不可达时整组跳过。
 * Task 12：面板窗（surface=panel）经 helper.openPanel 进入，禁 firstWindow。
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
  app = await launchPetApp();
});

test.afterAll(async () => {
  await app?.close();
});

test('登录 → 聊天 tab → SSE 流式回复', async () => {
  const page = await app.openPanel('chat');
  await page.waitForLoadState('domcontentloaded');

  // 登录（本地 pet 库测试账号）
  await expect(page.locator('.login-page')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[type="email"]').fill('alice@test.local');
  await page.locator('input[type="password"]').fill('password123');
  await page.getByRole('button', { name: '登录并去找星屿', exact: true }).click();
  await expect(page.locator('.friends-page')).toBeVisible({ timeout: 15_000 });

  // 切到聊天 tab（tablist 内 role=tab，见 app.tsx tabs ARIA）
  await page.getByRole('tab', { name: '聊天' }).click();
  await expect(page.locator('.chat-panel')).toBeVisible();

  // 发送消息 → 收到流式回复（真实模型或骨架降级，均为非空回复）
  await page.locator('.chat-input-row textarea').fill('你好呀');
  await page.getByRole('button', { name: '发送' }).click();
  // 流式占位消息出现后，等待云端或本地兜底完成。
  await expect(page.locator('.chat-msg.pet').last()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 60_000 });
  // 本次回复气泡（最后一条 pet，排除历史消息）已被 token 填充——
  // 占位符为「•••」（chat-panel typing-dots），等待其消失即回复完成
  await expect(page.locator('.chat-msg.pet').last().locator('.chat-bubble')).not.toHaveText('•••', {
    timeout: 60_000,
  });
});
