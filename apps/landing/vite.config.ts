import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // index.html 在 src/ 下；输出到 dist/（部署到官网根路径或任意静态托管）
  root: 'src',
  build: { outDir: '../dist' },
});
