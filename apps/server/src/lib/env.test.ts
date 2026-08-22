/**
 * 环境变量 schema 校验测试（P2 收尾）：必填缺失/非法 fail-fast。
 */
import { describe, expect, it } from 'vitest';

import { parseRequiredEnv } from './env.js';

describe('parseRequiredEnv', () => {
  it('必填齐全：返回解析值（PORT 数字化）', () => {
    const env = parseRequiredEnv({
      DATABASE_URL: 'postgres://localhost/pet',
      JWT_SECRET: 'a'.repeat(32),
      PORT: '8787',
    });
    expect(env.DATABASE_URL).toBe('postgres://localhost/pet');
    expect(env.PORT).toBe(8787);
  });

  it('缺少 DATABASE_URL：抛错（启动中止）', () => {
    expect(() => parseRequiredEnv({ JWT_SECRET: 'x' })).toThrow(/DATABASE_URL/);
  });

  it('缺少 JWT_SECRET：抛错（启动中止）', () => {
    expect(() => parseRequiredEnv({ DATABASE_URL: 'postgres://x/y' })).toThrow(/JWT_SECRET/);
  });

  it('PORT 非法（0/负数/非数字）：抛错', () => {
    expect(() =>
      parseRequiredEnv({ DATABASE_URL: 'postgres://x/y', JWT_SECRET: 's', PORT: '0' }),
    ).toThrow(/环境变量校验失败/);
    expect(() =>
      parseRequiredEnv({ DATABASE_URL: 'postgres://x/y', JWT_SECRET: 's', PORT: 'abc' }),
    ).toThrow(/环境变量校验失败/);
  });
});
