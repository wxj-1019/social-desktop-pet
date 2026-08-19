// @pet/eslint-config —— 共享 ESLint flat config
// 用法：在根 eslint.config.mjs 中 `import petConfig from '@pet/eslint-config'`
import importPlugin from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

/**
 * @param {Array<import('eslint').Linter.Config>} extra 额外覆盖
 * @returns {Array<import('eslint').Linter.Config>}
 */
export default function petConfig(extra = []) {
  return [
    {
      ignores: [
        '**/dist/**',
        '**/out/**',
        '**/build/**',
        '**/coverage/**',
        '**/node_modules/**',
        '**/*.tsbuildinfo',
        'apps/desktop/release/**',
        // 独立 git worktree（如 .worktrees/*），其源码与当前工作树版本可能不同，
        // 不应参与当前工作树的 lint
        '**/.worktrees/**',
      ],
    },
    ...tseslint.configs.recommended,
    {
      plugins: { 'import-x': importPlugin },
      rules: {
        'import-x/order': [
          'error',
          {
            'newlines-between': 'always',
            groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
            // @pet/* 固定归 internal：不依赖 resolver（干净克隆无 packages/*/dist 时
            // 解析失败会被判 external，导致同一文件在本地/CI 归类相反、互相冲突地报错）。
            // pathGroupsExcludedImportTypes 不含 external，确保强制重映射生效
            pathGroups: [{ pattern: '@pet/**', group: 'internal' }],
            pathGroupsExcludedImportTypes: ['builtin', 'object'],
            alphabetize: { order: 'asc', caseInsensitive: true },
          },
        ],
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/no-explicit-any': 'warn',
        'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
        eqeqeq: ['error', 'always'],
      },
    },
    ...extra,
  ];
}
