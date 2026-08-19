import { useEffect, useState } from 'react';

import { adminApi, setAccessToken, AdminApiError } from '../api.js';

export function LoginPage({ onAuthed }: { onAuthed(): void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 限流倒计时（秒）：触发 rate_limit 后禁用按钮并逐秒递减
  const [lockSeconds, setLockSeconds] = useState(0);

  useEffect(() => {
    if (lockSeconds <= 0) return;
    const id = setTimeout(() => setLockSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [lockSeconds]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || lockSeconds > 0) return;
    setBusy(true);
    setError(null);
    try {
      const { accessToken } = await adminApi.login(email, password);
      setAccessToken(accessToken);
      onAuthed();
    } catch (err) {
      if (err instanceof AdminApiError && err.code === 'rate_limit') {
        const retry = err.retryAfterSec ?? 30;
        setLockSeconds(retry);
        setError(`尝试过于频繁，请 ${retry} 秒后再试`);
      } else if (err instanceof AdminApiError && err.code === 'admin_disabled') {
        setError('管理员账号已停用');
      } else {
        setError('邮箱或密码不正确');
      }
    } finally {
      setBusy(false);
    }
  };

  const locked = lockSeconds > 0;

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <h1>星屿运营后台</h1>
          <p className="brand-sub">桌面宠物运营控制台 · 仅限授权管理员</p>
        </div>
        <label>
          邮箱
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            disabled={locked}
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            disabled={locked}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || locked}>
          {locked ? `请 ${lockSeconds} 秒后再试` : busy ? '登录中…' : '登录'}
        </button>
      </form>
    </main>
  );
}
