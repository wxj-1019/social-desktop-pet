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
        'packages/supabase/db/migrations/**',
        // Supabase Edge Functions 由 Deno 类型检查，跳过 tsc/eslint 的 TS 解析
        'packages/supabase/functions/**',
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
