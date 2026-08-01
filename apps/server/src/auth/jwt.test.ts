import { describe, expect, it } from 'vitest';

import { JwtService } from './jwt.js';

describe('JwtService（自建 Auth，9.8 短 TTL access token）', () => {
  it('signs and verifies a token round-trip', async () => {
    const jwt = new JwtService({ secret: 'test-secret' });
    const token = await jwt.sign({ sub: 'user-1', deviceId: 'dev-1' });
    const payload = await jwt.verify(token);
    expect(payload).toEqual({ sub: 'user-1', deviceId: 'dev-1' });
  });

  it('rejects tampered tokens', async () => {
    const jwt = new JwtService({ secret: 'test-secret' });
    const token = await jwt.sign({ sub: 'user-1', deviceId: 'dev-1' });
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    await expect(jwt.verify(tampered)).rejects.toThrow();
  });

  it('rejects tokens signed with a different secret', async () => {
    const a = new JwtService({ secret: 'secret-a' });
    const b = new JwtService({ secret: 'secret-b' });
    const token = await a.sign({ sub: 'user-1', deviceId: 'dev-1' });
    await expect(b.verify(token)).rejects.toThrow();
  });

  it('expires per short TTL (9.8 建议 15 分钟)', async () => {
    const jwt = new JwtService({ secret: 'test-secret', accessTtlMin: 15 });
    // 现在签发的 token 有效
    const token = await jwt.sign({ sub: 'user-1', deviceId: 'dev-1' });
    await expect(jwt.verify(token)).resolves.toBeTruthy();
    // 16 分钟前签发 → 已过期
    const expired = await jwt.sign({ sub: 'user-1', deviceId: 'dev-1' }, Date.now() - 16 * 60_000);
    await expect(jwt.verify(expired)).rejects.toThrow();
  });

  it('rejects token missing deviceId', async () => {
    const jwt = new JwtService({ secret: 'test-secret' });
    // 用无 deviceId 的原始 JWT 手工构造（jose 最小荷载）
    const { SignJWT } = await import('jose');
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .sign(new TextEncoder().encode('test-secret'));
    await expect(jwt.verify(token)).rejects.toThrow('deviceId');
  });
});
