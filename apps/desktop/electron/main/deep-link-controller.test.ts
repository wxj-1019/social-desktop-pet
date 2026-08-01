import { describe, expect, it, vi } from 'vitest';

import {
  DeepLinkController,
  parseInviteUrl,
  b64urlEncode,
  type DeepLinkContext,
  type InvitePayload,
  type PendingStore,
} from './deep-link-controller.js';

function makeInviteUrl(userId: string, inviteCode: string): string {
  return `pet://invite?token=${b64urlEncode(userId)}.${b64urlEncode(inviteCode)}`;
}

function makeContext(overrides?: Partial<DeepLinkContext>): DeepLinkContext {
  return {
    isSignedIn: () => false,
    applyInvite: vi.fn(async () => undefined),
    requestSignIn: vi.fn(async () => undefined),
    ...overrides,
  };
}

class MemoryPendingStore implements PendingStore {
  private value: InvitePayload | null = null;
  load(): InvitePayload | null {
    return this.value;
  }
  save(payload: InvitePayload): void {
    this.value = payload;
  }
  clear(): void {
    this.value = null;
  }
}

describe('DeepLinkController (6.3 邀请链接)', () => {
  it('parses a valid pet://invite URL (b64url user + code)', () => {
    const raw = makeInviteUrl('user-123', 'SNACK2026');
    const parsed = parseInviteUrl(raw);
    expect(parsed).toEqual({
      userId: 'user-123',
      inviteCode: 'SNACK2026',
      rawToken: expect.any(String),
    });
  });

  it('rejects non-pet protocols', () => {
    expect(parseInviteUrl('https://example.com/invite?token=abc.def')).toBeNull();
  });

  it('rejects wrong host / missing token / malformed base64', () => {
    expect(parseInviteUrl('pet://other?token=a.b')).toBeNull();
    expect(parseInviteUrl('pet://invite')).toBeNull();
    expect(parseInviteUrl('pet://invite?token=!!!')).toBeNull();
    expect(parseInviteUrl('pet://invite?token=a.b.c')).toBeNull(); // 必须恰好两段
  });

  it('when signed in, applies invite immediately and clears pending', async () => {
    const ctx = makeContext({ isSignedIn: () => true });
    const c = new DeepLinkController(ctx, null);
    const result = await c.handle(makeInviteUrl('u1', 'CODE1'));
    expect(result).toBe('applied');
    expect(ctx.applyInvite).toHaveBeenCalledOnce();
    expect(c.pendingInvite).toBeNull();
  });

  it('when signed out, stores pending and requests sign-in', async () => {
    const ctx = makeContext({ isSignedIn: () => false });
    const c = new DeepLinkController(ctx, null);
    const result = await c.handle(makeInviteUrl('u1', 'CODE1'));
    expect(result).toBe('pending');
    expect(ctx.requestSignIn).toHaveBeenCalledOnce();
    expect(c.pendingInvite).not.toBeNull();
  });

  it('restorePending() applies invite after login completes (6.3)', async () => {
    const ctx = makeContext({ isSignedIn: () => false });
    const c = new DeepLinkController(ctx, null);
    await c.handle(makeInviteUrl('u1', 'CODE1'));
    // 模拟登录完成 → 恢复邀请
    const applied = await c.restorePending();
    expect(applied).toBe(true);
    expect(ctx.applyInvite).toHaveBeenCalledOnce();
    expect(c.pendingInvite).toBeNull();
  });

  it('restorePending() without pending does nothing', async () => {
    const ctx = makeContext();
    const c = new DeepLinkController(ctx, null);
    expect(await c.restorePending()).toBe(false);
    expect(ctx.applyInvite).not.toHaveBeenCalled();
  });

  it('persists pending across restarts when a store is provided', async () => {
    const store = new MemoryPendingStore();
    const ctx = makeContext({ isSignedIn: () => false });
    const c1 = new DeepLinkController(ctx, store);
    await c1.handle(makeInviteUrl('u1', 'CODE1'));
    expect(store.load()).not.toBeNull();
    // 模拟重启：新实例从 store 恢复
    const ctx2 = makeContext({ isSignedIn: () => true });
    const c2 = new DeepLinkController(ctx2, store);
    expect(c2.pendingInvite).not.toBeNull();
    expect(await c2.restorePending()).toBe(true);
    expect(store.load()).toBeNull();
  });

  it('treats malformed links as invalid without side effects', async () => {
    const ctx = makeContext();
    const c = new DeepLinkController(ctx, null);
    expect(await c.handle('not-a-url')).toBe('invalid');
    expect(ctx.requestSignIn).not.toHaveBeenCalled();
    expect(c.pendingInvite).toBeNull();
  });
});
