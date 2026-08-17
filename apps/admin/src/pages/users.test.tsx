// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UsersPage } from './users.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const summary = {
  userId: 'u1',
  email: 'a@b.c',
  nickname: '测试',
  accountStatus: 'active',
  createdAt: '2026-08-01T00:00:00Z',
  deviceCount: 1,
  online: true,
  lastSeenAt: '2026-08-18T00:00:00Z',
};
const detail = {
  ...summary,
  suspendedAt: null,
  suspendedReason: null,
  chatRequests7d: 5,
  petCount: 1,
  friendCount: 0,
  memoryCount: 2,
};

describe('UsersPage', () => {
  it('lists users from the API', async () => {
    vi.spyOn(await import('../api.js').then((m) => m.adminApi), 'users').mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 50,
      items: [summary],
    });
    await act(async () => {
      render(<UsersPage />);
    });
    expect(screen.getByText('a@b.c')).toBeTruthy();
    expect(screen.getByText('共 1 人（单页最多 50）')).toBeTruthy();
  });

  it('suspend asks for a reason and calls the API', async () => {
    const api = await import('../api.js').then((m) => m.adminApi);
    vi.spyOn(api, 'users').mockResolvedValue({ total: 1, page: 1, pageSize: 50, items: [summary] });
    vi.spyOn(api, 'userDetail').mockResolvedValue(detail);
    vi.spyOn(api, 'userDevices').mockResolvedValue({ items: [] });
    const suspend = vi.spyOn(api, 'suspendUser').mockResolvedValue({ ok: true });
    vi.stubGlobal(
      'prompt',
      vi.fn(() => '测试暂停'),
    );

    await act(async () => {
      render(<UsersPage />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '详情' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '暂停账号' }));
    });

    expect(suspend).toHaveBeenCalledWith('u1', '测试暂停');
    expect(screen.getByRole('status').textContent).toContain('账号已暂停');
  });

  it('restore confirms before calling the API', async () => {
    const api = await import('../api.js').then((m) => m.adminApi);
    vi.spyOn(api, 'users').mockResolvedValue({ total: 1, page: 1, pageSize: 50, items: [summary] });
    vi.spyOn(api, 'userDetail').mockResolvedValue({ ...detail, accountStatus: 'suspended' });
    vi.spyOn(api, 'userDevices').mockResolvedValue({ items: [] });
    const restore = vi.spyOn(api, 'restoreUser').mockResolvedValue({ ok: true });
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );

    await act(async () => {
      render(<UsersPage />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '详情' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '恢复账号' }));
    });

    expect(restore).toHaveBeenCalledWith('u1');
  });
});
