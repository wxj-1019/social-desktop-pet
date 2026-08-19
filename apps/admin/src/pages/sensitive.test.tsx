// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SensitivePage } from './sensitive.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** 两段式工作流的公共前置：填 userId → 加载脱敏摘要（解锁"申请授权并查看"按钮） */
async function loadSummaries() {
  fireEvent.change(screen.getByLabelText('用户 userId'), {
    target: { value: 'u1' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '加载脱敏摘要' }));
  });
  const api = await import('../api.js');
  // 未填日期筛选时传入空 from/to（api.ts 内部会省略空参数）
  expect(api.adminApi.chatSummary).toHaveBeenCalledWith('u1', {
    from: undefined,
    to: undefined,
  });
}

describe('SensitivePage', () => {
  it('loads masked summaries first（默认脱敏，短文不整段透出）', async () => {
    const api = await import('../api.js').then((m) => m.adminApi);
    vi.spyOn(api, 'chatSummary').mockResolvedValue({
      items: [
        {
          messageId: 'm1',
          role: 'user',
          createdAt: '2026-08-18T00:00:00Z',
          summary: '今天心情不太好…',
        },
      ],
    });

    await act(async () => {
      render(<SensitivePage />);
    });
    // 未加载摘要前，原文授权按钮保持禁用（先看摘要再看原文的工作流）
    expect(screen.getByRole('button', { name: '申请授权并查看' }).hasAttribute('disabled')).toBe(
      true,
    );
    fireEvent.change(screen.getByLabelText('用户 userId'), { target: { value: 'u1' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '加载脱敏摘要' }));
    });

    expect(screen.getByText('聊天摘要（脱敏，最近 50 条）')).toBeTruthy();
    expect(screen.getByText('今天心情不太好…')).toBeTruthy();
    // 摘要已加载 → 解锁原文授权
    expect(screen.getByRole('button', { name: '申请授权并查看' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('requests a grant after loading summaries, reads content once and shows the notice', async () => {
    const api = await import('../api.js').then((m) => m.adminApi);
    vi.spyOn(api, 'chatSummary').mockResolvedValue({ items: [] });
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
    await loadSummaries();
    expect(screen.getByRole('button', { name: '申请授权并查看' }).hasAttribute('disabled')).toBe(
      false,
    );
    fireEvent.change(screen.getByLabelText('查看理由（≥5 字，写入审计）'), {
      target: { value: '用户投诉核查' },
    });
    fireEvent.change(screen.getByLabelText('起始日期'), {
      target: { value: '2026-08-01' },
    });
    fireEvent.change(screen.getByLabelText('截止日期'), {
      target: { value: '2026-08-02' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '申请授权并查看' }));
    });

    expect(create).toHaveBeenCalledWith({
      targetUserId: 'u1',
      resourceType: 'chat',
      reason: '用户投诉核查',
      scope: { from: '2026-08-01', to: '2026-08-02' },
    });
    expect(content).toHaveBeenCalledWith('g1', 't1');
    expect(screen.getByText('完整原文')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('本次授权已失效');
  });

  it('shows errors when the grant fails', async () => {
    const api = await import('../api.js').then((m) => m.adminApi);
    vi.spyOn(api, 'chatSummary').mockResolvedValue({ items: [] });
    vi.spyOn(api, 'createSensitiveAccess').mockRejectedValue(new Error('grant_used_or_expired'));
    await act(async () => {
      render(<SensitivePage />);
    });
    await loadSummaries();
    fireEvent.change(screen.getByLabelText('查看理由（≥5 字，写入审计）'), {
      target: { value: '用户投诉核查' },
    });
    fireEvent.change(screen.getByLabelText('起始日期'), {
      target: { value: '2026-08-01' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '申请授权并查看' }));
    });
    expect(screen.getByRole('alert').textContent).toContain('grant_used_or_expired');
  });

  it('memories summaries render category/sensitivity columns', async () => {
    const api = await import('../api.js').then((m) => m.adminApi);
    vi.spyOn(api, 'memoriesSummary').mockResolvedValue({
      items: [
        {
          memoryId: 'mem1',
          category: 'preference',
          sensitivity: 'low',
          createdAt: '2026-08-18T00:00:00Z',
          summary: '喜欢抹茶拿铁，加双…',
        },
      ],
    });

    await act(async () => {
      render(<SensitivePage />);
    });
    fireEvent.change(screen.getByLabelText('用户 userId'), { target: { value: 'u1' } });
    fireEvent.change(screen.getByLabelText('资源类型'), {
      target: { value: 'private_memory' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '加载脱敏摘要' }));
    });

    expect(screen.getByText('记忆摘要（脱敏，最近 50 条）')).toBeTruthy();
    expect(screen.getByText('preference')).toBeTruthy();
    expect(screen.getByText('low')).toBeTruthy();
  });
});
