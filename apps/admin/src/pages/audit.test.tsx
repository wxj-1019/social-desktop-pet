// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuditPage } from './audit.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AuditPage', () => {
  it('renders audit rows with action labels', async () => {
    vi.spyOn(await import('../api.js').then((m) => m.adminApi), 'auditLog').mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 100,
      items: [
        {
          id: 'e1',
          adminId: 'a1',
          action: 'user.suspend',
          resourceType: 'user',
          resourceId: 'u1',
          reason: '测试',
          ip: '127.0.0.1',
          createdAt: '2026-08-18T00:00:00Z',
        },
      ],
    });
    await act(async () => {
      render(<AuditPage />);
    });
    expect(screen.getByRole('cell', { name: '暂停账号' })).toBeTruthy();
    expect(screen.getByText('测试')).toBeTruthy();
  });

  it('filters by action/resourceType and resets to page 1', async () => {
    const api = await import('../api.js').then((m) => m.adminApi);
    const auditLog = vi
      .spyOn(api, 'auditLog')
      .mockResolvedValue({ total: 0, page: 1, pageSize: 100, items: [] });

    await act(async () => {
      render(<AuditPage />);
    });
    expect(auditLog).toHaveBeenLastCalledWith({ page: '1', pageSize: '100' });

    await act(async () => {
      fireEvent.change(screen.getByLabelText('动作筛选'), {
        target: { value: 'sensitive.read' },
      });
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('资源类型筛选'), {
        target: { value: 'chat' },
      });
    });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('起始日期'), {
        target: { value: '2026-08-01' },
      });
    });

    const lastCall = auditLog.mock.calls.at(-1)?.[0] as Record<string, string>;
    expect(lastCall).toMatchObject({
      page: '1',
      action: 'sensitive.read',
      resourceType: 'chat',
      from: '2026-08-01',
    });
  });
});
