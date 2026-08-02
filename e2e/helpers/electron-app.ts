/**
 * Electron 应用启动/操作 helper —— 消除既有 specs 的"单窗"假设（firstWindow()）。
 *
 * 设计要点：
 * - 全部窗口按 URL searchParams surface=pet|panel 查找（findWindow + expect.poll），
 *   严禁 firstWindow()；面板窗是懒创建的，panelWindow() 会等到它出现。
 * - 每个测试用独立 mkdtemp userData 目录（PET_E2E_USER_DATA_DIR），
 *   与 PET_E2E=1 配合由 Main 在 ready 前隔离（见 electron/main/index.ts）。
 * - Main 进程动作走 __petE2E hook（PET_E2E=1 时才存在）：托盘 dispatch / 托盘快照 /
 *   窗口状态。经 app.evaluate 直接调用，不走 IPC（E2E 专用，生产不暴露）。
 * - restart() 复用同一 userDataDir，用于验证位置持久化（8.5）。
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { _electron, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';

const APP_DIR = join(__dirname, '..', '..', 'apps', 'desktop');

export type PetSurface = 'pet' | 'panel';
export type PanelView = 'chat' | 'friends' | 'login';

export interface PetWindowState {
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
}

export type TrayState = { dnd: boolean; passThrough: boolean };

export type TrayAction =
  'open-chat' | 'open-friends' | 'toggle-dnd' | 'toggle-pass-through' | 'hide' | 'show' | 'quit';

/** __petE2E hook 在 Main 进程暴露的最小契约（与 index.ts 保持一致） */
export interface PetE2EHook {
  invokeTrayAction(action: TrayAction): boolean;
  getTrayState(): TrayState;
  getPetWindowState(): PetWindowState | null;
  getWindowState(surface: PetSurface): PetWindowState | null;
}

export class PetApp {
  private _app: ElectronApplication;
  readonly userDataDir: string;
  private readonly extraArgs: string[];

  constructor(app: ElectronApplication, userDataDir: string, extraArgs: string[] = []) {
    this._app = app;
    this.userDataDir = userDataDir;
    this.extraArgs = extraArgs;
  }

  /** 当前 ElectronApplication（restart() 后指向新实例） */
  get app(): ElectronApplication {
    return this._app;
  }

  /** 等 surface=pet 窗口出现（冷启动即有；禁 firstWindow） */
  async petWindow(): Promise<Page> {
    return findWindow(this._app, 'pet');
  }

  /** 等 surface=panel 窗口出现（懒创建：双击宠物或托盘"打开聊天"后才有） */
  async panelWindow(): Promise<Page> {
    return findWindow(this._app, 'panel');
  }

  /** 打开面板（经托盘 open-chat/open-friends，与用户路径等价）并返回面板页 */
  async openPanel(view: PanelView = 'chat'): Promise<Page> {
    await this.invokeTrayAction(view === 'friends' ? 'open-friends' : 'open-chat');
    return this.panelWindow();
  }

  /** 窗口状态：Main 进程按 URL surface 匹配（bounds/visible）；无匹配返回 null */
  async windowState(surface: PetSurface): Promise<PetWindowState | null> {
    // 注意：electronApp.evaluate 的第一个实参是 electron 模块，业务参数是第二个
    return this._app.evaluate((_electron, target) => {
      const hook = (globalThis as unknown as { __petE2E?: PetE2EHook }).__petE2E;
      if (!hook?.getWindowState) {
        throw new Error('__petE2E.getWindowState hook 缺失（PET_E2E=1 时才有）');
      }
      return hook.getWindowState(target);
    }, surface);
  }

  /** 托盘动作（直接调 Main 的 TrayController.dispatch；hook 缺失抛错） */
  async invokeTrayAction(action: TrayAction): Promise<void> {
    // 轮询直到 dispatch 生效：应用启动初期 tray 尚未创建（invoke 返回 false）
    await expect
      .poll(
        () =>
          this._app.evaluate((_electron, act) => {
            const hook = (globalThis as unknown as { __petE2E?: PetE2EHook }).__petE2E;
            if (!hook?.invokeTrayAction) {
              throw new Error('__petE2E.invokeTrayAction hook 缺失（PET_E2E=1 时才有）');
            }
            return hook.invokeTrayAction(act) === true;
          }, action),
        {
          timeout: 15_000,
          message: `托盘动作 ${action} 未生效（tray 未就绪或 dispatch 失败）`,
        },
      )
      .toBe(true);
  }

  /** 托盘状态快照（dnd/passThrough） */
  async trayState(): Promise<TrayState> {
    return this._app.evaluate(() => {
      const hook = (globalThis as unknown as { __petE2E?: PetE2EHook }).__petE2E;
      if (!hook?.getTrayState) {
        throw new Error('__petE2E.getTrayState hook 缺失（PET_E2E=1 时才有）');
      }
      return hook.getTrayState();
    });
  }

  /** 重启应用（复用同一 userDataDir；验证位置/档案持久化） */
  async restart(): Promise<void> {
    await this._app.close();
    this._app = await launchElectron(this.userDataDir, this.extraArgs);
  }

  /** 关闭应用并清理 userData 目录 */
  async close(): Promise<void> {
    await this._app.close();
    rmSync(this.userDataDir, { recursive: true, force: true });
  }
}

/** 等某 surface 窗口出现并返回其 Page；禁 firstWindow() */
async function findWindow(app: ElectronApplication, surface: PetSurface): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(
      () => {
        for (const win of app.windows()) {
          try {
            if (new URL(win.url()).searchParams.get('surface') === surface) {
              found = win;
              return true;
            }
          } catch {
            // 页面仍在加载或已销毁：跳过继续轮询
          }
        }
        return false;
      },
      {
        timeout: 20_000,
        message: `等待 surface=${surface} 窗口出现`,
      },
    )
    .toBe(true);
  return found!;
}

async function launchElectron(
  userDataDir: string,
  extraArgs: string[],
): Promise<ElectronApplication> {
  return _electron.launch({
    args: ['.', ...extraArgs],
    cwd: APP_DIR,
    env: {
      ...process.env,
      PET_E2E: '1',
      PET_E2E_USER_DATA_DIR: userDataDir,
    },
  });
}

/**
 * 启动桌宠应用：独立 userData 目录 + PET_E2E=1（__petE2E hook 生效）。
 * 生产构建产物不存在时直接报错（CI/本地跑 e2e 前需先 pnpm --filter @pet/desktop build）。
 */
export async function launchPetApp(extraArgs: string[] = []): Promise<PetApp> {
  const mainEntry = join(APP_DIR, 'out', 'main', 'index.js');
  if (!existsSync(mainEntry)) {
    throw new Error(`未找到 ${mainEntry} —— 请先运行 pnpm --filter @pet/desktop build`);
  }
  const userDataDir = mkdtempSync(join(tmpdir(), 'pet-e2e-'));
  const app = await launchElectron(userDataDir, extraArgs);
  return new PetApp(app, userDataDir, extraArgs);
}
