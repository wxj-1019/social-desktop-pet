import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * alias 指向源码，测试不依赖各包 dist（审查发现 #2：干净 clone 后无需先 build 即可 test）。
 */
export default defineConfig({
  // apps/desktop 只有 tsconfig.web.json / tsconfig.node.json（无同名 tsconfig.json），
  // Vite 无法按文件发现 jsx 设置；统一走 automatic runtime（react/jsx-runtime）。
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@pet/protocol': fileURLToPath(new URL('./packages/protocol/src/index.ts', import.meta.url)),
      '@pet/config': fileURLToPath(new URL('./packages/config/src/index.ts', import.meta.url)),
      '@pet/ai-graph': fileURLToPath(new URL('./packages/ai-graph/src/index.ts', import.meta.url)),
      '@pet/pet-state': fileURLToPath(
        new URL('./packages/pet-state/src/index.ts', import.meta.url),
      ),
      '@pet/ui': fileURLToPath(new URL('./packages/ui/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: [
      'packages/**/src/**/*.test.ts',
      'packages/**/src/**/*.test.tsx',
      'apps/desktop/electron/**/*.test.ts',
      'apps/desktop/src/**/*.test.ts',
      'apps/desktop/src/**/*.test.tsx',
      'apps/admin/src/**/*.test.ts',
      'apps/admin/src/**/*.test.tsx',
      'apps/server/src/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/*/src/**'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/index.ts'],
    },
  },
});
