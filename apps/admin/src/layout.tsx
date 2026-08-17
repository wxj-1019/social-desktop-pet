import { useState } from 'react';

import { adminApi, setAccessToken } from './api.js';
import { AuditPage } from './pages/audit.js';
import { OverviewPage } from './pages/overview.js';
import { SensitivePage } from './pages/sensitive.js';
import { UsagePage } from './pages/usage.js';
import { UsersPage } from './pages/users.js';
import { WaitlistPage } from './pages/waitlist.js';

export type AdminView = 'overview' | 'users' | 'usage' | 'waitlist' | 'sensitive' | 'audit';

const NAV: Array<[AdminView, string]> = [
  ['overview', '总览'],
  ['users', '用户管理'],
  ['usage', '运行与用量'],
  ['waitlist', '运营邀请'],
  ['sensitive', '聊天与记忆'],
  ['audit', '审计日志'],
];

export function Layout({ onLogout }: { onLogout(): void }) {
  const [view, setView] = useState<AdminView>('overview');

  const logout = async () => {
    await adminApi.logout().catch(() => undefined);
    setAccessToken(null);
    onLogout();
  };

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <h1>星屿运营后台</h1>
        <nav>
          {NAV.map(([key, label]) => (
            <button
              key={key}
              className={view === key ? 'nav-item active' : 'nav-item'}
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button className="nav-item logout" onClick={() => void logout()}>
          退出登录
        </button>
      </aside>
      <main className="content">
        {view === 'overview' && <OverviewPage />}
        {view === 'users' && <UsersPage />}
        {view === 'usage' && <UsagePage />}
        {view === 'waitlist' && <WaitlistPage />}
        {view === 'sensitive' && <SensitivePage />}
        {view === 'audit' && <AuditPage />}
      </main>
    </div>
  );
}
