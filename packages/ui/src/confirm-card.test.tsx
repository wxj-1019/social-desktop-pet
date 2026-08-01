// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ConfirmCard } from './confirm-card.js';

describe('ui/ConfirmCard (6.2 记忆确认卡)', () => {
  afterEach(cleanup);

  it('renders the fact with the three actions', () => {
    render(<ConfirmCard fact="你最近正在准备考试。" />);
    expect(screen.getByText(/你最近正在准备考试/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '记住' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '仅本次聊天' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '修改' })).toBeTruthy();
  });

  it('fires onRemember when the primary action is clicked', () => {
    let remembered = false;
    render(<ConfirmCard fact="我喜欢抹茶" onRemember={() => (remembered = true)} />);
    fireEvent.click(screen.getByRole('button', { name: '记住' }));
    expect(remembered).toBe(true);
  });

  it('fires onThisSessionOnly / onEdit for the secondary actions (D-3 分级确认)', () => {
    let sessionOnly = false;
    let edit = false;
    render(
      <ConfirmCard
        fact="x"
        onThisSessionOnly={() => (sessionOnly = true)}
        onEdit={() => (edit = true)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '仅本次聊天' }));
    fireEvent.click(screen.getByRole('button', { name: '修改' }));
    expect(sessionOnly).toBe(true);
    expect(edit).toBe(true);
  });
});
