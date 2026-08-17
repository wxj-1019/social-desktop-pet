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

describe('admin token', () => {
  const jwt = new JwtService({ secret: 'admin-test-secret-admin-test-secret' });

  it('signAdmin/verifyAdmin round-trips admin id', async () => {
    const token = await jwt.signAdmin('admin-1');
    const payload = await jwt.verifyAdmin(token);
    expect(payload).toEqual({ sub: 'admin-1', role: 'admin' });
  });

  it('verifyAdmin rejects a regular user token (no admin role)', async () => {
    const userToken = await jwt.sign({ sub: 'u1', deviceId: 'dev-1' });
    await expect(jwt.verifyAdmin(userToken)).rejects.toThrow();
  });

  it('verifyAdmin rejects expired admin token', async () => {
    const token = await jwt.signAdmin('admin-1', Date.now() - 16 * 60_000);
    await expect(jwt.verifyAdmin(token)).rejects.toThrow();
  });
});
