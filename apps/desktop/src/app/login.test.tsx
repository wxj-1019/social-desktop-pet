// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginPage, type AuthResult } from './login.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as unknown as { pet?: unknown }).pet;
});

beforeEach(() => {
  (window as unknown as { pet: unknown }).pet = {
    session: {
      login: vi.fn().mockResolvedValue({
        accessToken: 'access-token',
        profile: { userId: 'user-1', nickname: '小星' },
      }),
      register: vi.fn().mockResolvedValue({
        accessToken: 'access-token',
        profile: { userId: 'user-1', nickname: '小星' },
      }),
    },
  };
});

describe('LoginPage · marshmallow onboarding', () => {
  it('renders labeled fields and invitation guidance', () => {
    render(<LoginPage onAuthed={vi.fn()} pendingInvite />);

    expect(screen.getByRole('heading', { name: '欢迎回来' })).not.toBeNull();
    expect(screen.getByLabelText('邮箱')).not.toBeNull();
    expect(screen.getByLabelText('密码')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toContain('好友正在等你');
  });

  it('switches to registration and exposes the optional nickname field', () => {
    render(<LoginPage onAuthed={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '注册' }));

    expect(screen.getByRole('heading', { name: '认识一下吧' })).not.toBeNull();
    expect(screen.getByLabelText(/昵称/)).not.toBeNull();
  });

  it('announces validation errors before submitting', async () => {
    render(<LoginPage onAuthed={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'wrong' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'short' } });
    fireEvent.submit(screen.getByRole('button', { name: '登录并去找星屿' }).closest('form')!);

    expect((await screen.findByRole('alert')).textContent).toContain('密码至少需要 8 位');
    expect(
      (window as unknown as { pet: { session: { login: ReturnType<typeof vi.fn> } } }).pet.session
        .login,
    ).not.toHaveBeenCalled();
  });

  it('submits the active auth mode and returns the profile', async () => {
    const onAuthed = vi.fn<(result: AuthResult) => void>();
    render(<LoginPage onAuthed={onAuthed} />);

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'star@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: '登录并去找星屿' }));
    await act(async () => {});

    const login = (window as unknown as { pet: { session: { login: ReturnType<typeof vi.fn> } } })
      .pet.session.login;
    expect(login).toHaveBeenCalledWith({
      email: 'star@example.com',
      password: 'password123',
      deviceId: expect.any(String),
    });
    expect(onAuthed.mock.calls[0]?.[0]).toEqual({ userId: 'user-1', nickname: '小星' });
  });
});
