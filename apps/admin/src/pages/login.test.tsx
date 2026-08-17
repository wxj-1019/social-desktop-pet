// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setAccessToken } from '../api.js';

import { LoginPage } from './login.js';

afterEach(() => {
  cleanup();
  setAccessToken(null);
  vi.restoreAllMocks();
});

describe('LoginPage', () => {
  it('renders email/password and submits to login', async () => {
    const onAuthed = vi.fn();
    const login = vi.spyOn(await import('../api.js').then((m) => m.adminApi), 'login');
    login.mockResolvedValue({ accessToken: 't1', admin: { id: 'a1', email: 'admin@pet.dev' } });

    render(<LoginPage onAuthed={onAuthed} />);
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'admin@pet.dev' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'Admin@123456' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '登录' }));
    });

    expect(login).toHaveBeenCalledWith('admin@pet.dev', 'Admin@123456');
    expect(onAuthed).toHaveBeenCalled();
  });

  it('shows an error message on invalid credentials', async () => {
    const login = vi.spyOn(await import('../api.js').then((m) => m.adminApi), 'login');
    login.mockRejectedValue(new Error('http_401'));

    render(<LoginPage onAuthed={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'x@y.z' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '登录' }));
    });

    expect(screen.getByRole('alert').textContent).toContain('邮箱或密码不正确');
  });
});
