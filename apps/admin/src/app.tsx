import { useEffect, useState } from 'react';

import { adminApi, setAccessToken } from './api.js';
import { Layout } from './layout.js';
import { LoginPage } from './pages/login.js';

type SessionState = 'loading' | 'anonymous' | 'authed';

export function App() {
  const [session, setSession] = useState<SessionState>('loading');

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
