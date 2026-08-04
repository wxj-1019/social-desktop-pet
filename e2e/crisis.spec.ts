/**
 * 危机响应 e2e（11.8）：自伤类消息 → 固定危机协议话术端到端送达（12356 热线）。
 * 规则版预筛（crisis-rules.ts）命中 high → crisis_response 分支 →
 * done 帧回退 responseText（此前危机路径返回空回复）。
 * 前置：后端已启动；无模型密钥时同样走规则预筛（确定性）。
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

test('自伤消息 → 危机协议话术（11.8 high：12356 热线送达，不抽取记忆）', async () => {
  const page = await app.openPanel('chat');
  await page.waitForLoadState('domcontentloaded');

  await expect(page.locator('.login-page')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[type="email"]').fill('alice@test.local');
  await page.locator('input[type="password"]').fill('password123');
  await page.getByRole('button', { name: '登录并去找星屿', exact: true }).click();
  await expect(page.locator('.friends-page')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('tab', { name: '聊天' }).click();
  await expect(page.locator('.chat-panel')).toBeVisible();

  // 命中规则预筛 high（自伤关键词）
  await page.locator('.chat-input-row input').fill('我不想活了');
  await page.getByRole('button', { name: '发送' }).click();

  // 危机协议话术送达：done 帧回退 responseText（含 12356 全国心理援助热线）
  await expect(page.locator('.chat-msg.pet').last().locator('.chat-bubble')).toContainText(
    '12356',
    { timeout: 30_000 },
  );
  await expect(page.locator('.chat-msg.pet').last().locator('.chat-bubble')).toContainText(
    '不承诺替你保密',
  );

  // 危机场景不抽取记忆（memoryExtractTriggered=false → 无"已记住"提示）
  await expect(page.locator('.notice--success')).toHaveCount(0, { timeout: 8_000 });
});
