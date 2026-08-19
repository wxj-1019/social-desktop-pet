// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WaitlistPage } from './waitlist.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const row = {
  id: 'w1',
  email: 'a@b.c',
  status: 'pending',
  createdAt: '2026-08-01T00:00:00Z',
  invitedAt: null,
  inviteExpiresAt: null,
  claimedAt: null,
  inviteMailStatus: 'pending',
  inviteMailAt: null,
};

describe('WaitlistPage', () => {
  it('renders waitlist rows and invites with the returned code', async () => {
    const api = await import('../api.js').then((m) => m.adminApi);
    vi.spyOn(api, 'waitlist').mockResolvedValue({ total: 1, page: 1, pageSize: 50, items: [row] });
    vi.spyOn(api, 'inviteWaitlist').mockResolvedValue({ ok: true, code: 'ABCD1234' });

    await act(async () => {
      render(<WaitlistPage />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '发放邀请' }));
    });

    expect(screen.getByRole('status').textContent).toContain('ABCD1234');
  });

  it('searches by email and resets to page 1', async () => {
    const api = await import('../api.js').then((m) => m.adminApi);
    const waitlist = vi
      .spyOn(api, 'waitlist')
      .mockResolvedValue({ total: 0, page: 1, pageSize: 50, items: [] });

    await act(async () => {
      render(<WaitlistPage />);
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('搜索邮箱'), {
        target: { value: 'a@b' },
      });
    });

    const lastCall = waitlist.mock.calls.at(-1)?.[0] as Record<string, string>;
    expect(lastCall).toMatchObject({ page: '1', q: 'a@b' });
  });
});
