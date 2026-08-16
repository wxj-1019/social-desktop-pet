import { LogOut, Sparkles, UserRound, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { initApi, setAccessToken } from '../lib/api/client.js';

import { CharacterSelect } from './character-select.js';
import { ChatPanel } from './chat-panel.js';
import { FriendsPage } from './friends.js';
import { LocalChat } from './local-chat.js';
import { LoginPage, type AuthResult } from './login.js';
import { MemoriesPage } from './memories.js';
import { PanelBrand } from './panel-brand.js';
import { SettingsPage } from './settings.js';

type SessionPhase = 'booting' | 'signed_out' | 'local' | 'active';
type ActiveTab = 'friends' | 'chat' | 'character' | 'memories' | 'settings';

/** 主应用面板：会话状态机驱动登录、本地聊天与已登录界面。 */
export function AppPanel() {
  const [phase, setPhase] = useState<SessionPhase>('booting');
  const [tab, setTab] = useState<ActiveTab>('friends');
  const [localTab, setLocalTab] = useState<'chat' | 'character'>('chat');
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
        // 除 login 外协议 view 与 ActiveTab 一一对应（PanelOpenSchema）
        setTab(nav.view);
      }
    });
    return off;
  }, []);

  const onCharacterBack = useCallback(() => {
    setTab('friends');
    setLocalTab('chat');
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
          <div className="auth-shell__bar">
            <button
              className="auth-shell__close icon-button"
              type="button"
              aria-label="关闭面板"
              title="关闭面板"
              onClick={() => void window.pet.panel.close()}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <LoginPage onAuthed={onAuthed} pendingInvite={pendingInvite} />
          <button className="local-entry" onClick={() => setPhase('local')}>
            <Sparkles size={14} style={{ marginRight: 6 }} aria-hidden="true" />
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
        <nav className="app-tabs" role="tablist" aria-label="面板页面">
          <button
            className={localTab === 'chat' ? 'tab active' : 'tab'}
            role="tab"
            aria-selected={localTab === 'chat'}
            onClick={() => setLocalTab('chat')}
          >
            聊天
          </button>
          <button
            className={localTab === 'character' ? 'tab active' : 'tab'}
            role="tab"
            aria-selected={localTab === 'character'}
            onClick={() => setLocalTab('character')}
          >
            角色
          </button>
        </nav>
        <div
          className="app-viewport"
          role="tabpanel"
          id={`panel-${localTab}`}
          aria-label="本地内容"
        >
          {localTab === 'character' ? (
            <CharacterSelect onBack={onCharacterBack} />
          ) : (
            <LocalChat onLoginClick={() => setPhase('signed_out')} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="pet-stage pet-stage--app">
      <PanelHeader nickname={user?.nickname} onLogout={onLogout} />
      <nav
        className="app-tabs"
        role="tablist"
        aria-label="面板页面"
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            const tabs: ActiveTab[] = ['friends', 'chat', 'character', 'memories', 'settings'];
            const current = tabs.indexOf(tab);
            const next = e.key === 'ArrowLeft' ? current - 1 : current + 1;
            if (next >= 0 && next < tabs.length) setTab(tabs[next]!);
          }
        }}
      >
        <button
          className={tab === 'friends' ? 'tab active' : 'tab'}
          role="tab"
          id="tab-friends"
          aria-selected={tab === 'friends'}
          aria-controls="panel-friends"
          onClick={() => setTab('friends')}
        >
          好友
        </button>
        <button
          className={tab === 'chat' ? 'tab active' : 'tab'}
          role="tab"
          id="tab-chat"
          aria-selected={tab === 'chat'}
          aria-controls="panel-chat"
          onClick={() => setTab('chat')}
        >
          聊天
        </button>
        <button
          className={tab === 'character' ? 'tab active' : 'tab'}
          role="tab"
          id="tab-character"
          aria-selected={tab === 'character'}
          aria-controls="panel-character"
          onClick={() => setTab('character')}
        >
          角色
        </button>
        <button
          className={tab === 'memories' ? 'tab active' : 'tab'}
          role="tab"
          id="tab-memories"
          aria-selected={tab === 'memories'}
          aria-controls="panel-memories"
          onClick={() => setTab('memories')}
        >
          记忆
        </button>
        <button
          className={tab === 'settings' ? 'tab active' : 'tab'}
          role="tab"
          id="tab-settings"
          aria-selected={tab === 'settings'}
          aria-controls="panel-settings"
          onClick={() => setTab('settings')}
        >
          设置
        </button>
      </nav>
      <div
        className="app-viewport"
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
      >
        {tab === 'friends' ? (
          <FriendsPage userId={user?.userId ?? ''} />
        ) : tab === 'chat' ? (
          <ChatPanel />
        ) : tab === 'character' ? (
          <CharacterSelect onBack={onCharacterBack} />
        ) : tab === 'memories' ? (
          <MemoriesPage />
        ) : (
          <SettingsPage />
        )}
      </div>
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
  const menuRef = useRef<HTMLDetailsElement | null>(null);

  // 账号菜单：Escape 或点击外部时关闭（原生 details 不处理这些）
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') menu.open = false;
    };
    const onClickOutside = (e: MouseEvent) => {
      if (menu.open && !menu.contains(e.target as Node)) menu.open = false;
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onClickOutside);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onClickOutside);
    };
  }, []);

  return (
    <header className="app-header">
      {/* 纯文字标：各视图自带角色头部（聊天角色区/好友头像），避免上下双层头像重复 */}
      <div className="app-header__brand">
        <strong>星屿</strong>
        <span>{nickname ? `和 ${nickname} 在一起` : '轻轻陪在你身边'}</span>
      </div>
      <div className="app-header__actions">
        {onLogout && (
          <details className="account-menu" ref={menuRef}>
            <summary className="icon-button" role="button" aria-label="账号菜单" title="账号菜单">
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
