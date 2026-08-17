import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  root: 'src',
  build: { outDir: '../dist' },
  server: {
    port: 5175,
    strictPort: true,
    // dev 同源代理：/admin/* 转发到自建后端（cookie 保持同源语义）
    proxy: { '/admin': 'http://127.0.0.1:8787' },
  },
});
