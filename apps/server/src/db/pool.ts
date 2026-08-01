/**
 * DB 连接池 —— 自建后端（D-13）。
 * 连接串从环境变量 DATABASE_URL 读取（.env.example）。
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';

export interface DbConfig {
  connectionString: string;
  max?: number;
}

export function createPool(config: DbConfig): pg.Pool {
  return new pg.Pool({
    connectionString: config.connectionString,
    max: config.max ?? 20,
  });
}

/**
 * RLS 身份 claims（0003 兼容层：auth.uid() 从 request.jwt.claims 读取）。
 * 9.1：RLS 保留作纵深防御，应用层校验为主。
 * 用法：在事务连接上 `set local request.jwt.claims = $1`。
 */
export function rlsClaimsJson(userId: string): string {
  return JSON.stringify({ sub: userId });
}

/** 迁移文件目录（相对包根：apps/server/migrations） */
export function migrationsDir(): string {
  return join(process.cwd(), 'migrations');
}

/** 迁移文件（形如 0001_init.sql）按版本号排序 */
export function listMigrationFiles(dir = migrationsDir()): string[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
}
