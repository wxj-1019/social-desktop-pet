// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SaoMenu } from './sao-menu.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SaoMenu · 刀剑神域风格环形轮盘托盘', () => {
  it('isOpen 为 false 时不渲染任何 DOM', () => {
    render(<SaoMenu isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('sao-menu')).toBeNull();
  });

  it('isOpen 为 true 时渲染 SAO 环形主菜单项与关闭按钮', () => {
    render(<SaoMenu isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('sao-menu')).not.toBeNull();
    expect(screen.getByRole('button', { name: '关闭环形托盘' })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /对话/ })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /好友/ })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /角色/ })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /记忆/ })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /模型/ })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: /控制/ })).not.toBeNull();
  });

  it('点击【对话】展开迷你聊天二级菜单（不直接跳面板）', () => {
    render(<SaoMenu isOpen={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('menuitem', { name: /对话/ }));
    // 二级迷你聊天出现，且未关闭主菜单
    expect(screen.getByRole('region', { name: '迷你聊天' })).not.toBeNull();
    expect(screen.getByPlaceholderText('说点什么…')).not.toBeNull();
    expect(screen.getByTestId('sao-menu')).not.toBeNull();
  });

  it('点击【控制】展开二级全息子面板并支持切换勿扰与穿透', () => {
    const onToggleDnd = vi.fn();
    const onTogglePassThrough = vi.fn();
    const onClose = vi.fn();

    render(
      <SaoMenu
        isOpen={true}
        onClose={onClose}
        dnd={false}
        onToggleDnd={onToggleDnd}
        onTogglePassThrough={onTogglePassThrough}
      />,
    );

    // 展开二级面板
    fireEvent.click(screen.getByRole('menuitem', { name: /控制/ }));
    expect(screen.getByText('QUICK CONTROLS')).not.toBeNull();

    // 点击勿扰开关
    const dndButton = screen.getByRole('button', { name: /勿扰/ });
    fireEvent.click(dndButton);
    expect(onToggleDnd).toHaveBeenCalledWith(true);

    // 点击穿透切换（快照驱动开关态：默认关 → 调用开启；切换类操作不关菜单）
    const passButton = screen.getByRole('button', { name: /穿透/ });
    fireEvent.click(passButton);
    expect(onTogglePassThrough).toHaveBeenCalledWith(true);
    expect(screen.getByTestId('sao-menu')).not.toBeNull();
  });

  it('按 Escape 键关闭 SAO 菜单', () => {
    const onClose = vi.fn();
    render(<SaoMenu isOpen={true} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
