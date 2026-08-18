// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MemoryConfirmation } from '@pet/protocol';

import { MemoryConfirmCard } from './memory-confirm-card.js';

const confirmation: MemoryConfirmation = {
  confirmationId: 'c-1',
  category: 'fact',
  value: '我有糖尿病，每天要打胰岛素',
  importance: 7,
  sourceType: 'user_stated',
  sensitivity: 'high',
  sourceTurnIds: ['t-1'],
  createdAt: '2026-08-03T10:00:00.000Z',
};

describe('MemoryConfirmCard（D-3 分级确认 HITL 收口）', () => {
  afterEach(cleanup);

  it('展示敏感内容 + 分类/敏感度标签 + 三个动作', () => {
    render(
      <MemoryConfirmCard confirmation={confirmation} onConfirm={vi.fn()} onReject={vi.fn()} />,
    );
    expect(screen.getByText(/我有糖尿病，每天要打胰岛素/)).toBeTruthy();
    expect(screen.getByText('事实')).toBeTruthy();
    expect(screen.getByText('敏感')).toBeTruthy();
    expect(screen.getByRole('button', { name: '记住' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '仅本次聊天' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '修改' })).toBeTruthy();
  });

  it('"记住"回调不带修改值', () => {
    const onConfirm = vi.fn();
    render(
      <MemoryConfirmCard confirmation={confirmation} onConfirm={onConfirm} onReject={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '记住' }));
    expect(onConfirm).toHaveBeenCalledWith('c-1', undefined);
  });

  it('"仅本次聊天"回调 onReject', () => {
    const onReject = vi.fn();
    render(
      <MemoryConfirmCard confirmation={confirmation} onConfirm={vi.fn()} onReject={onReject} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '仅本次聊天' }));
    expect(onReject).toHaveBeenCalledWith('c-1');
  });

  it('"修改"进入内联编辑，"保存"携带新值；"取消"还原', async () => {
    const onConfirm = vi.fn();
    render(
      <MemoryConfirmCard confirmation={confirmation} onConfirm={onConfirm} onReject={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '修改' }));
    const textarea = screen.getByLabelText('修改记忆内容') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();

    fireEvent.change(textarea, { target: { value: '我有二型糖尿病' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onConfirm).toHaveBeenCalledWith('c-1', '我有二型糖尿病');

    // 保存（async）后回到展示态；等待状态更新后再进编辑
    fireEvent.click(await screen.findByRole('button', { name: '修改' }));
    fireEvent.change(screen.getByLabelText('修改记忆内容'), { target: { value: '被改坏的草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByText(/我有糖尿病，每天要打胰岛素/)).toBeTruthy();
  });
});
