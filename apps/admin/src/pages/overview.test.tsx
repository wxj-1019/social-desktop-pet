// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OverviewPage } from './overview.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('OverviewPage', () => {
  it('renders four stat cards from the API', async () => {
    vi.spyOn(await import('../api.js').then((m) => m.adminApi), 'overview').mockResolvedValue({
      totalUsers: 3,
      onlineDevices: 1,
      chatRequestsToday: 10,
      pendingInvites: 2,
    });
    await act(async () => {
      render(<OverviewPage />);
    });
    expect(screen.getByText('注册用户')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('待处理邀请')).toBeTruthy();
  });
});
