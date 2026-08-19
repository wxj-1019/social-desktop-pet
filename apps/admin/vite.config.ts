import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/**
 * dev 专用：vite dev 把 client 引导脚本内联进 HTML，meta CSP `script-src 'self'`
 * 会拦截它导致白屏。仅 serve 模式放宽 script-src；build 产物无内联脚本，保持严格。
 */
function devCspRelaxPlugin(): Plugin {
  return {
    name: 'dev-csp-relax',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'");
    },
  };
}

export default defineConfig({
  plugins: [react(), devCspRelaxPlugin()],
  root: 'src',
  build: { outDir: '../dist' },
  server: {
    port: 5175,
    strictPort: true,
    // dev 同源代理：/admin/* 转发到自建后端（cookie 保持同源语义）
    proxy: { '/admin': 'http://127.0.0.1:8787' },
  },
  preview: {
    port: 5175,
    strictPort: true,
    // 生产构建预览（e2e GUI 冒烟）：与 dev 同策略同源代理 /admin/*
    proxy: { '/admin': 'http://127.0.0.1:8787' },
  },
});
