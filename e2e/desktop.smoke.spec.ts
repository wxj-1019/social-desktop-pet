/**
 * Electron 冒烟测试：应用能启动、窗口创建、renderer 加载、preload API 存在。
 * 覆盖 8.3 安全基线（nodeIntegration:false / contextIsolation:true）不回归。
 *
 * Task 12：窗口查找迁移到 helper（按 surface=pet 定位，不再假设 firstWindow）；
 * "renderer 加载"断言落在宠物窗的星屿直连交互面（surface=pet → PetExperience）。
 */
import { expect, test } from '@playwright/test';

import { launchPetApp } from './helpers/electron-app.js';
import type { PetApp } from './helpers/electron-app.js';

let app: PetApp;

test.beforeAll(async () => {
  app = await launchPetApp();
});

test.afterAll(async () => {
  await app?.close();
});

test('app launches and pet window is created', async () => {
  const pet = await app.petWindow();
  expect(pet).toBeTruthy();
  // 窗口创建（透明度/置顶等 8.4 属性在 renderer 测试中进一步验证）
  expect(app.app.windows().length).toBeGreaterThan(0);
});

test('pet renderer loads the Star Isle experience (surface=pet)', async () => {
  const pet = await app.petWindow();
  await pet.waitForLoadState('domcontentloaded');
  await expect(pet.locator('.pet-experience')).toBeVisible();
  await expect(pet.getByRole('img', { name: '星尾狐猫星屿' })).toBeVisible();
});

test('preload exposes the minimal versioned API (8.3)', async () => {
  const pet = await app.petWindow();
  const api = await pet.evaluate(() => {
    const petApi = (window as unknown as { pet?: Record<string, unknown> }).pet;
    return petApi ? { version: petApi.version, platform: petApi.platform } : null;
  });
  expect(api).not.toBeNull();
  expect(typeof api?.version).toBe('string');
});

test('contextIsolation is on (8.3 security baseline)', async () => {
  const pet = await app.petWindow();
  const isolated = await pet.evaluate(() => {
    // contextIsolation: true 时，渲染进程拿不到 Node 全局
    // @ts-expect-error 故意探测
    return typeof window.require === 'undefined' && typeof window.process === 'undefined';
  });
  expect(isolated).toBe(true);
});
