// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, type Friend } from '../lib/api/client.js';

import { FriendsPage } from './friends.js';

const FRIEND: Friend = {
  userId: 'friend-1',
  nickname: '小莓',
  avatar: null,
  friendshipId: 'friendship-1',
  acceptedAt: '2026-08-03T10:00:00.000Z',
};

function installFakePet(): void {
  (window as unknown as { pet: unknown }).pet = {
    onDeepLink: vi.fn(() => vi.fn()),
    consumeDeepLinkPayload: vi.fn().mockResolvedValue(null),
  };
}

beforeEach(() => {
  installFakePet();
  vi.spyOn(api, 'friends').mockResolvedValue([]);
  vi.spyOn(api, 'sync').mockResolvedValue({ events: [], nextInboxSeq: 0, hasMore: false });
  vi.spyOn(api, 'createInvite').mockResolvedValue({
    inviteId: 'invite-1',
    token: 'token-for-friend',
    expiresAt: '2026-08-04T10:00:00.000Z',
  });
  vi.spyOn(api, 'sendGift').mockResolvedValue({
    giftId: 'gift-1',
    eventId: 'event-1',
    inboxSeq: 1,
  });
  vi.spyOn(api, 'sendVisit').mockResolvedValue({ visitId: 'visit-1', eventId: 'event-2' });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as unknown as { pet?: unknown }).pet;
});

describe('FriendsPage · marshmallow social surface', () => {
  it('shows a friendly empty state and supports invite copy feedback', async () => {
    render(<FriendsPage userId="user-1" />);

    expect((await screen.findByText('小圈子还空着')).textContent).toContain('小圈子还空着');
    fireEvent.click(screen.getByRole('button', { name: '邀请好友' }));

    expect(await screen.findByText('专属邀请链接')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '复制邀请链接' }));
    expect(await screen.findByText('已复制')).not.toBeNull();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'pet://invite?token=token-for-friend',
    );
  });

  it('keeps snack and visit actions available on a friend card', async () => {
    vi.mocked(api.friends).mockResolvedValue([FRIEND]);
    render(<FriendsPage userId="user-1" />);
    await screen.findByText('小莓');

    fireEvent.click(screen.getByRole('button', { name: '送点心给 小莓' }));
    await act(async () => {});
    expect(api.sendGift).toHaveBeenCalledWith('friend-1', 'snack_cookie', expect.any(String));

    fireEvent.click(screen.getByRole('button', { name: '拜访 小莓' }));
    await act(async () => {});
    expect(api.sendVisit).toHaveBeenCalledWith('friend-1', 'wave');
  });
});
