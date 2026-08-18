// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminsPage } from './admins.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const ROWS = [
  {
    id: ADMIN_ID,
    email: 'admin@pet.dev',
    status: 'active' as const,
    lastLoginAt: '2026-08-18T00:00:00Z',
    createdAt: '2026-08-18T00:00:00Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'backup@pet.dev',
    status: 'disabled' as const,
    lastLoginAt: null,
    createdAt: '2026-08-18T01:00:00Z',
  },
];

async function setup() {
  const api = await import('../api.js').then((m) => m.adminApi);
  vi.spyOn(api, 'admins').mockResolvedValue({ items: ROWS });
  vi.spyOn(api, 'me').mockResolvedValue({ admin: { id: ADMIN_ID, email: 'admin@pet.dev' } });
  await act(async () => {
    render(<AdminsPage />);
  });
  return api;
}

describe('AdminsPage', () => {
  it('lists admins with status pills and hides self actions', async () => {
    await setup();
    expect(screen.getByText('admin@pet.dev')).toBeTruthy();
    expect(screen.getByText('backup@pet.dev')).toBeTruthy();
    expect(screen.getByText('我')).toBeTruthy();
    expect(screen.getByText('已停用')).toBeTruthy();
    // 自己不显示操作按钮；被停用的 backup 显示"恢复"
    expect(screen.queryByRole('button', { name: '停用' })).toBeNull();
    expect(screen.getByRole('button', { name: '恢复' })).toBeTruthy();
  });

  it('change password validates length and confirmation', async () => {
    await setup();
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'Old@123456789' } });
    fireEvent.change(screen.getByLabelText('新密码（≥12 位）'), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'short' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '更新密码' }));
    });
    expect(screen.getByRole('alert').textContent).toContain('至少 12 位');

    fireEvent.change(screen.getByLabelText('新密码（≥12 位）'), {
      target: { value: 'NewStrong@123456' },
    });
    fireEvent.change(screen.getByLabelText('确认新密码'), {
      target: { value: 'Different@123456' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '更新密码' }));
    });
    expect(screen.getByRole('alert').textContent).toContain('不一致');
  });

  it('change password submits and shows the re-login notice', async () => {
    const api = await setup();
    const change = vi.spyOn(api, 'changePassword').mockResolvedValue({ ok: true });
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'Old@123456789' } });
    fireEvent.change(screen.getByLabelText('新密码（≥12 位）'), {
      target: { value: 'NewStrong@123456' },
    });
    fireEvent.change(screen.getByLabelText('确认新密码'), {
      target: { value: 'NewStrong@123456' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '更新密码' }));
    });
    expect(change).toHaveBeenCalledWith('Old@123456789', 'NewStrong@123456');
    expect(screen.getByRole('status').textContent).toContain('重新登录');
  });
});
