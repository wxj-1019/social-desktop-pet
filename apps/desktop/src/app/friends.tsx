/**
 * 好友页 —— 6.3 邀请 + 9.4 送礼 + 拜访 + 9.5 事件流（MVP 极简版）。
 */
import { useCallback, useEffect, useState } from 'react';

import { api, apiBase, getAccessToken, type Friend, type SyncEvent } from '../lib/api/client.js';
import { RealtimeClient, toWsUrl } from '../lib/realtime.js';

interface FriendsPageProps {
  userId: string;
}

export function FriendsPage({ userId }: FriendsPageProps) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastSeq, setLastSeq] = useState(0);

  const refreshFriends = useCallback(async () => {
    try {
      setFriends(await api.friends());
    } catch {
      /* 列表刷新失败不阻塞 */
    }
  }, []);

  const pullSync = useCallback(async () => {
    try {
      const page = await api.sync(lastSeq);
      if (page.events.length > 0) {
        setEvents((prev) => [...prev, ...page.events].slice(-20));
        setLastSeq(page.nextInboxSeq);
      }
    } catch {
      /* sync 失败静默，下次再试 */
    }
  }, [lastSeq]);

  // 首次加载 + 兜底轮询（30s；低延迟事件走 WS，9.2/9.4）
  useEffect(() => {
    void refreshFriends();
    void pullSync();
    const timer = setInterval(() => void pullSync(), 30_000);
    return () => clearInterval(timer);
  }, [refreshFriends, pullSync]);

  // 9.2/9.4：WS 实时事件（inbox.delivered → 立即 sync；重连 → 补缺）
  useEffect(() => {
    const base = apiBase();
    if (!base) return;
    const client = new RealtimeClient(toWsUrl(base), getAccessToken, {
      onEvent: (e) => {
        if (e.type === 'inbox.delivered') {
          void pullSync();
          void refreshFriends();
        }
      },
      onReconnected: () => void pullSync(), // 9.7 重连后拉取缺失 Inbox
    });
    client.connect();
    return () => client.close();
  }, [pullSync]);

  // 6.3 深链：接受邀请（登录完成后由主进程恢复转发）
  useEffect(() => {
    const off = window.pet.onDeepLink((payload) => {
      if (payload === 'NEED_SIGN_IN') {
        setNotice('请先登录，再点击邀请链接');
        return;
      }
      void (async () => {
        try {
          await api.acceptInvite(payload);
          setNotice('邀请接受成功，好友已添加 🎉');
          await refreshFriends();
        } catch (e) {
          setNotice((e as Error).message);
        }
      })();
    });
    return off;
  }, [refreshFriends]);

  async function createInvite() {
    try {
      const created = await api.createInvite();
      setInviteLink(`pet://invite?token=${created.token}`);
      setNotice('邀请链接已生成，复制发给好友');
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  async function sendGift(friend: Friend, snackId: string) {
    try {
      const snackLabel: Record<string, string> = {
        snack_cookie: '小饼干 🍪',
        snack_candy: '糖果 🍬',
        snack_tea: '茶 🍵',
      };
      const result = await api.sendGift(friend.userId, snackId, crypto.randomUUID());
      setNotice(
        `已给 ${friend.nickname} 送了${snackLabel[snackId] ?? '点心'} (event ${result.eventId.slice(0, 8)})`,
      );
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  async function sendVisit(friend: Friend, type: 'wave' | 'share_snack' | 'leave_message') {
    try {
      const visitLabel: Record<string, string> = {
        wave: '挥手拜访 👋',
        share_snack: '分享点心 🍪',
        leave_message: '留言 💬',
      };
      const result = await api.sendVisit(friend.userId, type);
      setNotice(
        `已${visitLabel[type] ?? '拜访'} ${friend.nickname} (visit ${result.visitId.slice(0, 8)})`,
      );
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  return (
    <div className="friends-page">
      <h2>好友</h2>
      <button onClick={createInvite}>创建邀请链接</button>
      {inviteLink && (
        <p className="invite-link">
          邀请链接：<code>{inviteLink}</code>
        </p>
      )}
      {notice && <p className="notice">{notice}</p>}

      <ul className="friend-list">
        {friends.length === 0 && <li className="empty">还没有好友——把邀请链接发给朋友吧</li>}
        {friends.map((f) => (
          <FriendActions
            key={f.userId}
            friend={f}
            userId={userId}
            onGift={sendGift}
            onVisit={sendVisit}
          />
        ))}
      </ul>

      <h3>最近事件（sync）</h3>
      <ul className="event-list">
        {events.length === 0 && <li className="empty">暂无事件</li>}
        {events.map((e) => (
          <li key={e.inboxSeq}>
            <code>#{e.inboxSeq}</code> {e.event.type}
            <span className="event-time">
              {new Date(e.event.serverTimestamp).toLocaleTimeString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 单个好友行：昵称 + 礼物类型选择 + 拜访类型选择 */
function FriendActions({
  friend,
  userId,
  onGift,
  onVisit,
}: {
  friend: Friend;
  userId: string;
  onGift: (friend: Friend, snackId: string) => Promise<void>;
  onVisit: (friend: Friend, type: 'wave' | 'share_snack' | 'leave_message') => Promise<void>;
}) {
  const [snack, setSnack] = useState('snack_cookie');
  const [visitType, setVisitType] = useState<'wave' | 'share_snack' | 'leave_message'>('wave');

  return (
    <li className="friend-item">
      <span>
        {friend.nickname}
        {friend.userId === userId ? '（我）' : ''}
      </span>
      <div className="friend-actions">
        <select value={snack} onChange={(e) => setSnack(e.target.value)} aria-label="点心类型">
          <option value="snack_cookie">🍪 饼干</option>
          <option value="snack_candy">🍬 糖果</option>
          <option value="snack_tea">🍵 茶</option>
        </select>
        <button onClick={() => void onGift(friend, snack)}>送</button>
        <select
          value={visitType}
          onChange={(e) => setVisitType(e.target.value as typeof visitType)}
          aria-label="拜访类型"
        >
          <option value="wave">👋 挥手</option>
          <option value="share_snack">🍪 分享</option>
          <option value="leave_message">💬 留言</option>
        </select>
        <button onClick={() => void onVisit(friend, visitType)}>拜访</button>
      </div>
    </li>
  );
}
