// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SensitivePage } from './sensitive.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SensitivePage', () => {
  it('requests a grant, reads content once and shows the notice', async () => {
    const api = await import('../api.js').then((m) => m.adminApi);
    const create = vi.spyOn(api, 'createSensitiveAccess').mockResolvedValue({
      grantId: 'g1',
      token: 't1',
      expiresAt: '2026-08-18T00:05:00Z',
    });
    const content = vi.spyOn(api, 'sensitiveContent').mockResolvedValue({
      resourceType: 'chat',
      items: [
        {
          messageId: 'm1',
          role: 'user',
          content: '完整原文',
          createdAt: '2026-08-18T00:00:00Z',
        },
      ],
    });

    await act(async () => {
      render(<SensitivePage />);
    });
    fireEvent.change(screen.getByLabelText('用户 userId'), {
      target: { value: 'u1' },
    });
    fireEvent.change(screen.getByLabelText('查看理由（≥5 字，写入审计）'), {
      target: { value: '用户投诉核查' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '申请授权并查看' }));
    });

    expect(create).toHaveBeenCalledWith({
      targetUserId: 'u1',
      resourceType: 'chat',
      reason: '用户投诉核查',
      scope: {},
    });
    expect(content).toHaveBeenCalledWith('g1', 't1');
    expect(screen.getByText('完整原文')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('本次授权已失效');
  });

  it('shows errors when the grant fails', async () => {
    vi.spyOn(
      await import('../api.js').then((m) => m.adminApi),
      'createSensitiveAccess',
    ).mockRejectedValue(new Error('grant_used_or_expired'));
    await act(async () => {
      render(<SensitivePage />);
    });
    fireEvent.change(screen.getByLabelText('用户 userId'), {
      target: { value: 'u1' },
    });
    fireEvent.change(screen.getByLabelText('查看理由（≥5 字，写入审计）'), {
      target: { value: '用户投诉核查' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '申请授权并查看' }));
    });
    expect(screen.getByRole('alert').textContent).toContain('grant_used_or_expired');
  });
});
