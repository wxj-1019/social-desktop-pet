/**
 * AtomicJsonStore —— 本地 JSON 持久化（原子写：临时文件 + rename 替换）。
 *
 * 仅用于非敏感数据（宠物档案、窗口位置）；敏感数据走 SecureStorageController。
 * 读取失败（文件不存在 / JSON 损坏 / schema 不匹配）一律回退到 fallback；
 * 写入失败向上抛出，由调用方决定如何处理。
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ZodType } from 'zod';

export class AtomicJsonStore<T> {
  private readonly file: string;
  private readonly schema: ZodType<T>;
  private readonly fallback: T;

  constructor(file: string, schema: ZodType<T>, fallback: T) {
    this.file = file;
    this.schema = schema;
    this.fallback = fallback;
  }

  /** 读取；文件缺失或内容非法时返回 fallback */
  load(): T {
    try {
      const raw = readFileSync(this.file, 'utf-8');
      return this.schema.parse(JSON.parse(raw));
    } catch {
      return this.fallback;
    }
  }

  /**
   * 原子写入：先校验，再写 `${file}.${pid}.tmp`，最后 rename 替换目标。
   * 写入异常向上抛出；Windows 上 rename 覆盖已存在目标可能抛 EPERM，
   * 此时先删目标再重试一次（仅此 fallback）。
   */
  save(value: T): void {
    const parsed = this.schema.parse(value); // 非法值在写盘前抛出
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(parsed), { mode: 0o600 }); // 防御性最小权限
      renameSync(tmp, this.file);
    } catch (err) {
      if (isEperm(err)) {
        rmSync(this.file, { force: true });
        try {
          renameSync(tmp, this.file);
        } catch (retryErr) {
          rmSync(tmp, { force: true });
          throw retryErr;
        }
      } else {
        rmSync(tmp, { force: true });
        throw err;
      }
    }
  }
}

function isEperm(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'EPERM';
}
