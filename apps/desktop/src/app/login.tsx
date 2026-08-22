/** 登录/注册页。refresh token 仍只由主进程 safeStorage 持有。 */
import { useState } from 'react';

import { setAccessToken } from '../lib/api/client.js';
import { getOrCreateDeviceId } from '../lib/device.js';

import { PanelBrand } from './panel-brand.js';

export interface AuthResult {
  userId: string;
  nickname: string;
}

interface LoginProps {
  onAuthed: (result: AuthResult) => void;
  pendingInvite?: boolean;
}

export function LoginPage({ onAuthed, pendingInvite }: LoginProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.includes('@') || password.length < 8) {
      setError('请检查邮箱格式，密码至少需要 8 位。');
      return;
    }
    setBusy(true);
    try {
      const deviceId = getOrCreateDeviceId();
      const result =
        mode === 'login'
          ? await window.pet.session.login({ email, password, deviceId })
          : await window.pet.session.register({
              email,
              password,
              deviceId,
              nickname: nickname || (email.split('@')[0] ?? '新朋友'),
            });
      if ('error' in result) {
        setError(String(result.error));
        return;
      }
      if (!result.accessToken || !result.profile) {
        throw new Error('登录响应缺少会话资料');
      }
      setAccessToken(result.accessToken);
      onAuthed({
        userId: result.profile.userId,
        nickname: result.profile.nickname ?? email,
      });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <PanelBrand size="hero" subtitle="你的软绵绵桌面伙伴" />
      <p className="login-intro">登录后，星屿会记住聊天，也能和好友互送小心意。</p>
      {pendingInvite && (
        <p className="notice notice--warning" role="status">
          好友正在等你，登录或注册后会继续接受邀请。
        </p>
      )}
      <div className="auth-switch" role="group" aria-label="账号操作">
        <button
          type="button"
          className={mode === 'login' ? 'active' : ''}
          aria-pressed={mode === 'login'}
          onClick={() => setMode('login')}
          disabled={busy}
        >
          登录
        </button>
        <button
          type="button"
          className={mode === 'register' ? 'active' : ''}
          aria-pressed={mode === 'register'}
          onClick={() => setMode('register')}
          disabled={busy}
        >
          注册
        </button>
      </div>
      <h2>{mode === 'login' ? '欢迎回来' : '认识一下吧'}</h2>
      <form className="login-form" onSubmit={submit}>
        <label>
          <span>邮箱</span>
          <input
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            aria-invalid={Boolean(error)}
          />
        </label>
        <label>
          <span>密码</span>
          <input
            type="password"
            placeholder="至少 8 位"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            aria-invalid={Boolean(error)}
          />
        </label>
        {mode === 'register' && (
          <label>
            <span>
              昵称 <small>选填</small>
            </span>
            <input
              placeholder="默认使用邮箱前缀"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              autoComplete="nickname"
            />
          </label>
        )}
        {error && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? '请稍候…' : mode === 'login' ? '登录并去找星屿' : '注册并认识星屿'}
        </button>
      </form>
    </div>
  );
}
