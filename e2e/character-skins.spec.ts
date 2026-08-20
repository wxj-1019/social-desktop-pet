/**
 * 每角色 E2E smoke（形象协议阶段 D；验收项「角色级 E2E smoke 覆盖打开、交互和切换」）。
 *
 * 两个 dev-only 角色各走一条完整链路：
 *   面板角色页切换 → 新桌宠窗渲染对应 renderer → manifest 几何命中点击 → 回切星屿。
 * - CodeNoNo（spritesheet）：primary 命中区 rect(34,73,173,187)，中心 ~(120,166)
 * - 奶盖（image-sequence）：primary 命中区 rect(12,22,216,214)，中心 ~(120,130)
 *
 * 命中链路（协议 §6）：PetExperience 把点击换算回 240×260 逻辑画布做纯几何命中，
 * primary → body_touch（zone-hit.ts §6.3）→ 运行时 intent=cheer
 *（pet-runtime-controller「身体点击给一个小开心跳」）→ data-motion='happy'。
 * cheer 冷却 10s / touch 冷却 15s——每个用例独立 app 实例（fresh userData），
 * 动作冷却不跨用例残留。
 *
 * 点击坐标按 windowState 实测 bounds 换算（宽/240、高/260；画布右下锚定，
 * 菜单收起时铺满窗口）：缩放档位 ≠1 时几何命中同样成立。
 * 不依赖后端：全程本地模式（openPanel → 面板 tab 角色页）。
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

import { launchPetApp } from './helpers/electron-app.js';
import type { PetApp } from './helpers/electron-app.js';

/** manifest 逻辑画布尺寸（与 Main 侧 PET_WINDOW_SIZE 一致，协议 §5.1） */
const CANVAS = { width: 240, height: 260 } as const;

let app: PetApp;

test.beforeEach(async () => {
  app = await launchPetApp();
});

test.afterEach(async () => {
  await app?.close();
});

/**
 * 打开面板并切到角色页（本地模式：托盘 open-chat → tab 角色）。
 *
 * 面板启动竞态规避（本机当前基线问题，star-isle.spec 既有用例同样受影响）：
 * ① 首次懒创建时 panel:navigate 在渲染进程订阅挂载前投递可能丢失；
 * ② 会话恢复（session.init）在面板挂载后仍异步落定——若导航先切进本地模式，
 *    init 的 signed_out 结果会把整棵树再打回登录页（tab 被连根替换，点击一直 detach）。
 * 对策：先等面板离开 booting（会话已落定），再导航一次——此后本地模式稳定。
 */
// TODO(product): 面板启动竞态修复后移除本规避（panel:navigate 早于订阅 + session.init 覆盖本地模式）
async function openCharacterSelect(): Promise<Page> {
  const panel = await app.openPanel('chat');
  await expect(panel.locator('.pet-stage--auth, .pet-stage--app')).toBeVisible({
    timeout: 15_000,
  });
  await app.openPanel('chat');
  await panel.getByRole('tab', { name: '角色' }).click({ timeout: 15_000 });
  await expect(panel.locator('.character-select')).toBeVisible({ timeout: 15_000 });
  return panel;
}

/**
 * 点击角色卡片并等待重建后的新桌宠窗（setCharacter → Main 销毁旧窗再建新窗）。
 * 轮询出现一个 ≠ previous 的 surface=pet 窗口，避免拿到即将销毁的旧页句柄。
 */
async function switchToCharacter(panel: Page, name: RegExp): Promise<Page> {
  const previous = await app.petWindow();
  await panel.getByRole('radio', { name }).click();
  let next: Page | undefined;
  await expect
    .poll(
      () => {
        for (const win of app.app.windows()) {
          if (win === previous) continue;
          try {
            if (new URL(win.url()).searchParams.get('surface') === 'pet') {
              next = win;
              return true;
            }
          } catch {
            // 页面仍在加载或已销毁：跳过继续轮询
          }
        }
        return false;
      },
      { timeout: 20_000, message: `等待切换 ${name.source} 后的新桌宠窗出现` },
    )
    .toBe(true);
  return next!;
}

/**
 * 在桌宠窗上按 240×260 逻辑画布坐标点击：页面坐标 = 逻辑坐标 × (bounds / CANVAS)。
 * pet 必须传 switchToCharacter 返回的新窗——内部重新 petWindow() 可能匹配到
 * 仍列在 windows() 里、即将销毁的旧窗句柄（切换后旧窗销毁与枚举存在竞态）。
 */
async function clickPetCanvas(app: PetApp, pet: Page, x: number, y: number): Promise<void> {
  const state = await app.windowState('pet');
  if (!state) throw new Error('桌宠窗口状态不可用（windowState(pet) 返回 null）');
  const sx = state.bounds.width / CANVAS.width;
  const sy = state.bounds.height / CANVAS.height;
  if (Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01) {
    console.info(`[character-skins] 缩放档位 ≠1（sx=${sx}, sy=${sy}）：点击坐标已按比例换算`);
  }
  await pet.mouse.click(x * sx, y * sy);
}

/** 通用收尾：回切星屿并断言 SVG 星屿在新窗中可见（既有用例的断言形态） */
async function switchBackToStarIsle(): Promise<void> {
  const panel = await openCharacterSelect();
  const pet = await switchToCharacter(panel, /星屿/);
  await expect(pet.getByRole('img', { name: '星尾狐猫星屿' })).toBeVisible({ timeout: 15_000 });
}

test('CodeNoNo：切换后 spritesheet 渲染 + 几何命中点击有动作反馈 + 回切星屿', async () => {
  const panel = await openCharacterSelect();

  // 切 CodeNoNo → 宠物窗销毁重建，渲染 spritesheet 角色
  const pet = await switchToCharacter(panel, /CodeNoNo/);
  const visual = pet.locator('.spritesheet-pet');
  await expect(visual).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => (await app.windowState('pet'))?.visible === true, { timeout: 10_000 })
    .toBe(true);

  // 收起面板（面板锚定在宠物旁，可能盖住宠物窗）
  await panel.evaluate(() => window.pet?.panel?.close());

  // 等瞬态动作结束回 idle：活跃动作期间点击会被 shouldInterrupt 拦下无反馈
  await expect(visual).toHaveAttribute('data-motion', 'idle', { timeout: 15_000 });

  // primary 命中区中心 (120,166)：body_touch → intent=cheer → data-motion=happy
  await clickPetCanvas(app, pet, 120, 166);
  await expect(visual).toHaveAttribute('data-motion', 'happy', { timeout: 5_000 });

  await switchBackToStarIsle();
});

test('奶盖：切换后 image-sequence 渲染 + 几何命中点击有动作反馈 + 回切星屿', async () => {
  const panel = await openCharacterSelect();

  // 切奶盖 → 宠物窗销毁重建，渲染 image-sequence 角色
  const pet = await switchToCharacter(panel, /奶盖/);
  const visual = pet.locator('.image-pet');
  await expect(visual).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => (await app.windowState('pet'))?.visible === true, { timeout: 10_000 })
    .toBe(true);

  await panel.evaluate(() => window.pet?.panel?.close());
  await expect(visual).toHaveAttribute('data-motion', 'idle', { timeout: 15_000 });

  // primary 命中区中心 (120,130)：body_touch → intent=cheer → data-motion=happy（happy 帧）
  await clickPetCanvas(app, pet, 120, 130);
  await expect(visual).toHaveAttribute('data-motion', 'happy', { timeout: 5_000 });

  await switchBackToStarIsle();
});
