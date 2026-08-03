import { LogOut, UserRound, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { initApi, setAccessToken } from '../lib/api/client.js';

import { ChatPanel } from './chat-panel.js';
import { FriendsPage } from './friends.js';
import { LocalChat } from './local-chat.js';
import { LoginPage, type AuthResult } from './login.js';
import { PanelBrand } from './panel-brand.js';

type SessionPhase = 'booting' | 'signed_out' | 'local' | 'active';
type ActiveTab = 'friends' | 'chat';

/** 主应用面板：会话状态机驱动登录、本地聊天与已登录界面。 */
export function AppPanel() {
  const [phase, setPhase] = useState<SessionPhase>('booting');
  const [tab, setTab] = useState<ActiveTab>('friends');
  const [user, setUser] = useState<AuthResult | null>(null);
  const [pendingInvite, setPendingInvite] = useState(false);
  const phaseRef = useRef<SessionPhase>('booting');
  phaseRef.current = phase;

  useEffect(() => {
    void (async () => {
      try {
        await initApi();
        const result = await window.pet.session.init();
        if ('error' in result) {
          setPhase('signed_out');
          return;
        }
        setAccessToken(result.accessToken);
        if (result.phase === 'ACTIVE' && result.profile) {
          setUser({
            userId: result.profile.userId,
            nickname: result.profile.nickname ?? '新朋友',
          });
          setPhase('active');
        } else {
          setPhase('signed_out');
        }
      } catch {
        setPhase('signed_out');
      }
    })();
  }, []);

  useEffect(() => {
    const off = window.pet.onDeepLink((payload) => {
      if (payload === 'NEED_SIGN_IN') setPendingInvite(true);
    });
    return off;
  }, []);

  useEffect(() => {
    const off = window.pet.panel.onNavigate((nav) => {
      if (nav.view === 'login') {
        setPhase('signed_out');
      } else if (phaseRef.current === 'active') {
        setTab(nav.view === 'chat' ? 'chat' : 'friends');
      }
    });
    return off;
  }, []);

  const onAuthed = useCallback((result: AuthResult) => {
    setUser(result);
    setPendingInvite(false);
    setPhase('active');
  }, []);

  const onLogout = useCallback(async () => {
    await window.pet.session.revoke();
    setAccessToken(null);
    setUser(null);
    setPhase('signed_out');
  }, []);

  if (phase === 'booting') {
    return (
      <div className="pet-stage pet-stage--centered">
        <div className="panel-loading" role="status" aria-live="polite">
          <PanelBrand subtitle="正在准备星屿" />
          <span className="panel-loading__bar" aria-hidden="true" />
          <p>马上就好，正在恢复你们的相处记录。</p>
        </div>
      </div>
    );
  }

  if (phase === 'signed_out') {
    return (
      <div className="pet-stage pet-stage--auth">
        <div className="auth-shell">
          <LoginPage onAuthed={onAuthed} pendingInvite={pendingInvite} />
          <button className="local-entry" onClick={() => setPhase('local')}>
            先体验本地聊天
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'local') {
    return (
      <div className="pet-stage pet-stage--app">
        <PanelHeader />
        <LocalChat onLoginClick={() => setPhase('signed_out')} />
      </div>
    );
  }

  return (
    <div className="pet-stage pet-stage--app">
      <PanelHeader nickname={user?.nickname} onLogout={onLogout} />
      <nav className="app-tabs" role="tablist" aria-label="面板页面">
        <button
          className={tab === 'friends' ? 'tab active' : 'tab'}
          role="tab"
          aria-selected={tab === 'friends'}
          onClick={() => setTab('friends')}
        >
          好友
        </button>
        <button
          className={tab === 'chat' ? 'tab active' : 'tab'}
          role="tab"
          aria-selected={tab === 'chat'}
          onClick={() => setTab('chat')}
        >
          聊天
        </button>
      </nav>
      {tab === 'friends' ? <FriendsPage userId={user?.userId ?? ''} /> : <ChatPanel />}
    </div>
  );
}

function PanelHeader({
  nickname,
  onLogout,
}: {
  nickname?: string;
  onLogout?: () => Promise<void>;
}) {
  return (
    <header className="app-header">
      {/* 纯文字标：各视图自带角色头部（聊天角色区/好友头像），避免上下双层头像重复 */}
      <div className="app-header__brand">
        <strong>星屿</strong>
        <span>{nickname ? `和 ${nickname} 在一起` : '轻轻陪在你身边'}</span>
      </div>
      <div className="app-header__actions">
        {onLogout && (
          <details className="account-menu">
            <summary className="icon-button" aria-label="账号菜单" title="账号菜单">
              <UserRound size={17} aria-hidden="true" />
            </summary>
            <div className="account-menu__popover">
              <button onClick={() => void onLogout()}>
                <LogOut size={15} aria-hidden="true" />
                退出登录
              </button>
            </div>
          </details>
        )}
        <button
          className="icon-button"
          type="button"
          aria-label="关闭面板"
          title="关闭面板"
          onClick={() => void window.pet.panel.close()}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

/** 别名：保持既有引用（main.tsx / e2e）兼容 */
export const App = AppPanel;
