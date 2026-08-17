/**
 * OtpService 逻辑测试 —— 13.2（生成/校验/消费/尝试上限/过期/冷却/pending 上限）。
 * store 用内存 fake（OtpCodeStore 接口注入，逻辑保持纯）。
 */
import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { MailProvider } from '../lib/mail.js';

import { OtpService, type OtpCodeRow, type OtpCodeStore } from './otp.js';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** 内存 fake store：记录调用，行为可定制 */
function makeStore() {
  const rows = new Map<string, OtpCodeRow>(); // email -> latest
  let seq = 0;
  const store: OtpCodeStore = {
    create: vi.fn(async (email, codeHash, expiresAt) => {
      rows.set(email, {
        otpId: `otp-${++seq}`,
        codeHash,
        attempts: 0,
        expiresAt,
        consumedAt: null,
      });
    }),
    findLatest: vi.fn(async (email) => rows.get(email) ?? null),
    countPending: vi.fn(async () => 0),
    incrementAttempts: vi.fn(async (otpId) => {
      for (const row of rows.values()) {
        if (row.otpId === otpId) row.attempts += 1;
      }
    }),
    consumeIfUnused: vi.fn(async (otpId) => {
      for (const row of rows.values()) {
        if (row.otpId === otpId && row.consumedAt === null) {
          row.consumedAt = new Date();
          return true;
        }
      }
      return false;
    }),
    cleanup: vi.fn(async () => undefined),
  };
  return { store, rows };
}

const MAIL: MailProvider = {
  send: vi.fn(async () => undefined),
};

describe('OtpService.request', () => {
  it('生成 6 位码 + sha256 落库 + 邮件发送；dev 模式返回 devCode', async () => {
    const { store, rows } = makeStore();
    const service = new OtpService(store, MAIL, { devCodeInResponse: true });

    const result = await service.request('a@b.com');

    expect(result.status).toBe('sent');
    const devCode = result.status === 'sent' ? result.devCode : undefined;
    expect(devCode).toMatch(/^\d{6}$/);
    const row = rows.get('a@b.com');
    expect(row?.codeHash).toBe(sha256(devCode ?? ''));
    expect(MAIL.send).toHaveBeenCalledWith('a@b.com', expect.any(String), expect.any(String));
    expect(MAIL.send).toHaveBeenCalledTimes(1);
  });

  it('dev 模式关闭 → 不返回 devCode（生产安全）', async () => {
    const { store } = makeStore();
    const service = new OtpService(store, MAIL);
    const result = await service.request('a@b.com');
    expect(result.status).toBe('sent');
    if (result.status === 'sent') expect(result.devCode).toBeUndefined();
  });

  it('冷却指数退避：第 2 次发送后冷却 = base×2；verify 成功后归零', async () => {
    const { store } = makeStore();
    const service = new OtpService(store, undefined, {
      resendCooldownMs: 1000,
      devCodeInResponse: true,
    });
    const first = await service.request('a@b.com');
    expect(first.status).toBe('sent');
    const code = first.status === 'sent' ? (first.devCode ?? '') : '';

    // 第 2 次请求：冷却 = base×2^1 = 2000ms（防 60s 轮换刷码）
    const second = await service.request('a@b.com');
    expect(second.status).toBe('cooldown');
    if (second.status === 'cooldown') {
      expect(second.retryAfterSec).toBeGreaterThanOrEqual(1);
      expect(second.retryAfterSec).toBeLessThanOrEqual(3);
    }

    // verify 成功 → 冷却计数归零（已消费行不再触发冷却，直接放行）
    expect(await service.verify('a@b.com', code)).toEqual({ ok: true });
    const afterVerify = await service.request('a@b.com');
    expect(afterVerify.status).toBe('sent');
    // 冷却判定基于最新一条的 created_at（由 expiresAt - ttl 反推）
  });

  it('pending 上限：countPending ≥ max → too_many_pending', async () => {
    const { store } = makeStore();
    store.countPending = vi.fn(async () => 5);
    const service = new OtpService(store);
    expect((await service.request('a@b.com')).status).toBe('too_many_pending');
  });
});

describe('OtpService.verify', () => {
  async function setupVerified(dev = true) {
    const { store, rows } = makeStore();
    const service = new OtpService(store, MAIL, { devCodeInResponse: dev });
    const result = await service.request('a@b.com');
    const code = result.status === 'sent' ? result.devCode : undefined;
    return { service, rows, code: code ?? '' };
  }

  it('正确 code → ok 且消费（复用同 code 再验失败）', async () => {
    const { service, code } = await setupVerified();
    expect(await service.verify('a@b.com', code)).toEqual({ ok: true });
    expect(await service.verify('a@b.com', code)).toEqual({ ok: false, reason: 'no_code' });
  });

  it('错误 code → invalid 且 attempts+1；5 次后 attempts_exceeded', async () => {
    const { service, rows, code } = await setupVerified();
    for (let i = 0; i < 4; i++) {
      expect(await service.verify('a@b.com', '000000')).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(rows.get('a@b.com')?.attempts).toBe(4);
    // 第 5 次错误：attempts 到达上限前最后一次仍按 invalid（attempts<5 时判断）
    expect(await service.verify('a@b.com', '000000')).toEqual({ ok: false, reason: 'invalid' });
    // 第 6 次：attempts ≥5 → attempts_exceeded（即使 code 正确）
    expect(await service.verify('a@b.com', code)).toEqual({
      ok: false,
      reason: 'attempts_exceeded',
    });
  });

  it('过期 → expired（TTL 之后即使 code 正确）', async () => {
    const { service, rows, code } = await setupVerified();
    const row = rows.get('a@b.com');
    if (row) row.expiresAt = new Date(Date.now() - 1000);
    expect(await service.verify('a@b.com', code)).toEqual({ ok: false, reason: 'expired' });
  });

  it('无码/已消费 → no_code', async () => {
    const { service, code } = await setupVerified();
    expect(await service.verify('nobody@b.com', code)).toEqual({ ok: false, reason: 'no_code' });
  });
});
