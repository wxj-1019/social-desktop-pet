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

/** 详情抽屉的三个关联数据源默认 mock（不关心内容的用例使用） */
async function mockDetailExtras() {
  const api = await import('../api.js').then((m) => m.adminApi);
  vi.spyOn(api, 'usageForUser').mockResolvedValue({ items: [] });
  vi.spyOn(api, 'chatSummary').mockResolvedValue({ items: [] });
  vi.spyOn(api, 'memoriesSummary').mockResolvedValue({ items: [] });
}

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
    expect(screen.getByText(/共 1 条/)).toBeTruthy();
    // 分页控件存在且上一页禁用（第 1 页）
    expect(screen.getByText('上一页').hasAttribute('disabled')).toBe(true);
  });

  it('discards stale search responses（旧响应晚到不覆盖新结果）', async () => {
    const api = await import('../api.js').then((m) => m.adminApi);
    const stale = {
      total: 1,
      page: 1,
      pageSize: 50,
      items: [{ ...summary, userId: 'old', email: 'stale@b.c' }] as (typeof summary)[],
    };
    const fresh = {
      total: 1,
      page: 1,
      pageSize: 50,
      items: [{ ...summary, userId: 'new', email: 'fresh@b.c' }] as (typeof summary)[],
    };
    // 第一次请求（挂起，模拟慢响应）；输入搜索词触发第二次（立即返回）
    let resolveStale!: (v: typeof stale) => void;
    const stalePromise = new Promise<typeof stale>((r) => {
      resolveStale = r;
    });
    const users = vi
      .spyOn(api, 'users')
      .mockImplementationOnce(() => stalePromise)
      .mockImplementationOnce(() => Promise.resolve(fresh));

    await act(async () => {
      render(<UsersPage />);
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('搜索邮箱 / 昵称 / userId'), {
        target: { value: 'fresh' },
      });
    });
    // 新结果已渲染
    expect(screen.getByText('fresh@b.c')).toBeTruthy();
    expect(screen.queryByText('stale@b.c')).toBeNull();

    // 旧的慢响应此时才返回 → 必须被丢弃
    await act(async () => {
      resolveStale(stale);
    });
    expect(screen.getByText('fresh@b.c')).toBeTruthy();
    expect(screen.queryByText('stale@b.c')).toBeNull();
    expect(users).toHaveBeenCalledTimes(2);
  });

  it('suspend asks for a reason and calls the API', async () => {
    const api = await import('../api.js').then((m) => m.adminApi);
    vi.spyOn(api, 'users').mockResolvedValue({ total: 1, page: 1, pageSize: 50, items: [summary] });
    vi.spyOn(api, 'userDetail').mockResolvedValue(detail);
    vi.spyOn(api, 'userDevices').mockResolvedValue({ items: [] });
    await mockDetailExtras();
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
    await mockDetailExtras();
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

  it('detail drawer loads usage / chat summaries / memory summaries', async () => {
    const api = await import('../api.js').then((m) => m.adminApi);
    vi.spyOn(api, 'users').mockResolvedValue({ total: 1, page: 1, pageSize: 50, items: [summary] });
    vi.spyOn(api, 'userDetail').mockResolvedValue(detail);
    vi.spyOn(api, 'userDevices').mockResolvedValue({ items: [] });
    const usageForUser = vi.spyOn(api, 'usageForUser').mockResolvedValue({
      items: [{ usageDate: '2026-08-18', requests: 3, tokens: 500 }],
    });
    const chatSummary = vi.spyOn(api, 'chatSummary').mockResolvedValue({
      items: [
        { messageId: 'm1', role: 'user', createdAt: '2026-08-18T00:00:00Z', summary: '今天心情…' },
      ],
    });
    const memoriesSummary = vi.spyOn(api, 'memoriesSummary').mockResolvedValue({
      items: [
        {
          memoryId: 'mem1',
          category: 'preference',
          sensitivity: 'low',
          createdAt: '2026-08-18T00:00:00Z',
          summary: '喜欢抹茶…',
        },
      ],
    });

    await act(async () => {
      render(<UsersPage />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '详情' }));
    });

    expect(usageForUser).toHaveBeenCalledWith('u1', expect.any(String), expect.any(String));
    expect(chatSummary).toHaveBeenCalledWith('u1');
    expect(memoriesSummary).toHaveBeenCalledWith('u1');
    // 抽屉渲染三个新数据区
    expect(screen.getByText('近 7 天用量')).toBeTruthy();
    expect(screen.getByText('2026-08-18')).toBeTruthy();
    expect(screen.getByText('最近聊天（脱敏摘要）')).toBeTruthy();
    expect(screen.getByText('今天心情…')).toBeTruthy();
    expect(screen.getByText('记忆摘要（脱敏）')).toBeTruthy();
    expect(screen.getByText('喜欢抹茶…')).toBeTruthy();
  });
});
