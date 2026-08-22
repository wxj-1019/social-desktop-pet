/** 好友页：邀请、送礼、拜访与实时动态。 */
import { Check, Copy, Gift, RefreshCw, Send, Sparkles, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, apiBase, getAccessToken, type Friend, type SyncEvent } from '../lib/api/client.js';
import { syncAfter } from '../lib/inbox-cursor.js';
import { RealtimeClient, toWsUrl } from '../lib/realtime.js';
import { CharacterVisual, useCurrentCharacter } from '../pet/character-visual.js';

import { ViewHeading } from './view-heading.js';

interface FriendsPageProps {
  userId: string;
}

const seenDeepLinkPayloads = new Set<string>();
const seenSocialEventIds = new Set<string>();

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

/** 7.4 羁绊阶段文案 */
const bondStageLabels: Record<string, string> = {
  first_meet: '初识',
  familiar: '熟悉',
  trusted: '信任',
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

function eventLabel(entry: SyncEvent, friends: Friend[], petName: string): string {
  const payload = entry.event.payload as Record<string, unknown> | null;
  const friendId =
    payload && typeof payload.fromUserId === 'string'
      ? payload.fromUserId
      : payload && typeof payload.friendUserId === 'string'
        ? payload.friendUserId
        : payload && typeof payload.userId === 'string'
          ? payload.userId
          : null;
  const friendName = friends.find((friend) => friend.userId === friendId)?.nickname ?? '好友';

  switch (entry.event.type) {
    case 'gift.snack_sent':
      return `${friendName} 送来了一份小点心`;
    case 'friend.added':
      return `你和 ${friendName} 成为了好友`;
    case 'visit.arrived':
      return `${friendName} 来${petName}看看你`;
    case 'presence.changed':
      return typeof payload?.online === 'boolean'
        ? payload.online
          ? `${friendName} 上线了`
          : `${friendName} 下线了`
        : `${friendName} 状态更新了`;
    default:
      return '你们之间有一条新动态';
  }
}

export function FriendsPage({ userId }: FriendsPageProps) {
  // 当前角色名（换装后实时跟随）：好友页文案不写死星屿（形象协议阶段 C）
  const { config } = useCurrentCharacter();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [events, setEvents] = useState<SyncEvent[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<'success' | 'error'>('success');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [copied, setCopied] = useState(false);
  const friendsRef = useRef<Friend[]>([]);
  // 收件箱游标放 ref（而非 state）：pullSync 保持稳定引用，WS 效应不会
  // 随每次游标推进重建连接（每事件一次 close/重连的抖动，审查发现 #2）。
  // null = 首次同步：服务端从 device_cursors 恢复（P1-6 重启增量，不重放历史）
  const lastSeqRef = useRef<number | null>(null);
  // 单飞守卫：轮询与 inbox.delivered 并发时同一批事件只拉一次（审查发现 #4）
  const syncingRef = useRef(false);

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
    if (syncingRef.current) return; // 进行中直接 return（轮询与实时推送并发去重）
    syncingRef.current = true;
    try {
      // 9.5 慢路径补齐：循环分页直到追上最新（断线 72h+/序列缺口时一次性补游标）
      const { items, nextInboxSeq } = await syncAfter(lastSeqRef.current);
      if (items.length > 0) {
        setEvents((previous) => [...previous, ...items].slice(-20));
      }
      // 无论有无新事件都推进游标（首次 null → 服务端游标值；下次起增量）
      lastSeqRef.current = nextInboxSeq;
    } catch {
      // 实时连接或下一次轮询会继续补齐。
    } finally {
      syncingRef.current = false;
    }
  }, []);

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
      onStatus: (status) => {
        // 云端可达性 → 桌宠在线状态：断线时星屿给"网络不在，我先陪你"气泡
        //（connecting 不改变状态，避免重连抖动反复切 OFFLINE/ONLINE）
        if (status === 'connected' || status === 'disconnected') {
          window.pet?.petRuntime?.setOnline?.(status === 'connected');
        }
      },
    });
    client.connect();
    return () => client.close();
  }, [pullSync, refreshFriends]);

  useEffect(() => {
    for (const entry of events) {
      if (seenSocialEventIds.has(entry.event.eventId)) continue;
      const payload = (entry.event.payload ?? {}) as Record<string, unknown>;
      switch (entry.event.type) {
        case 'gift.snack_sent': {
          seenSocialEventIds.add(entry.event.eventId);
          const gift = parseGiftPayload(entry.event.payload);
          if (!gift) continue;
          const from = friendsRef.current.find((friend) => friend.userId === gift.fromUserId);
          window.pet?.petRuntime?.socialEvent({
            type: 'gift.snack_sent',
            giftId: gift.giftId,
            snackId: gift.snackId,
            fromUserId: gift.fromUserId,
            ...(from ? { fromNickname: from.nickname } : {}),
          });
          break;
        }
        case 'visit.arrived': {
          // P0-2 拜访收口：桌宠对"好友来串门"做出欢迎反应（协议 visit.arrived 变体）
          seenSocialEventIds.add(entry.event.eventId);
          if (
            typeof payload.visitId !== 'string' ||
            typeof payload.fromUserId !== 'string' ||
            typeof payload.type !== 'string'
          ) {
            break;
          }
          const visitType: 'wave' | 'share_snack' | 'leave_message' =
            payload.type === 'wave' ||
            payload.type === 'share_snack' ||
            payload.type === 'leave_message'
              ? payload.type
              : 'wave';
          const from = friendsRef.current.find((friend) => friend.userId === payload.fromUserId);
          window.pet?.petRuntime?.socialEvent({
            type: 'visit.arrived',
            visitId: payload.visitId,
            visitType,
            fromUserId: payload.fromUserId,
            ...(from ? { fromNickname: from.nickname } : {}),
          });
          break;
        }
        case 'presence.changed': {
          // 9.2 Presence：好友在线标识增量更新；上线时桌宠欢迎（下线只静默更新）
          seenSocialEventIds.add(entry.event.eventId);
          if (typeof payload.userId !== 'string' || typeof payload.online !== 'boolean') break;
          const presenceUserId: string = payload.userId;
          const online: boolean = payload.online;
          setFriends((previous) =>
            previous.map((friend) =>
              friend.userId === presenceUserId ? { ...friend, online } : friend,
            ),
          );
          if (online) {
            const from = friendsRef.current.find((friend) => friend.userId === presenceUserId);
            window.pet?.petRuntime?.socialEvent({
              type: 'friend.online',
              friendUserId: presenceUserId,
              ...(from ? { friendNickname: from.nickname } : {}),
            });
          }
          break;
        }
      }
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
      <ViewHeading
        avatar={<CharacterVisual />}
        eyebrow={`${config.petName}小圈子`}
        title="好友"
        headingId="friends-title"
        actions={
          <button className="secondary-button" onClick={() => void createInvite()}>
            <UsersRound size={16} aria-hidden="true" />
            邀请好友
          </button>
        }
      />

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
        <div className="state-block" role="status">
          <span className="soft-loader" aria-hidden="true" />
          <p>正在看看谁在线上…</p>
        </div>
      ) : loadError ? (
        <div className="state-block">
          <p>暂时没能连上好友列表。</p>
          <button className="secondary-button" onClick={() => void refreshFriends()}>
            <RefreshCw size={15} aria-hidden="true" />
            再试一次
          </button>
        </div>
      ) : (
        <ul className="friend-list">
          {friends.length === 0 && (
            <li className="state-block state-block--empty">
              <span className="friends-empty__character" aria-hidden="true">
                <CharacterVisual />
              </span>
              <strong>小圈子还空着</strong>
              <p>邀请一位好友，一起给{config.petName}送点心、串串门。</p>
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
              <span>{eventLabel(entry, friends, config.petName)}</span>
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
  // 7.4 羁绊（旧服务端缺省时按初识/0 展示）
  const bond = friend.bond ?? { stage: 'first_meet' as const, progress: 0 };

  return (
    <li className="friend-item">
      <div className="friend-identity">
        <span className="friend-avatar" aria-hidden="true">
          {friend.nickname.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <strong>
            {friend.nickname}
            {friend.userId !== userId && (
              <span
                className={`friend-presence${friend.online ? ' friend-presence--online' : ''}`}
                aria-label={friend.online ? '在线' : '离线'}
                title={friend.online ? '在线' : '离线'}
              />
            )}
          </strong>
          <span>
            {friend.userId === userId
              ? '这是你'
              : `${friend.online ? '在线中' : '可以互送心意'} · 羁绊${bondStageLabels[bond.stage] ?? '初识'} ${bond.progress}`}
          </span>
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
            className="primary-button"
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
            className="primary-button"
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
