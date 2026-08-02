import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { InvitePayload } from './deep-link-controller.js';
import { PendingInviteStore } from './pending-invite-store.js';

const PAYLOAD: InvitePayload = { userId: 'user-1', inviteCode: 'CODE2026', rawToken: 'tok_abc' };

const dirs: string[] = [];
function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), 'pending-invite-store-'));
  dirs.push(dir);
  const file = join(dir, 'pending-invite.json');
  return { file, store: new PendingInviteStore(file) };
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('PendingInviteStore（6.3 深链 pending 跨重启持久化）', () => {
  it('load returns null when the file does not exist', () => {
    const { store } = makeStore();
    expect(store.load()).toBeNull();
  });

  it('save then load round-trips the invite payload', () => {
    const { file, store } = makeStore();
    store.save(PAYLOAD);
    expect(store.load()).toEqual(PAYLOAD);
    // 文件内容为 { payload: ... } 信封（供人工排查/降级）
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as { payload: unknown };
    expect(raw.payload).toEqual(PAYLOAD);
  });

  it('clear writes payload:null so load returns null', () => {
    const { store } = makeStore();
    store.save(PAYLOAD);
    store.clear();
    expect(store.load()).toBeNull();
  });

  it('load returns null for corrupted JSON', () => {
    const { file, store } = makeStore();
    writeFileSync(file, '{not-json');
    expect(store.load()).toBeNull();
  });

  it('load returns null when the file does not match the schema', () => {
    const { file, store } = makeStore();
    writeFileSync(file, JSON.stringify({ payload: { userId: 42 } })); // userId 非 string
    expect(store.load()).toBeNull();
  });

  it('simulates a restart: a new store instance on the same file restores the pending invite', () => {
    const { file } = makeStore();
    new PendingInviteStore(file).save(PAYLOAD);

    const restarted = new PendingInviteStore(file);
    expect(restarted.load()).toEqual(PAYLOAD);
  });
});
