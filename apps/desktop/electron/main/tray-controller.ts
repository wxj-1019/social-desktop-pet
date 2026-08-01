/**
 * TrayController —— 对应设计稿 8.2（托盘）+ 8.4（穿透恢复入口）。
 *
 * 托盘常驻：显示/隐藏、穿透切换、勿扰开关、设置、完全退出。
 * 8.4：穿透始终可通过托盘恢复（不可恢复事故为 0，15.2 Go/No-Go）。
 */
import { join } from 'node:path';

import { Menu, Tray, nativeImage } from 'electron';
import type { BrowserWindow } from 'electron';

export interface TrayHandlers {
  onTogglePassThrough: (on: boolean) => void;
  onToggleDnd: (on: boolean) => void;
  onQuit: () => void;
}

export class TrayController {
  private tray: Tray | null = null;
  private passThrough = false;
  private dnd = false;

  constructor(
    private readonly win: () => BrowserWindow | null,
    private readonly handlers: TrayHandlers,
  ) {}

  /** 创建托盘（第 3 周接入正式图标；骨架用空图占位） */
  create(): void {
    if (this.tray) return;
    // 16×16 空图占位（正式图标第 3 周提供 resources/tray.png）
    const icon = nativeImage.createEmpty();
    this.tray = new Tray(icon);
    this.tray.setToolTip('AI 桌宠');
    this.tray.setContextMenu(this.buildMenu());
    this.tray.on('double-click', () => this.showWindow());
  }

  /** 重建菜单（状态变化后调用） */
  refresh(): void {
    if (this.tray) this.tray.setContextMenu(this.buildMenu());
  }

  private buildMenu(): Menu {
    return Menu.buildFromTemplate([
      {
        label: '显示桌宠',
        click: () => this.showWindow(),
      },
      { type: 'separator' },
      {
        label: `鼠标穿透：${this.passThrough ? '开' : '关'}`,
        click: () => {
          this.passThrough = !this.passThrough;
          this.handlers.onTogglePassThrough(this.passThrough);
          this.refresh();
        },
      },
      {
        label: `勿扰：${this.dnd ? '开' : '关'}`,
        click: () => {
          this.dnd = !this.dnd;
          this.handlers.onToggleDnd(this.dnd);
          this.refresh();
        },
      },
      { type: 'separator' },
      { label: '设置', enabled: false, toolTip: '第 3 周接入 Settings 页' },
      {
        label: '完全退出',
        click: () => this.handlers.onQuit(),
      },
    ]);
  }

  private showWindow(): void {
    const w = this.win();
    if (!w) return;
    // 8.4：从穿透/隐藏恢复
    w.show();
    w.setIgnoreMouseEvents(false);
    this.passThrough = false;
    this.refresh();
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}

/** 托盘图标路径（正式资源第 3 周提供） */
export function trayIconPath(): string {
  return join(__dirname, '../../resources/tray.png');
}
