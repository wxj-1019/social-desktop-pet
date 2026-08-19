// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SaoMenu } from './sao-menu.js';

/** 菜单几何恒用 240×260 基准（展开期间窗口由 Main 扩到 ≥ 基准）：stub 窗口
 *  尺寸不应影响几何 —— 保留 stub 用于回归"按窗口压缩几何"的旧缺陷 */
function stubWindowSize(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h });
}

beforeEach(() => {
  stubWindowSize(240, 260);
});

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

  it('二级面板右缘不越出 240px 设计窗口（controls 最易溢出节点被钳制）', () => {
    render(<SaoMenu isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /控制/ }));

    const panel = document.querySelector('.sao-radial-sub--right') as HTMLElement | null;
    expect(panel).not.toBeNull();
    const left = Number.parseFloat(panel!.style.left);
    const width = Number.parseFloat(panel!.style.width);
    // 无钳制时 controls 面板右缘 ≈253 > 240；现在被钳到右缘 8px 边距内
    expect(left + width).toBeLessThanOrEqual(240);
    expect(left + width).toBe(232);
  });

  it('空间充足的节点（好友）保持未钳制的理想弹出位置', () => {
    render(<SaoMenu isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /好友/ }));

    const panel = document.querySelector('.sao-radial-sub--right') as HTMLElement | null;
    expect(panel).not.toBeNull();
    const left = Number.parseFloat(panel!.style.left);
    const width = Number.parseFloat(panel!.style.width);
    expect(left + width).toBeLessThanOrEqual(240);
    // 好友节点 x≈27 → 理想 left≈51，无需钳制
    expect(left).toBeCloseTo(51.1, 0);
  });

  it('小窗（0.5 档 120×130）下几何不压缩：节点仍用 240×260 基准坐标（截断回归）', () => {
    // 缺陷场景：桌宠大小档位 <100% 时窗口装不下菜单，旧实现按窗口压缩几何
    // → 菜单挤成一团/出窗被截断。修复后几何恒为基准（窗口由 Main 临时扩到 ≥ 基准）。
    stubWindowSize(120, 130);
    render(<SaoMenu isOpen={true} onClose={vi.fn()} />);

    // 控制节点（-54° 弧底，最后一个槽位）：基准坐标 x≈61.3/y≈231.8
    // → 槽位 left = 61.3-14 ≈ 47、top = 231.8-14 ≈ 218（而非压缩进 120×130）
    const slots = Array.from(document.querySelectorAll<HTMLElement>('.sao-left-slot'));
    expect(slots.length).toBe(6);
    const last = slots[5]!;
    expect(Number.parseFloat(last.style.left)).toBeGreaterThan(40);
    expect(Number.parseFloat(last.style.top)).toBeGreaterThan(200);

    // 弧线 viewBox 仍是基准 240×260（不随窗口缩放）
    const svg = document.querySelector('.sao-left-track-svg') as SVGSVGElement | null;
    expect(svg?.getAttribute('viewBox')).toBe('0 0 240 260');
  });
});
