/**
 * 记忆中心页单测（11.3 v1）—— 列表渲染 / 来源展开 / 修改 / 删除 / 空态 / 待确认队列。
 */
// @vitest-environment jsdom
import type { MemoryListItem } from '@pet/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../lib/api/client.js';

import { MemoriesPage } from './memories.js';

const MEMORY: MemoryListItem = {
  memoryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  category: 'preference',
  value: '我喜欢抹茶',
  importance: 5,
  sensitivity: 'low',
  sourceType: 'user_stated',
  userConfirmed: false,
  sourceTexts: ['我喜欢抹茶', '今天喝什么好'],
  createdAt: '2026-08-03T10:00:00.000Z',
  updatedAt: '2026-08-03T10:00:00.000Z',
};

const PENDING = {
  confirmationId: '99999999-9999-4999-8999-999999999999',
  category: 'fact' as const,
  value: '我有糖尿病',
  importance: 7,
  sourceType: 'user_stated' as const,
  sensitivity: 'high' as const,
  sourceTurnIds: ['11111111-1111-4111-8111-111111111111'],
  createdAt: '2026-08-03T10:00:00.000Z',
};

beforeEach(() => {
  vi.spyOn(api, 'memories').mockResolvedValue([MEMORY]);
  vi.spyOn(api, 'memorySummary').mockResolvedValue({ pending: [], recentlySaved: [] });
  vi.spyOn(api, 'editMemory').mockResolvedValue({ memoryId: 'new-1' });
  vi.spyOn(api, 'invalidateMemory').mockResolvedValue({ ok: true });
  vi.spyOn(api, 'confirmMemory').mockResolvedValue({ memoryId: 'new-1' });
  vi.spyOn(api, 'rejectMemory').mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MemoriesPage（11.3 记忆中心）', () => {
  it('渲染记忆列表：值 + 分类标签 + 计数标题', async () => {
    render(<MemoriesPage />);
    expect(await screen.findByText('我喜欢抹茶')).not.toBeNull();
    expect(screen.getByText('偏好')).not.toBeNull();
    expect(screen.getByText(/星屿记住的1件小事/)).not.toBeNull();
  });

  it('「来源」展开显示 source_turn 原文（查看来源）', async () => {
    render(<MemoriesPage />);
    await screen.findByText('我喜欢抹茶');

    fireEvent.click(screen.getByRole('button', { name: '来源' }));
    expect(await screen.findByText('「我喜欢抹茶」')).not.toBeNull();
    expect(screen.getByText('「今天喝什么好」')).not.toBeNull();
  });

  it('「修改」内联编辑 → 保存调用 api.editMemory（10.5 纠正链）', async () => {
    render(<MemoriesPage />);
    await screen.findByText('我喜欢抹茶');

    fireEvent.click(screen.getByRole('button', { name: '修改' }));
    const textarea = screen.getByLabelText('修改记忆内容') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '我喜欢焙茶' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await vi.waitFor(() =>
      expect(api.editMemory).toHaveBeenCalledWith(MEMORY.memoryId, '我喜欢焙茶'),
    );
  });

  it('「删除」调用 api.invalidateMemory（置失效不物理删除）', async () => {
    render(<MemoriesPage />);
    await screen.findByText('我喜欢抹茶');

    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await vi.waitFor(() => expect(api.invalidateMemory).toHaveBeenCalledWith(MEMORY.memoryId));
  });

  it('空态：还没有记忆', async () => {
    vi.mocked(api.memories).mockResolvedValueOnce([]);
    render(<MemoriesPage />);
    expect(await screen.findByText('还没有记忆')).not.toBeNull();
  });

  it('待确认队列复用 MemoryConfirmCard（D-3 存量确认）', async () => {
    vi.mocked(api.memorySummary).mockResolvedValueOnce({ pending: [PENDING], recentlySaved: [] });
    render(<MemoriesPage />);
    expect(await screen.findByText('我有糖尿病')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '记住', exact: true }));
    await vi.waitFor(() =>
      expect(api.confirmMemory).toHaveBeenCalledWith(PENDING.confirmationId, undefined),
    );
  });
});
