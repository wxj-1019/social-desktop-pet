import { afterEach, describe, expect, it, vi } from 'vitest';

import { clientIpOf } from './auth-rate-limit.js';

function ctx(overrides: { xff?: string; remote?: string } = {}) {
  return {
    req: { header: (name: string) => (name === 'x-forwarded-for' ? overrides.xff : undefined) },
    env: { incoming: { socket: { remoteAddress: overrides.remote } } },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('clientIpOf（可信代理门控）', () => {
  it('默认（未开 PET_TRUST_PROXY）：忽略可伪造的 XFF，用 TCP 对端地址', () => {
    vi.stubEnv('PET_TRUST_PROXY', '');
    expect(clientIpOf(ctx({ xff: '1.2.3.4, 5.6.7.8', remote: '127.0.0.1' }))).toBe('127.0.0.1');
  });

  it('PET_TRUST_PROXY=true：取 XFF 首段（反代覆盖语义）', () => {
    vi.stubEnv('PET_TRUST_PROXY', 'true');
    expect(clientIpOf(ctx({ xff: '1.2.3.4, 5.6.7.8', remote: '127.0.0.1' }))).toBe('1.2.3.4');
    // 无 XFF 时回退对端地址
    expect(clientIpOf(ctx({ remote: '10.0.0.2' }))).toBe('10.0.0.2');
  });

  it('测试上下文（无 env）与 socket 缺失场景安全回退 local', () => {
    vi.stubEnv('PET_TRUST_PROXY', '');
    expect(clientIpOf({ req: { header: () => '9.9.9.9' } })).toBe('local');
    expect(clientIpOf({ req: { header: () => undefined }, env: undefined })).toBe('local');
  });

  it('node-server 双层 env 形态（c.env.server.incoming）同样可读', () => {
    vi.stubEnv('PET_TRUST_PROXY', '');
    const c = {
      req: { header: () => undefined },
      env: { server: { incoming: { socket: { remoteAddress: '192.168.1.5' } } } },
    };
    expect(clientIpOf(c)).toBe('192.168.1.5');
  });
});
