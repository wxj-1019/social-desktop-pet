import { Bubble } from '@pet/ui';
import { useCallback, useEffect, useState } from 'react';

import { initApi, setAccessToken } from '../lib/api/client.js';
import { usePetStateMachine } from '../pet/use-pet-state-machine.js';

import { FriendsPage } from './friends.js';
import { LocalChat } from './local-chat.js';
import { LoginPage, type AuthResult } from './login.js';

type SessionPhase = 'booting' | 'signed_out' | 'local' | 'active';

/**
 * 主应用：会话状态机（9.8）驱动 登录页 ↔ 本地模式 ↔ 主界面。
 * - booting：启动恢复（主进程读 safeStorage refresh token → 自动刷新）
 * - signed_out：登录/注册页（深链待恢复时提示；可进本地模式）
 * - local：本地降级（规则聊天，数据不出本机；Alpha 退出标准）
 * - active：好友/送礼/拜访/事件流
 */
export function App() {
  const [phase, setPhase] = useState<SessionPhase>('booting');
  const [user, setUser] = useState<AuthResult | null>(null);
  const [pendingInvite, setPendingInvite] = useState(false);
  const pet = usePetStateMachine();

  // 启动：API 基址 + 会话恢复
  useEffect(() => {
    void (async () => {
      try {
        await initApi();
        const result = (await window.pet.session.init()) as
          | {
              phase: string;
              accessToken: string | null;
              profile: { userId: string; nickname: string } | null;
            }
          | { error?: string };
        if ('error' in result) {
          setPhase('signed_out');
          return;
        }
        setAccessToken(result.accessToken);
        if (result.phase === 'ACTIVE' && result.profile) {
          setUser({ userId: result.profile.userId, nickname: result.profile.nickname });
          setPhase('active');
        } else {
          setPhase('signed_out');
        }
      } catch {
        setPhase('signed_out'); // 后端不可达也降级到登录页（本地降级见后续迭代）
      }
    })();
  }, []);

  // 6.3 深链：未登录时提示登录后恢复
  useEffect(() => {
    const off = window.pet.onDeepLink((payload) => {
      if (payload === 'NEED_SIGN_IN') setPendingInvite(true);
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
      <div className="pet-stage">
        <Bubble text={'AI 桌宠 · 正在恢复会话…'} />
      </div>
    );
  }

  if (phase === 'signed_out') {
    return (
      <div className="pet-stage">
        <LoginPage onAuthed={onAuthed} pendingInvite={pendingInvite} />
        {/* 本地降级：未登录也能养桌宠（Alpha 退出标准） */}
        <button className="local-entry" onClick={() => setPhase('local')}>
          先逛逛（本地模式）
        </button>
      </div>
    );
  }

  if (phase === 'local') {
    return (
      <div className="pet-stage">
        <header className="app-header">
          <span>🏠 本地模式</span>
          <span className="pet-state">桌宠：{pet.state}</span>
          <button className="link-button" onClick={() => setPhase('signed_out')}>
            登录
          </button>
        </header>
        <LocalChat onLoginClick={() => setPhase('signed_out')} />
      </div>
    );
  }

  return (
    <div className="pet-stage">
      <header className="app-header">
        <span>👤 {user?.nickname}</span>
        <span className="pet-state">桌宠：{pet.state}</span>
        <button className="link-button" onClick={() => void onLogout()}>
          退出
        </button>
      </header>
      <FriendsPage userId={user?.userId ?? ''} />
    </div>
  );
}
