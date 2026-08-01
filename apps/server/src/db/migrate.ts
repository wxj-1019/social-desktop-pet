/**
 * 迁移 runner —— 启动时应用 apps/server/migrations/*.sql（0003 记账表）。
 * 用法：pnpm --filter @pet/server migrate（需 DATABASE_URL）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';

import { listMigrationFiles, migrationsDir } from './pool.js';

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

/**
 * 应用未执行的迁移（每个迁移在一个事务里执行；RLS 兼容函数等 DDL 均幂等）。
 * @param pool 传入连接池（可测试注入；CLI 场景用 createPool）
 */
export async function migrate(pool: pg.Pool, dir = migrationsDir()): Promise<MigrateResult> {
  // 确保记账表存在（0003 也会建，但启动时序上先建无害）
  await pool.query(`
    create table if not exists schema_migrations (
      version    text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = listMigrationFiles(dir);
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const { rows } = await pool.query('select 1 from schema_migrations where version = $1', [file]);
    if (rows.length > 0) {
      skipped.push(file);
      continue;
    }
    const sql = readFileSync(join(dir, file), 'utf-8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (version) values ($1)', [file]);
      await client.query('commit');
      applied.push(file);
    } catch (e) {
      await client.query('rollback');
      throw new Error(`migration ${file} 失败：${(e as Error).message}`, { cause: e });
    } finally {
      client.release();
    }
  }
  return { applied, skipped };
}

/** CLI 入口：pnpm --filter @pet/server migrate */
if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = new pg.Pool({ connectionString: process.env['DATABASE_URL'] });
  try {
    const result = await migrate(pool);
    console.info(
      `[migrate] applied=${result.applied.join(',') || '(none)'} skipped=${result.skipped.length}`,
    );
  } catch (e) {
    console.error('[migrate] 失败：', (e as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
