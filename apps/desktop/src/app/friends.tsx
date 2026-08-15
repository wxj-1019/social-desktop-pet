/** 好友页：邀请、送礼、拜访与实时动态。 */
import { Check, Copy, Gift, RefreshCw, Send, Sparkles, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, apiBase, getAccessToken, type Friend, type SyncEvent } from '../lib/api/client.js';
import { syncAfter } from '../lib/inbox-cursor.js';
import { RealtimeClient, toWsUrl } from '../lib/realtime.js';
import { StarIsleVisual } from '../pet/star-isle-visual.js';

interface FriendsPageProps {
  userId: string;
}

const seenDeepLinkPayloads = new Set<string>();
const seenGiftEventIds = new Set<string>();

const snackLabels: Record<string, string> = {
  snack_cookie: '小饼干',
  snack_candy: '水果糖',
  snack_tea: '暖茶点',
};

const visitLabels: Record<string, string> = {
  wave: '挥手问好',
  share_snack: '分享点心',
  leave_message: '留句话',
};

function parseGiftPayload(
  payload: unknown,
): { giftId: string; snackId: string; fromUserId: string } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const parsed = payload as Record<string, unknown>;
  if (
    typeof parsed.giftId !== 'string' ||
    typeof parsed.snackId !== 'string' ||
    typeof parsed.fromUserId !== 'string'
  ) {
    return null;
  }
  return {
    giftId: parsed.giftId,
    snackId: parsed.snackId,
    fromUserId: parsed.fromUserId,
  };
}

function eventLabel(entry: SyncEvent, friends: Friend[]): string {
  const payload = entry.event.payload as Record<string, unknown> | null;
  const friendId =
    payload && typeof payload.fromUserId === 'string'
      ? payload.fromUserId
      : payload && typeof payload.friendUserId === 'string'
        ? payload.friendUserId
        : null;
  const friendName = friends.find((friend) => friend.userId === friendId)?.nickname ?? '好友';

  switch (entry.event.type) {
    case 'gift.snack_sent':
      return `${friendName} 送来了一份小点心`;
    case 'friend.added':
      return `你和 ${friendName} 成为了好友`;
    case 'visit.created':
      return `${friendName} 来星屿看看你`;
    default:
      return '你们之间有一条新动态';
  }
}

export function FriendsPage({ userId }: FriendsPageProps) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<'success' | 'error'>('success');
  const [lastSeq, setLastSeq] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [copied, setCopied] = useState(false);
  const friendsRef = useRef<Friend[]>([]);

  useEffect(() => {
    friendsRef.current = friends;
  }, [friends]);

  const refreshFriends = useCallback(async () => {
    try {
      setLoadError(false);
      setFriends(await api.friends());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const pullSync = useCallback(async () => {
    try {
      // 9.5 慢路径补齐：循环分页直到追上最新（断线 72h+/序列缺口时一次性补游标）
      const { items, nextInboxSeq } = await syncAfter(lastSeq);
      if (items.length > 0) {
        setEvents((previous) => [...previous, ...items].slice(-20));
        setLastSeq(nextInboxSeq);
      }
    } catch {
      // 实时连接或下一次轮询会继续补齐。
    }
  }, [lastSeq]);

  useEffect(() => {
    void refreshFriends();
    void pullSync();
    const timer = setInterval(() => void pullSync(), 30_000);
    return () => clearInterval(timer);
  }, [refreshFriends, pullSync]);

  useEffect(() => {
    const base = apiBase();
    if (!base) return;
    const client = new RealtimeClient(toWsUrl(base), getAccessToken, {
      onEvent: (event) => {
        if (event.type === 'inbox.delivered') {
          void pullSync();
          void refreshFriends();
        }
      },
      onReconnected: () => void pullSync(),
    });
    client.connect();
    return () => client.close();
  }, [pullSync, refreshFriends]);

  useEffect(() => {
    for (const entry of events) {
      if (entry.event.type !== 'gift.snack_sent') continue;
      if (seenGiftEventIds.has(entry.event.eventId)) continue;
      seenGiftEventIds.add(entry.event.eventId);
      const payload = parseGiftPayload(entry.event.payload);
      if (!payload) continue;
      const from = friendsRef.current.find((friend) => friend.userId === payload.fromUserId);
      window.pet?.petRuntime?.socialEvent({
        type: 'gift.snack_sent',
        giftId: payload.giftId,
        snackId: payload.snackId,
        fromUserId: payload.fromUserId,
        ...(from ? { fromNickname: from.nickname } : {}),
      });
    }
  }, [events]);

  useEffect(() => {
    const handleDeepLink = (payload: string): void => {
      if (seenDeepLinkPayloads.has(payload)) return;
      seenDeepLinkPayloads.add(payload);
      if (payload === 'NEED_SIGN_IN') {
        showNotice('请先登录，再打开好友邀请。', 'error');
        return;
      }
      void (async () => {
        try {
          await api.acceptInvite(payload);
          showNotice('邀请已接受，你们成为好友啦。');
          await refreshFriends();
        } catch (caught) {
          showNotice((caught as Error).message, 'error');
        }
      })();
    };
    const off = window.pet.onDeepLink(handleDeepLink);
    void window.pet.consumeDeepLinkPayload().then((payload) => {
      if (payload) handleDeepLink(payload);
    });
    return off;
  }, [refreshFriends]);

  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showNotice(message: string, tone: 'success' | 'error' = 'success') {
    setNotice(message);
    setNoticeTone(tone);
    // 成功通知 4s 后自动消失（错误保持可见，用户需要看到）
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = null;
    if (tone === 'success') {
      noticeTimerRef.current = setTimeout(() => {
        setNotice(null);
        noticeTimerRef.current = null;
      }, 4_000);
    }
  }

  async function createInvite() {
    try {
      const created = await api.createInvite();
      setInviteLink(`pet://invite?token=${created.token}`);
      setCopied(false);
      showNotice('邀请链接准备好了。');
    } catch (caught) {
      showNotice((caught as Error).message, 'error');
    }
  }

  async function copyInvite() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      showNotice('邀请链接已复制，可以发给好友了。');
    } catch {
      showNotice('复制失败，请选中链接后手动复制。', 'error');
    }
  }

  async function sendGift(friend: Friend, snackId: string) {
    try {
      await api.sendGift(friend.userId, snackId, crypto.randomUUID());
      showNotice(`已给 ${friend.nickname} 送去${snackLabels[snackId] ?? '小点心'}。`);
    } catch (caught) {
      showNotice((caught as Error).message, 'error');
    }
  }

  async function sendVisit(friend: Friend, type: 'wave' | 'share_snack' | 'leave_message') {
    try {
      await api.sendVisit(friend.userId, type);
      showNotice(`已向 ${friend.nickname} 发出“${visitLabels[type] ?? '去拜访'}”。`);
    } catch (caught) {
      showNotice((caught as Error).message, 'error');
    }
  }

  return (
    <main className="friends-page" aria-labelledby="friends-title">
      <div className="view-heading">
        <div className="view-heading__identity">
          <span className="view-heading__avatar" aria-hidden="true">
            <StarIsleVisual />
          </span>
          <div>
            <p className="eyebrow">星屿小圈子</p>
            <h2 id="friends-title">好友</h2>
          </div>
        </div>
        <button className="secondary-button" onClick={() => void createInvite()}>
          <UsersRound size={16} aria-hidden="true" />
          邀请好友
        </button>
      </div>

      {inviteLink && (
        <div className="invite-link">
          <span>专属邀请链接</span>
          <div>
            <code title={inviteLink}>{inviteLink}</code>
            <button
              className="icon-button"
              type="button"
              aria-label="复制邀请链接"
              title="复制邀请链接"
              onClick={() => void copyInvite()}
            >
              {copied ? (
                <Check size={16} color="var(--panel-success)" aria-hidden="true" />
              ) : (
                <Copy size={16} aria-hidden="true" />
              )}
            </button>
          </div>
          {copied && <small>已复制</small>}
        </div>
      )}

      {notice && (
        <p className={`notice notice--${noticeTone}`} role="status" aria-live="polite">
          {notice}
        </p>
      )}

      {loading ? (
        <div className="friends-state" role="status">
          <span className="soft-loader" aria-hidden="true" />
          <p>正在看看谁在线上…</p>
        </div>
      ) : loadError ? (
        <div className="friends-state">
          <p>暂时没能连上好友列表。</p>
          <button className="secondary-button" onClick={() => void refreshFriends()}>
            <RefreshCw size={15} aria-hidden="true" />
            再试一次
          </button>
        </div>
      ) : (
        <ul className="friend-list">
          {friends.length === 0 && (
            <li className="friends-state friends-state--empty">
              <span className="friends-empty__character" aria-hidden="true">
                <StarIsleVisual />
              </span>
              <strong>小圈子还空着</strong>
              <p>邀请一位好友，一起给星屿送点心、串串门。</p>
            </li>
          )}
          {friends.map((friend) => (
            <FriendActions
              key={friend.userId}
              friend={friend}
              userId={userId}
              onGift={sendGift}
              onVisit={sendVisit}
            />
          ))}
        </ul>
      )}

      <details className="activity-feed">
        <summary>
          最近动态 <span>{events.length}</span>
        </summary>
        <ul className="event-list">
          {events.length === 0 && <li className="empty">还没有新动态</li>}
          {[...events].reverse().map((entry) => (
            <li key={entry.inboxSeq}>
              <span>{eventLabel(entry, friends)}</span>
              <time dateTime={entry.event.serverTimestamp}>
                {new Date(entry.event.serverTimestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
            </li>
          ))}
        </ul>
      </details>
    </main>
  );
}

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
      <div className="friend-identity">
        <span className="friend-avatar" aria-hidden="true">
          {friend.nickname.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <strong>{friend.nickname}</strong>
          <span>{friend.userId === userId ? '这是你' : '可以互送心意'}</span>
        </div>
      </div>
      <div className="friend-actions">
        <label>
          <span>
            <Gift size={14} aria-hidden="true" />
            送点心
          </span>
          <select
            value={snack}
            onChange={(event) => setSnack(event.target.value)}
            aria-label="点心类型"
          >
            <option value="snack_cookie">小饼干</option>
            <option value="snack_candy">水果糖</option>
            <option value="snack_tea">暖茶点</option>
          </select>
          <button
            aria-label={`送点心给 ${friend.nickname}`}
            onClick={() => void onGift(friend, snack)}
          >
            <Send size={15} aria-hidden="true" />
          </button>
        </label>
        <label>
          <span>
            <Sparkles size={14} aria-hidden="true" />
            去拜访
          </span>
          <select
            value={visitType}
            onChange={(event) => setVisitType(event.target.value as typeof visitType)}
            aria-label="拜访类型"
          >
            <option value="wave">挥手问好</option>
            <option value="share_snack">分享点心</option>
            <option value="leave_message">留句话</option>
          </select>
          <button
            aria-label={`拜访 ${friend.nickname}`}
            onClick={() => void onVisit(friend, visitType)}
          >
            <Send size={15} aria-hidden="true" />
          </button>
        </label>
      </div>
    </li>
  );
}
