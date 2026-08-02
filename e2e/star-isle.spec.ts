/**
 * Task 12 —— 星屿可见/可交互/可拖动/托盘恢复/本地聊天 e2e。
 *
 * 不依赖后端：全程本地模式（会话恢复失败 → 登录页 → 先逛逛（本地模式））。
 * 串行（workers=1，Electron 单实例锁）；共享一个 app 实例（restart 场景除外）。
 *
 * 像素阈值依据（PIXEL_THRESHOLD）：桌宠窗 240×260 CSS px、透明背景。
 * 角色 SVG（320×380 viewBox，xMidYMax meet）约占窗口高度 70%，主体（头/身/尾/耳）
 * 约占窗口面积 50%+。实测（本机 RDP 环境）冷启动可见像素约 4 万（alpha>16 计数）；
 * 取安全下限 8000（约实测值 1/6），仅用来证明"角色真实画出来了"而非空窗/白屏/
 * 渲染错误降级——阈值远低于角色实际像素量，DPR/字号差异不会误杀。
 */
import { expect, test } from '@playwright/test';

import { launchPetApp } from './helpers/electron-app.js';
import type { PetApp, PetWindowState } from './helpers/electron-app.js';
import { assertBodyVisible } from './helpers/pixel-assertions.js';

const PIXEL_THRESHOLD = 8_000;

let app: PetApp;

test.beforeAll(async () => {
  app = await launchPetApp();
});

test.afterAll(async () => {
  await app?.close();
});

test('冷启动：星屿可见且角色像素充足（透明窗非空白）', async () => {
  const pet = await app.petWindow();
  const isle = pet.getByRole('img', { name: '星尾狐猫星屿' });
  await expect(isle).toBeVisible();
  await expect(isle).toHaveAttribute('data-motion', 'idle', { timeout: 15_000 });

  // 透明窗口像素断言：alpha>16 的像素数（省略背景后角色不透明填充）
  const count = await assertBodyVisible(pet, undefined, PIXEL_THRESHOLD);
  // 实测值用于校准阈值（见文件头注释）
  console.info(`[star-isle] 冷启动可见像素 = ${count}（阈值 ${PIXEL_THRESHOLD}）`);

  const state = await app.windowState('pet');
  expect(state?.visible).toBe(true);
});

test('交互：摸头触发 touch 动作；双击身体打开聊天面板', async () => {
  const pet = await app.petWindow();
  const isle = pet.getByRole('img', { name: '星尾狐猫星屿' });

  // 先等启动动画结束（happy → idle），保证后续断言不被 boot 动画覆盖
  await expect(isle).toHaveAttribute('data-motion', 'idle', { timeout: 15_000 });

  // 命中区使用组内透明 rect（有盒模型，可点击；不依赖 viewBox 与窗口的换算）
  // 摸头（data-hit=head）→ head_touch → 动作 touch（force：头部呼吸动画中 rect 有 ±2px 位移）
  await isle.locator('[data-hit="head"] [data-hit-rect]').click({ force: true });
  await expect(isle).toHaveAttribute('data-motion', 'touch', { timeout: 5_000 });

  // 与摸头点击隔开（双击判定窗 320ms），再双击身体 → 打开聊天面板
  await pet.waitForTimeout(500);
  await isle.locator('[data-hit="body"] [data-hit-rect]').dblclick({ force: true });

  // 面板窗（surface=panel，懒创建）出现且落在登录页（无后端）
  const panel = await app.panelWindow();
  await expect(panel.locator('.login-page')).toBeVisible({ timeout: 15_000 });
});

test('拖动：拖拽后窗口移动，restart() 后位置持久化还原', async () => {
  const pet = await app.petWindow();
  const before = (await app.windowState('pet')) as PetWindowState;

  // 从身体命中区中心按下并拖动（位移 ≥6px 才启动拖动；取 60/40 确保触发）
  const isle = pet.getByRole('img', { name: '星尾狐猫星屿' });
  const bodyRect = await isle.locator('[data-hit="body"] [data-hit-rect]').boundingBox();
  if (!bodyRect) throw new Error('找不到星屿身体命中区');
  const fromX = bodyRect.x + bodyRect.width / 2;
  const fromY = bodyRect.y + bodyRect.height / 2;
  await pet.mouse.move(fromX, fromY);
  await pet.mouse.down();
  await pet.mouse.move(fromX + 60, fromY + 40, { steps: 5 });
  await pet.mouse.up();

  // 等窗口真的移动了
  await expect
    .poll(
      async () => {
        const s = await app.windowState('pet');
        return s !== null && (s.bounds.x !== before.bounds.x || s.bounds.y !== before.bounds.y);
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  const after = (await app.windowState('pet')) as PetWindowState;
  expect(after.bounds.x !== before.bounds.x || after.bounds.y !== before.bounds.y).toBe(true);

  // 给 moved 事件 + positionStore.save 留出写盘时间
  await pet.waitForTimeout(800);

  // 重启（复用同一 userDataDir）→ 位置按持久化的 anchor 恢复
  await app.restart();
  await expect
    .poll(
      async () => {
        const s = await app.windowState('pet');
        return (
          s !== null &&
          s.visible === true &&
          Math.abs(s.bounds.x - after.bounds.x) <= 1 &&
          Math.abs(s.bounds.y - after.bounds.y) <= 1
        );
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const restored = (await app.windowState('pet')) as PetWindowState;
  expect(Math.abs(restored.bounds.x - after.bounds.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(restored.bounds.y - after.bounds.y)).toBeLessThanOrEqual(1);
  expect(restored.visible).toBe(true);
});

test('托盘恢复：穿透开关 + 隐藏/显示（8.4 不可恢复事故为 0）', async () => {
  await app.invokeTrayAction('toggle-pass-through');
  await expect.poll(async () => (await app.trayState()).passThrough === true).toBe(true);

  await app.invokeTrayAction('hide');
  await expect
    .poll(
      async () => {
        const s = await app.windowState('pet');
        return s === null || s.visible === false;
      },
      { timeout: 10_000 },
    )
    .toBe(true);

  await app.invokeTrayAction('show');
  await expect
    .poll(async () => (await app.windowState('pet'))?.visible === true, { timeout: 10_000 })
    .toBe(true);
  await expect.poll(async () => (await app.trayState()).passThrough === false).toBe(true);
});

test('本地聊天：面板本地模式输入 → 宠物气泡出现，宠物窗保持可见', async () => {
  const panel = await app.openPanel('chat');
  await expect(panel.locator('.login-page')).toBeVisible({ timeout: 15_000 });

  await panel.getByRole('button', { name: '先逛逛（本地模式）' }).click();
  await expect(panel.locator('.local-chat')).toBeVisible();

  await panel.locator('.chat-input-row input').fill('你好');
  await panel.getByRole('button', { name: '发送' }).click();

  const pet = await app.petWindow();
  const speech = pet.locator('.pet-speech');
  await expect(speech).toBeVisible({ timeout: 10_000 });
  await expect(speech).not.toBeEmpty();

  expect((await app.windowState('pet'))?.visible).toBe(true);
});

test('面板关闭不影响宠物：面板关闭后宠物窗仍可见', async () => {
  // 面板可能停留在上一用例的本地模式，不断言登录页，只确认应用外壳
  const panel = await app.openPanel('chat');
  await expect(panel.locator('.pet-stage')).toBeVisible({ timeout: 15_000 });
  expect((await app.windowState('pet'))?.visible).toBe(true);

  // 关闭面板页（等价用户关闭面板窗）→ 宠物窗不受影响
  await panel.close();
  await expect
    .poll(
      async () => {
        const s = await app.windowState('panel');
        return s === null || s.visible === false;
      },
      { timeout: 10_000 },
    )
    .toBe(true);

  expect((await app.windowState('pet'))?.visible).toBe(true);
});

test('reduced-motion：档案开启减弱动态后星屿响应', async () => {
  const pet = await app.petWindow();
  const panel = await app.openPanel('chat');

  // 档案写入仅面板窗可调用（pet-profile:set 仅 panel surface）
  await panel.evaluate(async () => {
    const current = await window.pet.petProfile.get();
    await window.pet.petProfile.set({ ...current, reducedMotion: true });
  });

  // 宠物页重新挂载后按档案设置 data-reduced-motion
  await pet.reload();
  await expect(pet.locator('svg.star-isle')).toHaveAttribute('data-reduced-motion', 'true', {
    timeout: 15_000,
  });
});
