/**
 * 管理员初始化 CLI：pnpm --filter @pet/server admin:create <email>
 * 密码读取优先级：ADMIN_PASSWORD 环境变量 > 交互输入。绝不写入仓库/migration。
 */
import { createInterface } from 'node:readline/promises';

import { hashPasswordArgon2 } from '../src/auth/password.js';
import { PgAdminUserStore } from '../src/db/admin-stores.js';
import { createPool } from '../src/db/pool.js';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v;
}

async function main(): Promise<void> {
  const email = (process.argv[2] ?? '').toLowerCase().trim();
  if (!email || !email.includes('@')) {
    console.error('用法：pnpm --filter @pet/server admin:create <email>');
    process.exit(1);
  }
  let password = process.env['ADMIN_PASSWORD'] ?? '';
  if (!password) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    password = await rl.question('管理员密码（≥12 位）：');
    rl.close();
  }
  if (password.length < 12) {
    console.error('管理员密码至少 12 位');
    process.exit(1);
  }
  const pool = createPool({ connectionString: env('DATABASE_URL') });
  try {
    const store = new PgAdminUserStore(pool);
    const exists = await store.findByEmail(email);
    if (exists) {
      console.error(`管理员已存在：${email}`);
      process.exit(1);
    }
    const id = await store.create(email, await hashPasswordArgon2(password));
    console.info(`管理员创建成功：${email}（id=${id}）`);
  } finally {
    await pool.end();
  }
}

void main();
