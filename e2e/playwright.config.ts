import { defineConfig } from '@playwright/test';

/**
 * e2e 冒烟测试（Electron）。
 * 本地：pnpm test:e2e
 * CI：与 quality job 分离，避免重依赖下载拖慢主门禁。
 */
export default defineConfig({
  // config 位于 e2e/ 下，testDir 相对于 config 文件位置
  testDir: '.',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  // Electron 通过 _electron.launch 启动，无需 Playwright 浏览器
  use: {
    trace: 'retain-on-failure',
  },
});
