import { describe, expect, it } from 'vitest';

import {
  canSendGift,
  createInviteToken,
  hashToken,
  normalizeFriendshipPair,
  SYNC_PAGE_LIMIT,
} from './business-rules.js';

describe('normalizeFriendshipPair（3.1/9.9 low/high 规范化）', () => {
  it('orders a UUID pair deterministically regardless of input order', () => {
    const a = '11111111-1111-1111-1111-111111111111';
    const b = '22222222-2222-2222-2222-222222222222';
    expect(normalizeFriendshipPair(a, b)).toEqual({ low: a, high: b });
    expect(normalizeFriendshipPair(b, a)).toEqual({ low: a, high: b });
  });
});

describe('createInviteToken（6.3：≥32 随机字节，只存哈希）', () => {
  it('produces URL-safe tokens of at least 32 bytes entropy', () => {
    const { token, tokenHash } = createInviteToken();
    // base64url(32 bytes) = 43 chars
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(tokenHash).toHaveLength(64); // sha256 hex
    expect(hashToken(token)).toBe(tokenHash);
  });

  it('tokens are unique across calls', () => {
    const t1 = createInviteToken().token;
    const t2 = createInviteToken().token;
    expect(t1).not.toBe(t2);
  });
});

describe('canSendGift（9.4 第 3 步：关系/拉黑/配额）', () => {
  const base = { todayCount: 0, dailyLimit: 3, isActiveFriend: true, isBlocked: false };

  it('allows within quota for an active, unblocked friend', () => {
    expect(canSendGift(base)).toEqual({ ok: true });
  });

  it('rejects non-friends and blocked users', () => {
    expect(canSendGift({ ...base, isActiveFriend: false })).toEqual({
      ok: false,
      reason: 'not_friend',
    });
    expect(canSendGift({ ...base, isBlocked: true })).toEqual({ ok: false, reason: 'blocked' });
  });

  it('rejects when daily quota is exhausted (free snack daily limit)', () => {
    expect(canSendGift({ ...base, todayCount: 3 })).toEqual({ ok: false, reason: 'daily_limit' });
  });
});

describe('SYNC_PAGE_LIMIT（9.5 分页上限）', () => {
  it('caps single sync page at 200', () => {
    expect(SYNC_PAGE_LIMIT).toBe(200);
  });
});
