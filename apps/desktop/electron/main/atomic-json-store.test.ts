import { mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AtomicJsonStore } from './atomic-json-store.js';

vi.mock('node:fs', { spy: true });

const schema = z
  .object({
    name: z.string(),
    count: z.number(),
  })
  .strict();

type Data = z.infer<typeof schema>;

const fallback: Data = { name: 'fallback', count: -1 };

const dirs: string[] = [];
function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'atomic-json-store-'));
  dirs.push(dir);
  const file = join(dir, 'data.json');
  return { dir, file, store: new AtomicJsonStore<Data>(file, schema, fallback) };
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('AtomicJsonStore', () => {
  it('load returns fallback when file does not exist', () => {
    const { store } = makeStore();
    expect(store.load()).toEqual(fallback);
  });

  it('save then load round-trips the same value', () => {
    const { store } = makeStore();
    const data: Data = { name: 'star-isle', count: 3 };
    store.save(data);
    expect(store.load()).toEqual(data);
  });

  it('load returns fallback for corrupted JSON', () => {
    const { file, store } = makeStore();
    writeFileSync(file, '{not-json');
    expect(store.load()).toEqual(fallback);
  });

  it('load returns fallback when data does not match schema', () => {
    const { file, store } = makeStore();
    writeFileSync(file, JSON.stringify({ name: 'x' })); // 缺 count 字段
    expect(store.load()).toEqual(fallback);
  });

  it('leaves no .tmp residue after save', () => {
    const { dir, store } = makeStore();
    store.save({ name: 'a', count: 1 });
    store.save({ name: 'b', count: 2 });
    expect(readdirSync(dir).filter((f) => f.includes('.tmp'))).toEqual([]);
    expect(readdirSync(dir)).toContain('data.json');
  });

  it('retries with unlink + rename when overwrite hits EPERM', () => {
    const { dir, store } = makeStore();
    store.save({ name: 'first', count: 1 });
    const spy = vi.mocked(renameSync);
    spy.mockClear();
    spy.mockImplementationOnce(() => {
      throw Object.assign(new Error('rename EPERM'), { code: 'EPERM' });
    });
    expect(() => store.save({ name: 'second', count: 2 })).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(2); // 一次失败 + 一次 unlink 后重试
    expect(store.load()).toEqual({ name: 'second', count: 2 });
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
