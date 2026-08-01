import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: 'electron/main/index.ts' },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: 'electron/preload/index.ts' },
    },
  },
  renderer: {
    root: 'src',
    resolve: {
      alias: { '@': resolve(__dirname, 'src') },
      // 审查修复 #2：显式声明 development 条件，确保 @pet/* 在 dev 命中源码（无需先 build dist）
      conditions: ['development', 'module', 'browser', 'import'],
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/index.html') },
      },
    },
  },
});
