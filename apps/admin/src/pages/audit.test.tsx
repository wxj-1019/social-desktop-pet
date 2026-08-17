// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
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
    expect(screen.getByText('暂停账号')).toBeTruthy();
    expect(screen.getByText('测试')).toBeTruthy();
  });
});
