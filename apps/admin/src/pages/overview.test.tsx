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
      totalDevices: 5,
      chatRequestsToday: 10,
      chatRequests7d: 42,
      signups7d: 2,
      suspendedUsers: 1,
      pendingInvites: 2,
    });
    await act(async () => {
      render(<OverviewPage />);
    });
    expect(screen.getByText('注册用户')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('待处理邀请')).toBeTruthy();
    expect(screen.getByText('已暂停账号')).toBeTruthy();
    expect(screen.getByText('近 7 天聊天请求')).toBeTruthy();
  });
});
