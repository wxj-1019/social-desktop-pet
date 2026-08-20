import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { adminApi, setAccessToken } from './api.js';
import { AdminsPage } from './pages/admins.js';
import { AuditPage } from './pages/audit.js';
import { OverviewPage } from './pages/overview.js';
import { PetsPage } from './pages/pets.js';
import { SensitivePage } from './pages/sensitive.js';
import { SocialPage } from './pages/social.js';
import { UsagePage } from './pages/usage.js';
import { UsersPage } from './pages/users.js';
import { WaitlistPage } from './pages/waitlist.js';

export type AdminView =
  | 'overview'
  | 'social'
  | 'users'
  | 'pets'
  | 'usage'
  | 'waitlist'
  | 'sensitive'
  | 'audit'
  | 'admins';

/** 导航图标：16px 线性（Feather 风格），aria-hidden，不进入可访问性树 */
function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

const NAV: Array<{ key: AdminView; label: string; icon: ReactNode }> = [
  {
    key: 'overview',
    label: '总览',
    icon: (
      <NavIcon>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </NavIcon>
    ),
  },
  {
    key: 'social',
    label: '社交互动',
    icon: (
      <NavIcon>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </NavIcon>
    ),
  },
  {
    key: 'users',
    label: '用户管理',
    icon: (
      <NavIcon>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </NavIcon>
    ),
  },
  {
    key: 'pets',
    label: '宠物与羁绊',
    icon: (
      <NavIcon>
        <path d="M10 5.172C10 3.782 8.423 2.679 6.5 3c-2.823.47-4.113 6.006-4 7 .08.703 1.725 1.722 3.656 1 1.261-.472 1.855-1 2.25-1 2.052 0 2.197 2.986 3.5 3 .738 0 1.5-1 2.5-1 3 0 5 2 5 7s-2 7-7 7-7-2-7-7c0-3 1-5 3-7" />
        <path d="M15.5 10c.28 0 .5-.22.5-.5s-.22-.5-.5-.5-.5.22-.5.5.22.5.5.5z" />
      </NavIcon>
    ),
  },
  {
    key: 'usage',
    label: '运行与用量',
    icon: (
      <NavIcon>
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </NavIcon>
    ),
  },
  {
    key: 'waitlist',
    label: '运营邀请',
    icon: (
      <NavIcon>
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 7-10 6L2 7" />
      </NavIcon>
    ),
  },
  {
    key: 'sensitive',
    label: '聊天与记忆',
    icon: (
      <NavIcon>
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </NavIcon>
    ),
  },
  {
    key: 'audit',
    label: '审计日志',
    icon: (
      <NavIcon>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </NavIcon>
    ),
  },
  {
    key: 'admins',
    label: '管理员',
    icon: (
      <NavIcon>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </NavIcon>
    ),
  },
];

/** URL hash → 视图（非法 hash 回退总览，保证可书签/分享/前进后退） */
function hashToView(hash: string): AdminView {
  const key = hash.replace(/^#\/?/, '') as AdminView;
  return NAV.some((n) => n.key === key) ? key : 'overview';
}

export function Layout({ onLogout }: { onLogout(): void }) {
  const [view, setView] = useState<AdminView>(() => hashToView(window.location.hash));
  const [meEmail, setMeEmail] = useState<string | null>(null);

  // 侧栏底部身份区：显示当前管理员邮箱（会话已由 App 门控，这里失败静默降级）
  useEffect(() => {
    adminApi
      .me()
      .then((r) => setMeEmail(r.admin.email))
      .catch(() => undefined);
  }, []);

  // hash 路由：浏览器前进/后退/手改地址 → 视图跟随；点导航 → 写 hash
  useEffect(() => {
    const onHashChange = () => setView(hashToView(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (next: AdminView) => {
    window.location.hash = `/${next}`;
    setView(next);
  };

  const logout = async () => {
    await adminApi.logout().catch(() => undefined);
    setAccessToken(null);
    onLogout();
  };

  const envLabel = import.meta.env.MODE === 'production' ? '生产环境' : '本地开发';

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">
            ✦
          </span>
          <div className="brand-text">
            <h1>星屿运营后台</h1>
            <span className="brand-env">{envLabel}</span>
          </div>
        </div>
        <p className="nav-section">控制台</p>
        <nav>
          {NAV.map(({ key, label, icon }) => (
            <button
              key={key}
              className={view === key ? 'nav-item active' : 'nav-item'}
              aria-current={view === key ? 'page' : undefined}
              onClick={() => navigate(key)}
            >
              {icon}
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="admin-avatar" aria-hidden="true">
            {meEmail ? meEmail.slice(0, 1).toUpperCase() : '·'}
          </span>
          <span className="admin-email" title={meEmail ?? undefined}>
            {meEmail ?? '…'}
          </span>
          <button
            className="logout-btn"
            onClick={() => void logout()}
            title="退出登录"
            aria-label="退出登录"
          >
            <NavIcon>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="m16 17 5-5-5-5" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </NavIcon>
          </button>
        </div>
      </aside>
      <main className="content">
        <div className="view" key={view}>
          {view === 'overview' && <OverviewPage onNavigate={(v) => navigate(v as AdminView)} />}
          {view === 'social' && <SocialPage />}
          {view === 'users' && <UsersPage />}
          {view === 'pets' && <PetsPage />}
          {view === 'usage' && <UsagePage />}
          {view === 'waitlist' && <WaitlistPage />}
          {view === 'sensitive' && <SensitivePage />}
          {view === 'audit' && <AuditPage />}
          {view === 'admins' && <AdminsPage />}
        </div>
      </main>
    </div>
  );
}
