import { describe, expect, it, vi } from 'vitest';

import {
  compareSemver,
  UpdateController,
  type UpdateApi,
  type UpdateInfo,
} from './update-controller.js';

const info: UpdateInfo = {
  version: '1.1.0',
  url: 'https://updates.example.com/pet-1.1.0-setup.exe',
  sha256: 'a'.repeat(64),
  notes: 'fix bugs',
};

function makeApi(overrides?: Partial<UpdateApi>): UpdateApi {
  return {
    checkForUpdate: vi.fn(async () => info),
    download: vi.fn(async () => 'C:\\tmp\\update.exe'),
    verify: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('compareSemver (13.1 版本门禁)', () => {
  it('compares numeric segments (1.10.0 > 1.9.9)', () => {
    expect(compareSemver('1.10.0', '1.9.9')).toBe(1);
    expect(compareSemver('1.9.9', '1.10.0')).toBe(-1);
    expect(compareSemver('0.1.0', '0.0.9')).toBe(1);
  });

  it('prerelease sorts below release; stable 1.0.0 > 1.0.0-beta.2 > 1.0.0-alpha', () => {
    expect(compareSemver('1.0.0', '1.0.0-beta.2')).toBe(1);
    expect(compareSemver('1.0.0-beta.2', '1.0.0-alpha')).toBe(1);
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta.2')).toBe(-1);
    expect(compareSemver('1.0.0-beta.2', '1.0.0-beta.2')).toBe(0);
  });

  it('prerelease numeric identifiers compare numerically (beta.10 > beta.9)', () => {
    expect(compareSemver('1.0.0-beta.10', '1.0.0-beta.9')).toBe(1);
    expect(compareSemver('1.0.0-beta.9', '1.0.0-beta.10')).toBe(-1);
    expect(compareSemver('1.0.0-rc.12', '1.0.0-rc.2')).toBe(1);
  });

  it('prerelease numeric identifiers sort below alphanumeric; prefix is smaller', () => {
    // semver §11：数字标识符 < 字母数字标识符
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha.beta')).toBe(-1);
    // 所有对应段相等 → 段数更多者更大（alpha < alpha.1）
    expect(compareSemver('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
    expect(compareSemver('1.0.0-alpha.1', '1.0.0-alpha')).toBe(1);
  });

  it('tolerates missing segments', () => {
    expect(compareSemver('1.0', '1.0.0')).toBe(0);
    expect(compareSemver('2', '1.9.9')).toBe(1);
  });
});

describe('UpdateController (8.3 / 13.5 更新链路)', () => {
  it('check() with no newer version stays NO_UPDATE', async () => {
    const c = new UpdateController(makeApi(), '1.1.0');
    const s = await c.check();
    expect(s.phase).toBe('NO_UPDATE');
  });

  it('check() with newer version transitions to READY', async () => {
    const c = new UpdateController(makeApi(), '1.0.9');
    const s = await c.check();
    expect(s.phase).toBe('READY');
    expect(s.info?.version).toBe('1.1.0');
  });

  it('check() failure → ERROR with old version kept (可回滚)', async () => {
    const c = new UpdateController(
      makeApi({
        checkForUpdate: async () => {
          throw new Error('network');
        },
      }),
      '1.0.9',
    );
    const s = await c.check();
    expect(s.phase).toBe('ERROR');
    expect(s.error).toBe('network');
  });

  it('isForced() only when current < minSupportedVersion (强制更新阈值)', () => {
    const forced: UpdateInfo = { ...info, minSupportedVersion: '1.0.0' };
    expect(new UpdateController(makeApi(), '0.9.9').isForced(forced)).toBe(true);
    expect(new UpdateController(makeApi(), '1.0.0').isForced(forced)).toBe(false);
    expect(new UpdateController(makeApi(), '1.0.0').isForced(info)).toBe(false);
  });

  it('apply() runs download → verify → install (8.3 双验证不可跳过)', async () => {
    const api = makeApi();
    const c = new UpdateController(api, '1.0.9');
    await c.check();
    const s = await c.apply();
    expect(api.download).toHaveBeenCalledOnce();
    expect(api.verify).toHaveBeenCalledOnce();
    expect(api.install).toHaveBeenCalledOnce();
    expect(s.phase).toBe('IDLE');
  });

  it('verify failure aborts install and keeps old version (更新供应链防护)', async () => {
    const api = makeApi({
      verify: async () => {
        throw new Error('sha256 mismatch');
      },
    });
    const c = new UpdateController(api, '1.0.9');
    await c.check();
    const s = await c.apply();
    expect(s.phase).toBe('ERROR');
    expect(s.error).toBe('sha256 mismatch');
    expect(api.install).not.toHaveBeenCalled();
  });

  it('apply() without READY rejects', async () => {
    const api = makeApi();
    const c = new UpdateController(api, '1.0.9');
    const s = await c.apply();
    expect(s.phase).toBe('ERROR');
    expect(api.download).not.toHaveBeenCalled();
  });
});
