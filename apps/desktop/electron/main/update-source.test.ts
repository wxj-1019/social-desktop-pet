import { afterEach, describe, expect, it, vi } from 'vitest';

import { createUpdateApi } from './update-source.js';

const manifest = {
  stable: { version: '1.1.0', url: 'https://up.example.com/pet.exe', sha256: 'a'.repeat(64) },
  beta: {
    version: '1.2.0-beta.1',
    url: 'https://up.example.com/pet-beta.exe',
    sha256: 'b'.repeat(64),
  },
};

describe('createUpdateApi（13.1 manifest 检查）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('未配置 URL → 永远无更新（静默跳过）', async () => {
    const api = createUpdateApi(undefined);
    expect(await api.checkForUpdate('stable')).toBeNull();
  });

  it('拉取 manifest 并按通道返回（stable/beta 灰度）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => manifest })),
    );
    const api = createUpdateApi('https://up.example.com/manifest.json');
    const stable = await api.checkForUpdate('stable');
    expect(stable?.version).toBe('1.1.0');
    const beta = await api.checkForUpdate('beta');
    expect(beta?.version).toBe('1.2.0-beta.1');
  });

  it('拉取失败按无更新处理（不自打扰用户）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 })),
    );
    const api = createUpdateApi('https://up.example.com/manifest.json');
    expect(await api.checkForUpdate('stable')).toBeNull();
  });

  it('manifest 缺该通道 → null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ stable: manifest.stable }) })),
    );
    const api = createUpdateApi('https://up.example.com/manifest.json');
    expect(await api.checkForUpdate('beta')).toBeNull();
  });

  it('fetch 拒绝（离线/DNS）→ 静默无更新', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const api = createUpdateApi('https://up.example.com/manifest.json');
    expect(await api.checkForUpdate('stable')).toBeNull();
  });

  it('畸形 JSON → 静默无更新', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new Error('bad json');
        },
      })),
    );
    const api = createUpdateApi('https://up.example.com/manifest.json');
    expect(await api.checkForUpdate('stable')).toBeNull();
  });

  it('manifest 字段非法（version 非字符串）→ zod 拦截，静默无更新', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ stable: { version: 123, url: 'x', sha256: 'y' } }),
      })),
    );
    const api = createUpdateApi('https://up.example.com/manifest.json');
    expect(await api.checkForUpdate('stable')).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('manifest 校验失败'));
    warn.mockRestore();
  });
});
