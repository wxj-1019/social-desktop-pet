/**
 * 密码哈希 —— argon2id（OWASP 推荐）替换旧 scrypt。
 *
 * 存储格式：
 * - 新：PHC 字符串（@node-rs/argon2 输出，`$argon2id$v=19$...`）
 * - 旧：salt(32 hex) + scrypt hash(128 hex) 拼接（无 $ 前缀，可区分）
 *
 * 兼容升级：login 校验旧 scrypt 通过后调用方可 rehash 写回 argon2
 * （用户表 updatePassword），老用户平滑迁移。
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { hash, verify } from '@node-rs/argon2';

/** 生成 argon2id 哈希（PHC 格式） */
export function hashPasswordArgon2(password: string): Promise<string> {
  return hash(password);
}

/** 是否新格式（argon2 PHC 字符串含 $；旧 scrypt 拼接纯 hex 无 $） */
export function isArgon2Hash(stored: string): boolean {
  return stored.includes('$');
}

/** 校验密码；兼容新（argon2id）与旧（scrypt）两种存储格式 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  if (isArgon2Hash(stored)) {
    return { ok: await verify(stored, password), needsUpgrade: false };
  }
  // 旧格式：salt(32 hex) + scrypt hash(128 hex)
  if (stored.length !== 160) return { ok: false, needsUpgrade: false };
  const salt = stored.slice(0, 32);
  const expected = stored.slice(32);
  const candidate = scryptSync(password, salt, 64).toString('hex');
  const ok = timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(expected, 'hex'));
  return { ok, needsUpgrade: ok }; // 旧格式校验通过 → 建议升级
}

/** 生成随机 salt（保留给旧格式写测试/迁移用） */
export function randomSaltHex(): string {
  return randomBytes(16).toString('hex');
}
