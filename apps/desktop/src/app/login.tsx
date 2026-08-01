/**
 * 登录/注册页 —— 6.1/6.2 + 9.8 设备维度。
 * 提交经主进程（session IPC）直连后端；refresh token 留在主进程 safeStorage。
 */
import { useState } from 'react';

import { setAccessToken } from '../lib/api/client.js';
import { getOrCreateDeviceId } from '../lib/device.js';

export interface AuthResult {
  userId: string;
  nickname: string;
}

interface LoginProps {
  onAuthed: (result: AuthResult) => void;
  /** 深链待恢复提示（NEED_SIGN_IN 时显示） */
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
      setError('邮箱格式或密码长度不正确（至少 8 位）');
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
      const r = result as {
        phase: string;
        accessToken: string | null;
        profile: { userId: string; nickname: string } | null;
      };
      setAccessToken(r.accessToken);
      onAuthed({ userId: r.profile?.userId ?? '', nickname: r.profile?.nickname ?? email });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <h2>{mode === 'login' ? '登录' : '注册'}</h2>
      {pendingInvite && <p className="login-hint">你收到了好友邀请，登录/注册后自动接受 🎉</p>}
      <form onSubmit={submit}>
        <input
          type="email"
          placeholder="邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />
        <input
          type="password"
          placeholder="密码（至少 8 位）"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        />
        {mode === 'register' && (
          <input
            placeholder="昵称（默认邮箱前缀）"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        )}
        {error && <p className="login-error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
        </button>
      </form>
      <button
        className="link-button"
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        disabled={busy}
      >
        {mode === 'login' ? '没有账号？注册' : '已有账号？登录'}
      </button>
    </div>
  );
}
