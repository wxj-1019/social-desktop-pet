/**
 * 密码哈希测试 —— argon2id 替换 scrypt（含旧格式兼容升级）。
 */
import { randomBytes, scryptSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { hashPasswordArgon2, isArgon2Hash, verifyPassword } from './password.js';

/** 旧格式：salt(32 hex) + scrypt hash(128 hex)（与迁移前实现一致） */
function legacyScryptHash(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return salt + scryptSync(password, salt, 64).toString('hex');
}

describe('argon2 密码哈希（新格式）', () => {
  it('hashPasswordArgon2 输出 PHC 格式，verify 通过/拒绝', async () => {
    const stored = await hashPasswordArgon2('password123');
    expect(stored).toContain('$argon2id$');
    expect(isArgon2Hash(stored)).toBe(true);
    const ok = await verifyPassword('password123', stored);
    expect(ok).toEqual({ ok: true, needsUpgrade: false });
    const bad = await verifyPassword('wrong-password', stored);
    expect(bad).toEqual({ ok: false, needsUpgrade: false });
  });

  it('每次哈希不同（随机 salt）', async () => {
    const a = await hashPasswordArgon2('same');
    const b = await hashPasswordArgon2('same');
    expect(a).not.toBe(b);
    expect((await verifyPassword('same', a)).ok).toBe(true);
    expect((await verifyPassword('same', b)).ok).toBe(true);
  });
});

describe('旧 scrypt 格式兼容（平滑迁移）', () => {
  it('旧格式可验证 + needsUpgrade=true（登录后写回 argon2）', async () => {
    const stored = legacyScryptHash('password123');
    expect(isArgon2Hash(stored)).toBe(false);
    const ok = await verifyPassword('password123', stored);
    expect(ok).toEqual({ ok: true, needsUpgrade: true });
    const bad = await verifyPassword('wrong', stored);
    expect(bad).toEqual({ ok: false, needsUpgrade: false });
  });

  it('畸形存储（长度/格式非法）→ 校验失败且不误报升级', async () => {
    expect((await verifyPassword('x', 'not-a-hash')).ok).toBe(false);
    expect((await verifyPassword('x', 'ab')).ok).toBe(false);
    expect((await verifyPassword('x', `${'0'.repeat(159)}`)).ok).toBe(false);
  });
});
