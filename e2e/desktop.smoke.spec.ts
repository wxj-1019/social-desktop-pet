/**
 * Electron 冒烟测试：应用能启动、窗口创建、renderer 加载、preload API 存在。
 * 覆盖 8.3 安全基线（nodeIntegration:false / contextIsolation:true）不回归。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const APP_DIR = join(__dirname, '..', 'apps', 'desktop');

let app: ElectronApplication;

test.beforeAll(async () => {
  // 生产构建产物必须存在（CI 先 build；本地跑 e2e 前需 pnpm --filter @pet/desktop build）
  const mainEntry = join(APP_DIR, 'out', 'main', 'index.js');
  if (!existsSync(mainEntry)) {
    throw new Error(`未找到 ${mainEntry} —— 请先运行 pnpm --filter @pet/desktop build`);
  }
  app = await electron.launch({
    args: ['.'],
    cwd: APP_DIR,
  });
});

test.afterAll(async () => {
  await app?.close();
});

test('app launches and pet window is created', async () => {
  const firstWindow: Page = await app.firstWindow();
  expect(firstWindow).toBeTruthy();
  // 窗口创建（透明度/置顶等 8.4 属性在 renderer 测试中进一步验证）
  expect(app.windows().length).toBeGreaterThan(0);
});

test('renderer loads the app shell', async () => {
  const firstWindow: Page = await app.firstWindow();
  await firstWindow.waitForLoadState('domcontentloaded');
  await expect(firstWindow.locator('.pet-stage')).toBeVisible();
});

test('preload exposes the minimal versioned API (8.3)', async () => {
  const firstWindow: Page = await app.firstWindow();
  const api = await firstWindow.evaluate(() => {
    const pet = (window as unknown as { pet?: Record<string, unknown> }).pet;
    return pet ? { version: pet.version, platform: pet.platform } : null;
  });
  expect(api).not.toBeNull();
  expect(typeof api?.version).toBe('string');
});

test('contextIsolation is on (8.3 security baseline)', async () => {
  const firstWindow: Page = await app.firstWindow();
  const isolated = await firstWindow.evaluate(() => {
    // contextIsolation: true 时，渲染进程拿不到 Node 全局
    // @ts-expect-error 故意探测
    return typeof window.require === 'undefined' && typeof window.process === 'undefined';
  });
  expect(isolated).toBe(true);
});
