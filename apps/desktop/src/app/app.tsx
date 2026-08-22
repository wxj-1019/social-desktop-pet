import { LogOut, ShieldQuestion, Sparkles, UserRound, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { PanelOpen, PetProfile } from '@pet/protocol';

import { api, initApi, setAccessToken } from '../lib/api/client.js';

import { CharacterSelect } from './character-select.js';
import { ChatPanel } from './chat-panel.js';
import { FriendsPage } from './friends.js';
import { LocalChat } from './local-chat.js';
import { LoginPage, type AuthResult } from './login.js';
import { MemoriesPage } from './memories.js';
import { ModelSettingsPage } from './model-settings.js';
import { PanelBrand } from './panel-brand.js';
import { SettingsPage } from './settings.js';

type SessionPhase = 'booting' | 'signed_out' | 'local' | 'active';
type ActiveTab = 'friends' | 'chat' | 'character' | 'memories' | 'settings' | 'model';

const ALL_TABS: ActiveTab[] = ['friends', 'chat', 'character', 'memories', 'model', 'settings'];
const TAB_LABELS: Record<ActiveTab, string> = {
  friends: '好友',
  chat: '聊天',
  character: '角色',
  memories: '记忆',
  model: '模型',
  settings: '设置',
};

/** 主应用面板：会话状态机驱动登录、本地聊天与已登录界面。 */
export function AppPanel() {
  const [phase, setPhase] = useState<SessionPhase>('booting');
  const [tab, setTab] = useState<ActiveTab>('friends');
  const [localTab, setLocalTab] = useState<ActiveTab>('chat');
  const [user, setUser] = useState<AuthResult | null>(null);
  const [pendingInvite, setPendingInvite] = useState(false);
  const phaseRef = useRef<SessionPhase>('booting');
  phaseRef.current = phase;

  /** 统一处理导航意图（live 消息与挂载后拉取的缓冲共用同一路由逻辑） */
  const applyNavigate = useCallback((nav: PanelOpen) => {
    if (nav.view === 'login') {
      setPhase('signed_out');
      return;
    }
    // 除 login 外协议 view 与 ActiveTab 一一对应（PanelOpenSchema）。
    // 未登录（signed_out/local）也不静默丢弃：切进本地模式并定位目标 tab，
    // 云端专属页（好友/记忆）由 LoginRequired 引导登录。
    if (phaseRef.current === 'active') {
      setTab(nav.view);
    } else {
      setPhase('local');
      setLocalTab(nav.view);
    }
  }, []);

  // ---- 档案云同步（P2 跨设备）：登录确立后拉云端覆盖本地；本地变更上报 ----
  const profileSyncingRef = useRef(false);

  const syncProfileFromCloud = useCallback(async () => {
    try {
      const remote = await api.getPetProfile();
      if (remote.profile) {
        profileSyncingRef.current = true;
        await window.pet.petProfile.set(remote.profile);
      }
    } catch {
      // 云端不可达/无档案：保留本地（下次登录再试）
    } finally {
      profileSyncingRef.current = false;
    }
  }, []);

  useEffect(() => {
    // 本地档案变更（设置页/切角色/云端拉取覆盖）→ 上报云端；拉取覆盖期间抑制回环
    const off = window.pet.petProfile.onChanged((profile: PetProfile) => {
      if (profileSyncingRef.current) return;
      void api.putPetProfile(profile).catch(() => undefined);
    });
    return off;
  }, []);

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
          void syncProfileFromCloud(); // 跨设备：云端档案覆盖本地
        } else {
          setPhase('signed_out');
        }
      } catch {
        setPhase('signed_out');
      }
      // C1 同类竞态兜底：panel:navigate 可能早于本组件订阅到达（did-finish-load
      // 早于 useEffect 挂载）→ 消息丢失，面板停在登录页。会话恢复完成后拉取
      // 主进程缓冲的最新导航意图（拉取即清除），复用同一路由逻辑。
      const pending = await window.pet.panel.consumePendingView().catch(() => null);
      if (pending) applyNavigate({ view: pending });
    })();
  }, [applyNavigate]);

  useEffect(() => {
    const off = window.pet.onDeepLink((payload) => {
      if (payload === 'NEED_SIGN_IN') setPendingInvite(true);
    });
    return off;
  }, []);

  useEffect(() => {
    const off = window.pet.panel.onNavigate(applyNavigate);
    return off;
  }, [applyNavigate]);

  const onCharacterBack = useCallback(() => {
    setTab('friends');
    setLocalTab('chat');
  }, []);

  const onAuthed = useCallback(
    (result: AuthResult) => {
      setUser(result);
      setPendingInvite(false);
      setPhase('active');
      void syncProfileFromCloud(); // 跨设备：云端档案覆盖本地
    },
    [syncProfileFromCloud],
  );

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
        <PanelTabs tab={localTab} onChange={setLocalTab} />
        <div
          className="app-viewport"
          role="tabpanel"
          id={`panel-${localTab}`}
          aria-labelledby={`tab-${localTab}`}
        >
          {localTab === 'chat' ? (
            <LocalChat onLoginClick={() => setPhase('signed_out')} />
          ) : localTab === 'character' ? (
            <CharacterSelect onBack={onCharacterBack} />
          ) : localTab === 'settings' ? (
            <SettingsPage />
          ) : localTab === 'model' ? (
            <ModelSettingsPage />
          ) : (
            <LoginRequired view={localTab} onLogin={() => setPhase('signed_out')} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="pet-stage pet-stage--app">
      <PanelHeader nickname={user?.nickname} onLogout={onLogout} />
      <PanelTabs tab={tab} onChange={setTab} />
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
        ) : tab === 'model' ? (
          <ModelSettingsPage />
        ) : (
          <SettingsPage />
        )}
      </div>
    </div>
  );
}

/** 面板 tab 栏（active 与 local 两阶段共用；local 下好友/记忆渲染登录引导） */
function PanelTabs({ tab, onChange }: { tab: ActiveTab; onChange: (tab: ActiveTab) => void }) {
  return (
    <nav
      className="app-tabs"
      role="tablist"
      aria-label="面板页面"
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const current = ALL_TABS.indexOf(tab);
          const next = e.key === 'ArrowLeft' ? current - 1 : current + 1;
          if (next >= 0 && next < ALL_TABS.length) onChange(ALL_TABS[next]!);
        }
      }}
    >
      {ALL_TABS.map((t) => (
        <button
          key={t}
          className={tab === t ? 'tab active' : 'tab'}
          role="tab"
          id={`tab-${t}`}
          aria-selected={tab === t}
          aria-controls={`panel-${t}`}
          onClick={() => onChange(t)}
        >
          {TAB_LABELS[t]}
        </button>
      ))}
    </nav>
  );
}

/** 本地模式下云端功能的登录引导：给明确出口而非静默失败 */
function LoginRequired({ view, onLogin }: { view: ActiveTab; onLogin: () => void }) {
  return (
    <main className="login-required" aria-label={`${TAB_LABELS[view]}（需登录）`}>
      <span className="login-required__icon" aria-hidden="true">
        <ShieldQuestion size={26} />
      </span>
      <h2>{TAB_LABELS[view]}需要登录后使用</h2>
      <p>本地模式可以聊天、换角色、改设置；{TAB_LABELS[view]}的数据保存在云端账号里。</p>
      <button className="login-required__cta primary-button" type="button" onClick={onLogin}>
        去登录
      </button>
    </main>
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
