import { useState } from 'react';

import { adminApi, setAccessToken, AdminApiError } from '../api.js';

export function LoginPage({ onAuthed }: { onAuthed(): void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { accessToken } = await adminApi.login(email, password);
      setAccessToken(accessToken);
      onAuthed();
    } catch (err) {
      if (err instanceof AdminApiError && err.code === 'rate_limit') {
        setError('尝试过于频繁，请稍后再试');
      } else if (err instanceof AdminApiError && err.code === 'admin_disabled') {
        setError('管理员账号已停用');
      } else {
        setError('邮箱或密码不正确');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <h1>星屿运营后台</h1>
        <label>
          邮箱
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
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
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy}>
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
    </main>
  );
}
