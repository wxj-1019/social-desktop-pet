import { useEffect, useState } from 'react';

import { adminApi, setAccessToken, setUnauthorizedHandler } from './api.js';
import { Layout } from './layout.js';
import { LoginPage } from './pages/login.js';

type SessionState = 'loading' | 'anonymous' | 'authed';

export function App() {
  const [session, setSession] = useState<SessionState>('loading');

  // 先注册全局 401 处理（refresh 失败 → 任何页面请求都会触发回登录页），再恢复会话
  useEffect(() => {
    setUnauthorizedHandler(() => setSession('anonymous'));
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .me()
      .then(() => {
        if (!cancelled) setSession('authed');
      })
      .catch(() => {
        if (!cancelled) {
          setAccessToken(null);
          setSession('anonymous');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (session === 'loading') return <div className="boot">正在载入…</div>;
  if (session === 'anonymous') return <LoginPage onAuthed={() => setSession('authed')} />;
  return <Layout onLogout={() => setSession('anonymous')} />;
}
