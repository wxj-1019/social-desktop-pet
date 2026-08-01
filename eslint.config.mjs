import petConfig from '@pet/eslint-config';

export default petConfig([
  {
    name: 'pet/overrides',
    files: ['**/*.test.ts', '**/*.test.tsx', '**/vitest.config.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
]);
