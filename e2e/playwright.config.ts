import { defineConfig } from '@playwright/test';

/**
 * e2e 冒烟测试（Electron）。
 * 本地：pnpm test:e2e
 * CI：与 quality job 分离，避免重依赖下载拖慢主门禁。
 */
export default defineConfig({
  // config 位于 e2e/ 下，testDir 相对于 config 文件位置
  testDir: '.',
  // 本地环境自愈：后端可达时预置测试账号/好友（不可达则静默跳过，CI 无后端）
  globalSetup: './helpers/global-setup.ts',
  timeout: 60_000,
  // CI 环境给 Electron 启动波动留一次重试缓冲（本地 0 保持快速反馈）
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['list']],
  // Electron 应用有单实例锁：spec 文件必须串行（workers=1）
  workers: 1,
  // Electron 通过 _electron.launch 启动，无需 Playwright 浏览器
  use: {
    trace: 'retain-on-failure',
  },
});
