/**
 * 管理 API 客户端：Bearer access token 只在内存；
 * 401 自动 refresh 一次（cookie）后重试，失败抛 AdminUnauthorized。
 */
let accessToken: string | null = null;

/** 单飞 refresh：并发 401 共享同一次 /auth/refresh 调用。
 *  服务端 refresh token 一次性轮换，并发调用只有一个能赢；
 *  共享 promise 让输家直接复用赢家的新 access token，避免误登出。 */
let refreshPromise: Promise<{ accessToken: string } | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

function refreshOnce(): Promise<{ accessToken: string } | null> {
  if (!refreshPromise) {
    refreshPromise = raw<{ accessToken: string }>('/auth/refresh', {
      method: 'POST',
      body: {},
      skipRefresh: true,
    })
      .then((r) => r)
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /** 429 限流响应的等待秒数（若服务端返回） */
    readonly retryAfterSec?: number,
  ) {
    super(code);
  }
}

export class AdminUnauthorized extends Error {
  constructor() {
    super('admin_unauthorized');
  }
}

/** 全局会话失效回调：refresh 失败（会话过期/被停用）时通知 App 返回登录页 */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  skipRefresh?: boolean;
  headers?: Record<string, string>;
}

async function raw<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (opts.headers) Object.assign(headers, opts.headers);
  const res = await fetch(`/admin${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (res.status === 401 && !opts.skipRefresh) {
    const refreshed = await refreshOnce();
    if (refreshed) {
      setAccessToken(refreshed.accessToken);
      // 401 = 服务端鉴权中间件已拒绝、动作未执行，重试一次安全（不会重复执行写操作）
      return raw<T>(path, { ...opts, skipRefresh: true });
    }
    unauthorizedHandler?.();
    throw new AdminUnauthorized();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      retryAfterSec?: number;
    };
    throw new AdminApiError(res.status, body.error ?? `http_${res.status}`, body.retryAfterSec);
  }
  return res.json() as Promise<T>;
}

export interface AdminUserSummary {
  userId: string;
  email: string;
  nickname: string | null;
  accountStatus: string;
  createdAt: string;
  deviceCount: number;
  online: boolean;
  lastSeenAt: string | null;
}

export interface AdminUserDetail extends AdminUserSummary {
  suspendedAt: string | null;
  suspendedReason: string | null;
  chatRequests7d: number;
  petCount: number;
  friendCount: number;
  memoryCount: number;
}

export interface AdminDevice {
  deviceId: string;
  platform: string;
  appVersion: string | null;
  lastSeenAt: string;
  revokedAt: string | null;
}

export interface UsageRow {
  usageDate: string;
  requests: number;
  tokens: number;
  fails: number;
  limitHits: number;
  model?: string | null;
}

export interface WaitlistRow {
  id: string;
  email: string;
  status: string;
  createdAt: string;
  invitedAt: string | null;
  inviteExpiresAt: string | null;
  claimedAt: string | null;
  inviteMailStatus: string;
  inviteMailAt: string | null;
}

export interface AuditRow {
  id: string;
  adminId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  reason: string | null;
  ip: string | null;
  createdAt: string;
}

/* ---- 社交互动（P0） ---- */

export interface SocialDailyRow {
  date: string;
  gifts: number;
  visits: number;
  newFriends: number;
  activeUsers: number;
}

export interface SocialEventRow {
  eventId: string;
  type: string;
  payload: Record<string, unknown>;
  fromEmail: string | null;
  toEmail: string | null;
  createdAt: string;
}

export interface UserSocial {
  gifts: Array<{
    giftId: string;
    snackId: string;
    status: string;
    direction: string;
    peerEmail: string | null;
    createdAt: string;
  }>;
  visits: Array<{
    visitId: string;
    type: string;
    status: string;
    direction: string;
    peerEmail: string | null;
    createdAt: string;
  }>;
  friendships: Array<{
    friendshipId: string;
    status: string;
    friendEmail: string;
    acceptedAt: string | null;
    createdAt: string;
  }>;
}

/* ---- 宠物与羁绊（P0） ---- */

export interface PetsStats {
  total: number;
  byCharacter: Record<string, number>;
  byPersonality: Array<{ mode: string; count: number }>;
  customNamed: number;
}

export interface BondsStats {
  total: number;
  active: number;
  byStage: Record<string, number>;
  avgProgress: number;
  topBonds: Array<{
    bondId: string;
    stage: string;
    progress: number;
    petAName: string;
    petBName: string;
    userAEmail: string;
    userBEmail: string;
  }>;
}

export interface UserPets {
  pets: Array<{ petId: string; characterId: string; name: string; personalityMode: string }>;
  bonds: Array<{
    bondId: string;
    stage: string;
    progress: number;
    status: string;
    ownPetName: string;
    friendPetName: string;
    friendEmail: string;
  }>;
}

/* ---- 记忆确认队列（P0） ---- */

export interface MemoryQueueStats {
  pending: number;
  confirmed7d: number;
  rejected7d: number;
  byCategory: Array<{ category: string; count: number }>;
  bySensitivity: Array<{ sensitivity: string; count: number }>;
}

export const adminApi = {
  login(email: string, password: string) {
    return raw<{ accessToken: string; admin: { id: string; email: string } }>('/auth/login', {
      method: 'POST',
      body: { email, password },
      // 凭证端点不触发 refresh：密码错误不应轮换（或失效）旧 refresh cookie
      skipRefresh: true,
    });
  },
  me() {
    return raw<{ admin: { id: string; email: string } }>('/auth/me');
  },
  logout() {
    return raw<{ ok: true }>('/auth/revoke', { method: 'POST', body: {} });
  },
  overview() {
    return raw<{
      totalUsers: number;
      onlineDevices: number;
      totalDevices: number;
      chatRequestsToday: number;
      chatRequests7d: number;
      signups7d: number;
      suspendedUsers: number;
      pendingInvites: number;
      chatFailsToday: number;
      limitHitsToday: number;
      chatFails7d: number;
      limitHits7d: number;
    }>('/overview');
  },
  overviewTrend() {
    return raw<{ items: Array<{ hour: string; messages: number }> }>('/overview/trend');
  },
  admins() {
    return raw<{
      items: Array<{
        id: string;
        email: string;
        status: 'active' | 'disabled';
        lastLoginAt: string | null;
        createdAt: string;
      }>;
    }>('/admins');
  },
  disableAdmin(id: string) {
    return raw<{ ok: true }>(`/admins/${id}/disable`, { method: 'POST', body: {} });
  },
  enableAdmin(id: string) {
    return raw<{ ok: true }>(`/admins/${id}/enable`, { method: 'POST', body: {} });
  },
  changePassword(currentPassword: string, newPassword: string) {
    return raw<{ ok: true }>('/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });
  },
  users(params: Record<string, string>) {
    const qs = new URLSearchParams(params).toString();
    return raw<{ total: number; page: number; pageSize: number; items: AdminUserSummary[] }>(
      `/users?${qs}`,
    );
  },
  userDetail(userId: string) {
    return raw<AdminUserDetail>(`/users/${userId}`);
  },
  userDevices(userId: string) {
    return raw<{ items: AdminDevice[] }>(`/users/${userId}/devices`);
  },
  suspendUser(userId: string, reason: string) {
    return raw<{ ok: true }>(`/users/${userId}/suspend`, { method: 'POST', body: { reason } });
  },
  restoreUser(userId: string) {
    return raw<{ ok: true }>(`/users/${userId}/restore`, { method: 'POST', body: {} });
  },
  revokeDevice(deviceId: string) {
    return raw<{ ok: true }>(`/devices/${deviceId}/revoke`, { method: 'POST', body: {} });
  },
  usage(from: string, to: string, model = '') {
    const qs = new URLSearchParams({ from, to });
    if (model) qs.set('model', model);
    return raw<{
      summary: { requests: number; tokens: number; fails: number; limitHits: number };
      items: UsageRow[];
    }>(`/usage?${qs}`);
  },

  /** 区间内实际使用过的模型列表（用量页模型筛选下拉的数据源） */
  usageModels(from: string, to: string) {
    return raw<{ models: string[] }>(`/usage/models?from=${from}&to=${to}`);
  },
  usageForUser(userId: string, from: string, to: string) {
    return raw<{ items: UsageRow[] }>(`/usage/users/${userId}?from=${from}&to=${to}`);
  },
  waitlist(params: Record<string, string>) {
    const qs = new URLSearchParams(params).toString();
    return raw<{ total: number; page: number; pageSize: number; items: WaitlistRow[] }>(
      `/waitlist?${qs}`,
    );
  },
  inviteWaitlist(id: string) {
    return raw<{ ok: true; code?: string }>(`/waitlist/${id}/invite`, {
      method: 'POST',
      body: {},
    });
  },
  expireWaitlist(id: string) {
    return raw<{ ok: true }>(`/waitlist/${id}/expire`, { method: 'POST', body: {} });
  },
  auditLog(params: Record<string, string>) {
    const qs = new URLSearchParams(params).toString();
    return raw<{ total: number; page: number; pageSize: number; items: AuditRow[] }>(
      `/audit-log?${qs}`,
    );
  },
  chatSummary(userId: string, params?: { from?: string; to?: string }) {
    const qs = new URLSearchParams({ page: '1', pageSize: '50' });
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    return raw<{
      items: Array<{ messageId: string; role: string; createdAt: string; summary: string }>;
    }>(`/users/${userId}/chat-summary?${qs}`);
  },
  memoriesSummary(userId: string, params?: { status?: string }) {
    const qs = new URLSearchParams({ page: '1', pageSize: '50' });
    if (params?.status) qs.set('status', params.status);
    return raw<{
      items: Array<{
        memoryId: string;
        category: string;
        sensitivity: string;
        createdAt: string;
        summary: string;
      }>;
    }>(`/users/${userId}/memories-summary?${qs}`);
  },
  createSensitiveAccess(body: {
    targetUserId: string;
    resourceType: 'chat' | 'private_memory' | 'bond_memory';
    reason: string;
    scope: Record<string, unknown>;
  }) {
    return raw<{ grantId: string; token: string; expiresAt: string }>('/sensitive-access', {
      method: 'POST',
      body,
    });
  },
  sensitiveContent(grantId: string, token: string) {
    return raw<{ resourceType: string; items: Array<Record<string, unknown>> }>(
      `/sensitive-access/${grantId}/content`,
      { headers: { 'x-grant-token': token } },
    );
  },

  /* ---- 社交互动（P0） ---- */

  socialDaily(from: string, to: string) {
    return raw<{
      summary: { gifts: number; visits: number; newFriends: number; activeUsers: number };
      items: SocialDailyRow[];
    }>(`/social/daily?from=${from}&to=${to}`);
  },

  socialEvents(params: Record<string, string>) {
    const qs = new URLSearchParams(params).toString();
    return raw<{ total: number; page: number; pageSize: number; items: SocialEventRow[] }>(
      `/social/events?${qs}`,
    );
  },

  userSocial(userId: string) {
    return raw<UserSocial>(`/users/${userId}/social`);
  },

  /* ---- 宠物与羁绊（P0） ---- */

  petsStats() {
    return raw<PetsStats>('/pets/stats');
  },

  bondsStats() {
    return raw<BondsStats>('/bonds/stats');
  },

  userPets(userId: string) {
    return raw<UserPets>(`/users/${userId}/pets`);
  },

  /* ---- 记忆确认队列（P0） ---- */

  memoryQueueStats() {
    return raw<MemoryQueueStats>('/memories/queue-stats');
  },
};
