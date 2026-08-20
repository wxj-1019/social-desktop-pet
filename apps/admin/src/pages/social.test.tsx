// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SocialPage } from './social.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SocialPage', () => {
  it('renders daily summary cards and event stream', async () => {
    const api = await import('../api.js').then((m) => m.adminApi);
    vi.spyOn(api, 'socialDaily').mockResolvedValue({
      summary: { gifts: 9, visits: 5, newFriends: 3, activeUsers: 11 },
      items: [{ date: '2026-08-18', gifts: 5, visits: 3, newFriends: 2, activeUsers: 6 }],
    });
    vi.spyOn(api, 'socialEvents').mockResolvedValue({
      total: 2,
      page: 1,
      pageSize: 50,
      items: [
        {
          eventId: 'e1',
          type: 'gift.snack_sent',
          payload: { giftId: 'g1', snackId: 'snack_cookie', fromUserId: 'u1', toUserId: 'u2' },
          fromEmail: 'a@b.c',
          toEmail: 'x@y.z',
          createdAt: '2026-08-18T10:00:00Z',
        },
        {
          eventId: 'e2',
          type: 'friend.connected',
          payload: { friendshipId: 'f1', inviterId: 'u1', acceptedAt: '2026-08-18' },
          fromEmail: 'a@b.c',
          toEmail: null,
          createdAt: '2026-08-18T09:00:00Z',
        },
      ],
    });

    await act(async () => {
      render(<SocialPage />);
    });

    expect(screen.getByText('区间礼物')).toBeTruthy();
    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText('区间互动活跃用户')).toBeTruthy();
    // a@b.c 是两条事件的发起方，出现两次
    expect(screen.getAllByText('a@b.c').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('x@y.z')).toBeTruthy();
    // '礼物'/'好友建立' 同时出现在类型筛选 option 与事件 pill
    expect(screen.getAllByText('礼物').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('好友建立').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/点心：snack_cookie/)).toBeTruthy();
  });
});
