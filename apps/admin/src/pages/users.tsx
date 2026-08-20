import { useCallback, useEffect, useRef, useState } from 'react';

import {
  adminApi,
  type AdminDevice,
  type AdminUserDetail,
  type AdminUserSummary,
  type UsageRow,
  type UserPets,
  type UserSocial,
} from '../api.js';
import { downloadCsv } from '../csv.js';
import { Pagination } from '../pagination.js';

const PAGE_SIZE = 50;

/** 相对时间展示：1 分钟内"刚刚"，24 小时内"N 小时前"，更早显示日期 */
function fmtRelative(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return iso.slice(0, 10);
}

/** 搜索防抖：输入停止 300ms 后才触发查询 */
function useDebounced(value: string, delay = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

interface ChatSummaryRow {
  messageId: string;
  role: string;
  createdAt: string;
  summary: string;
}

interface MemorySummaryRow {
  memoryId: string;
  category: string;
  sensitivity: string;
  createdAt: string;
  summary: string;
}

const SORT_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'created_desc', label: '注册时间（新→旧）' },
  { key: 'created_asc', label: '注册时间（旧→新）' },
  { key: 'last_seen_desc', label: '最后在线（近→远）' },
  { key: 'device_desc', label: '设备数（多→少）' },
];

export function UsersPage() {
  const [keyword, setKeyword] = useState('');
  const debouncedKeyword = useDebounced(keyword);
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('created_desc');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: AdminUserSummary[]; total: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selected, setSelected] = useState<AdminUserDetail | null>(null);
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [usage, setUsage] = useState<UsageRow[] | null>(null);
  const [chatSummaries, setChatSummaries] = useState<ChatSummaryRow[] | null>(null);
  const [memorySummaries, setMemorySummaries] = useState<MemorySummaryRow[] | null>(null);
  const [social, setSocial] = useState<UserSocial | null>(null);
  const [petsInfo, setPetsInfo] = useState<UserPets | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 响应序号防护：快速输入/翻页触发多次请求时，旧响应晚到不再覆盖新结果
  const loadSeq = useRef(0);
  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    const params: Record<string, string> = { page: String(page), pageSize: String(PAGE_SIZE) };
    if (debouncedKeyword.trim()) params.q = debouncedKeyword.trim();
    if (status) params.status = status;
    if (sort) params.sort = sort;
    adminApi
      .users(params)
      .then((d) => {
        if (seq === loadSeq.current) setData(d);
      })
      .catch((e: Error) => {
        if (seq === loadSeq.current) setError(e.message);
      });
  }, [debouncedKeyword, status, sort, page]);

  useEffect(load, [load]);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setSelected(null);
    setUsage(null);
    setChatSummaries(null);
    setMemorySummaries(null);
    setSocial(null);
    setPetsInfo(null);
  }, []);

  // Esc 关闭详情抽屉
  useEffect(() => {
    if (!detailOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDetail();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailOpen, closeDetail]);

  const openDetail = async (userId: string) => {
    setError(null);
    setDetailOpen(true);
    setDetailLoading(true);
    const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    // 用量/摘要/社交/宠物失败不阻塞详情打开（降级为空列表）
    const [detail, devs, usageRes, chats, mems, social, petsInfo] = await Promise.all([
      adminApi.userDetail(userId),
      adminApi.userDevices(userId),
      adminApi.usageForUser(userId, weekAgo, today).catch(() => ({ items: [] as UsageRow[] })),
      adminApi.chatSummary(userId).catch(() => ({ items: [] as ChatSummaryRow[] })),
      adminApi.memoriesSummary(userId).catch(() => ({ items: [] as MemorySummaryRow[] })),
      adminApi
        .userSocial(userId)
        .catch(() => ({ gifts: [], visits: [], friendships: [] }) as UserSocial),
      adminApi.userPets(userId).catch(() => ({ pets: [], bonds: [] }) as UserPets),
    ]);
    setSelected(detail);
    setDevices(devs.items);
    setUsage(usageRes.items);
    setChatSummaries(chats.items);
    setMemorySummaries(mems.items);
    setSocial(social);
    setPetsInfo(petsInfo);
    setDetailLoading(false);
  };

  const act = async (fn: () => Promise<unknown>, okMessage: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(okMessage);
      if (selected) await openDetail(selected.userId);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const suspend = () => {
    if (!selected) return;
    const reason = window.prompt('暂停原因（必填，将写入审计）：');
    if (reason === null) return;
    if (!reason.trim()) {
      setError('暂停必须填写原因');
      return;
    }
    void act(() => adminApi.suspendUser(selected.userId, reason.trim()), '账号已暂停');
  };

  const restore = () => {
    if (!selected) return;
    if (!window.confirm('确认恢复该账号登录能力？已撤销的设备不会被恢复。')) return;
    void act(() => adminApi.restoreUser(selected.userId), '账号已恢复');
  };

  /* ---- 批量操作 ---- */

  const toggleSelect = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const pageIds = (data?.items ?? []).map((u) => u.userId);
      const allSelected = pageIds.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of pageIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const batchSuspend = () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const reason = window.prompt(`批量暂停 ${ids.length} 个账号。暂停原因（必填，将写入审计）：`);
    if (reason === null) return;
    if (!reason.trim()) {
      setError('暂停必须填写原因');
      return;
    }
    setSelectedIds(new Set());
    void act(async () => {
      const results = await Promise.allSettled(
        ids.map((id) => adminApi.suspendUser(id, reason.trim())),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) throw new Error(`批量暂停：${ids.length - failed} 成功，${failed} 失败`);
    }, `已批量暂停 ${ids.length} 个账号`);
  };

  const batchRestore = () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!window.confirm(`确认恢复选中的 ${ids.length} 个账号？已撤销的设备不会被恢复。`)) return;
    setSelectedIds(new Set());
    void act(async () => {
      const results = await Promise.allSettled(ids.map((id) => adminApi.restoreUser(id)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) throw new Error(`批量恢复：${ids.length - failed} 成功，${failed} 失败`);
    }, `已恢复 ${ids.length} 个账号`);
  };

  const pageIds = (data?.items ?? []).map((u) => u.userId);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));

  const exportCsv = () => {
    const rows = data?.items ?? [];
    downloadCsv(
      `users-${new Date().toISOString().slice(0, 10)}.csv`,
      ['邮箱', '昵称', '状态', '设备数', '在线', '注册时间', '最后在线'],
      rows.map((u) => [
        u.email,
        u.nickname ?? '',
        u.accountStatus,
        u.deviceCount,
        u.online ? '在线' : '',
        u.createdAt.slice(0, 10),
        u.lastSeenAt ? fmtRelative(u.lastSeenAt) : '',
      ]),
    );
  };

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>用户管理</h2>
          <p className="page-desc">搜索与管理注册用户、设备与账号状态</p>
        </div>
        <button onClick={exportCsv} disabled={!data || data.items.length === 0}>
          导出 CSV
        </button>
      </div>
      <div className="toolbar">
        <input
          placeholder="搜索邮箱 / 昵称 / userId"
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setPage(1); // 筛选变化回到第 1 页，避免停留在超出总页数的旧页码
          }}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          aria-label="状态筛选"
        >
          <option value="">全部状态</option>
          <option value="active">正常</option>
          <option value="suspended">已暂停</option>
        </select>
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(1);
          }}
          aria-label="排序"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="page-notice" role="status">
          {notice}
        </p>
      )}
      {selectedIds.size > 0 && (
        <div className="batch-bar">
          <span className="batch-count">已选 {selectedIds.size} 个用户</span>
          <button onClick={batchSuspend} disabled={busy}>
            批量暂停
          </button>
          <button onClick={batchRestore} disabled={busy}>
            批量恢复
          </button>
          <button onClick={() => setSelectedIds(new Set())} disabled={busy}>
            取消选择
          </button>
        </div>
      )}
      {!error && !data && <p className="muted">加载中…</p>}
      <div className="table-panel">
        <table className="data-table">
          <thead>
            <tr>
              <th className="col-check">
                <input
                  type="checkbox"
                  aria-label="全选当前页"
                  checked={allPageSelected}
                  onChange={toggleSelectAll}
                />
              </th>
              <th>邮箱</th>
              <th>昵称</th>
              <th>状态</th>
              <th>设备数</th>
              <th>在线</th>
              <th>注册时间</th>
              <th>最后在线</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((u) => (
              <tr key={u.userId} className={selectedIds.has(u.userId) ? 'row-selected' : undefined}>
                <td className="col-check">
                  <input
                    type="checkbox"
                    aria-label={`选择 ${u.email}`}
                    checked={selectedIds.has(u.userId)}
                    onChange={() => toggleSelect(u.userId)}
                  />
                </td>
                <td className="cell-strong">{u.email}</td>
                <td>{u.nickname ?? '—'}</td>
                <td>
                  <span className={u.accountStatus === 'active' ? 'pill ok' : 'pill danger'}>
                    {u.accountStatus === 'active' ? '正常' : '已暂停'}
                  </span>
                </td>
                <td>{u.deviceCount}</td>
                <td>{u.online ? <span className="pill ok">在线</span> : '—'}</td>
                <td>{u.createdAt.slice(0, 10)}</td>
                <td className="mono">{fmtRelative(u.lastSeenAt)}</td>
                <td>
                  <button
                    onClick={() =>
                      void openDetail(u.userId).catch((e: Error) => setError(e.message))
                    }
                  >
                    详情
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && data.items.length === 0 && <p className="muted">暂无数据</p>}
      <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onChange={setPage} />

      {detailOpen && (
        <>
          <div className="drawer-overlay" onClick={closeDetail} aria-hidden="true" />
          <div className="drawer" role="dialog" aria-label="用户详情">
            {/* Hero 头部：头像 + 邮箱 + 状态 + 设备数 */}
            <div className="drawer-hero">
              <div className="drawer-hero-avatar">
                {selected ? selected.email.slice(0, 1).toUpperCase() : '…'}
              </div>
              <div className="drawer-hero-info">
                <span className="drawer-hero-email">{selected?.email ?? '加载中…'}</span>
                {selected && (
                  <span className={selected.accountStatus === 'active' ? 'pill ok' : 'pill danger'}>
                    {selected.accountStatus === 'active' ? '正常' : '已暂停'}
                  </span>
                )}
                {selected && <span className="pill muted">{devices.length} 台设备</span>}
              </div>
              <button className="drawer-close" onClick={closeDetail} title="关闭" aria-label="关闭">
                ✕
              </button>
            </div>

            <div className="drawer-content">
              {/* 基本信息（加载中显示骨架） */}
              <dl className="detail-list">
                {!selected ? (
                  <>
                    <div className="skeleton-line" />
                    <div className="skeleton-line" />
                    <div className="skeleton-line" />
                  </>
                ) : (
                  <>
                    <div>
                      <dt>userId</dt>
                      <dd>{selected.userId}</dd>
                    </div>
                    {selected.suspendedReason && (
                      <div>
                        <dt>暂停原因</dt>
                        <dd>{selected.suspendedReason}</dd>
                      </div>
                    )}
                    <div>
                      <dt>7 天聊天请求</dt>
                      <dd>{selected.chatRequests7d.toLocaleString('zh-CN')}</dd>
                    </div>
                    <div>
                      <dt>最后在线</dt>
                      <dd>{fmtRelative(selected.lastSeenAt)}</dd>
                    </div>
                    <div>
                      <dt>宠物 / 好友 / 记忆</dt>
                      <dd>
                        {selected.petCount} / {selected.friendCount} / {selected.memoryCount}
                      </dd>
                    </div>
                  </>
                )}
              </dl>

              {selected && (
                <div className="drawer-actions">
                  {selected.accountStatus === 'active' ? (
                    <button className="danger" onClick={suspend}>
                      暂停账号
                    </button>
                  ) : (
                    <button onClick={restore}>恢复账号</button>
                  )}
                </div>
              )}

              {/* 设备 */}
              <div className="section-card">
                <h4>设备</h4>
                {detailLoading ? (
                  <div className="table-skeleton" aria-hidden="true">
                    <div className="table-skeleton-row" />
                    <div className="table-skeleton-row" />
                  </div>
                ) : (
                  <div className="table-panel">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>平台</th>
                          <th>版本</th>
                          <th>最后在线</th>
                          <th>状态</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {devices.map((d) => (
                          <tr key={d.deviceId}>
                            <td>{d.platform}</td>
                            <td>{d.appVersion ?? '—'}</td>
                            <td>{fmtRelative(d.lastSeenAt)}</td>
                            <td>
                              {d.revokedAt ? (
                                <span className="pill muted">已撤销</span>
                              ) : (
                                <span className="pill ok">正常</span>
                              )}
                            </td>
                            <td>
                              {!d.revokedAt && (
                                <button
                                  className="danger"
                                  onClick={() => {
                                    if (window.confirm('确认撤销该设备？其会话将立即失效。')) {
                                      void act(
                                        () => adminApi.revokeDevice(d.deviceId),
                                        '设备已撤销',
                                      );
                                    }
                                  }}
                                >
                                  撤销
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 近 7 天用量 */}
              <div className="section-card">
                <h4>近 7 天用量</h4>
                {detailLoading ? (
                  <div className="table-skeleton" aria-hidden="true">
                    <div className="table-skeleton-row" />
                  </div>
                ) : (
                  <>
                    <div className="table-panel">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>日期</th>
                            <th>请求数</th>
                            <th>token 估算</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(usage ?? []).map((r) => (
                            <tr key={r.usageDate}>
                              <td>{r.usageDate}</td>
                              <td>{r.requests.toLocaleString('zh-CN')}</td>
                              <td>{r.tokens.toLocaleString('zh-CN')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {usage && usage.length === 0 && <p className="muted">暂无用量数据</p>}
                  </>
                )}
              </div>

              {/* 聊天摘要 */}
              <div className="section-card">
                <h4>最近聊天（脱敏摘要）</h4>
                {detailLoading ? (
                  <div className="table-skeleton" aria-hidden="true">
                    <div className="table-skeleton-row" />
                    <div className="table-skeleton-row" />
                  </div>
                ) : (
                  <>
                    <div className="table-panel">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>时间</th>
                            <th>角色</th>
                            <th>摘要（脱敏）</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(chatSummaries ?? []).map((r) => (
                            <tr key={r.messageId}>
                              <td>{r.createdAt.slice(0, 19).replace('T', ' ')}</td>
                              <td>{r.role}</td>
                              <td>{r.summary}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {chatSummaries && chatSummaries.length === 0 && (
                      <p className="muted">暂无聊天记录</p>
                    )}
                  </>
                )}
              </div>

              {/* 记忆摘要 */}
              <div className="section-card">
                <h4>记忆摘要（脱敏）</h4>
                {detailLoading ? (
                  <div className="table-skeleton" aria-hidden="true">
                    <div className="table-skeleton-row" />
                    <div className="table-skeleton-row" />
                  </div>
                ) : (
                  <>
                    <div className="table-panel">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>时间</th>
                            <th>分类</th>
                            <th>敏感度</th>
                            <th>摘要（脱敏）</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(memorySummaries ?? []).map((r) => (
                            <tr key={r.memoryId}>
                              <td>{r.createdAt.slice(0, 19).replace('T', ' ')}</td>
                              <td>{r.category}</td>
                              <td>{r.sensitivity}</td>
                              <td>{r.summary}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {memorySummaries && memorySummaries.length === 0 && (
                      <p className="muted">暂无记忆</p>
                    )}
                  </>
                )}
              </div>

              {/* 宠物与羁绊 */}
              <div className="section-card">
                <h4>宠物与羁绊</h4>
                {detailLoading ? (
                  <div className="table-skeleton" aria-hidden="true">
                    <div className="table-skeleton-row" />
                  </div>
                ) : (
                  <>
                    {petsInfo && petsInfo.pets.length > 0 && (
                      <p className="drawer-petline">
                        {petsInfo.pets.map((p) => (
                          <span className="pill" key={p.petId}>
                            {p.name}
                            <small className="muted">（{p.personalityMode}）</small>
                          </span>
                        ))}
                      </p>
                    )}
                    {petsInfo && petsInfo.bonds.length > 0 ? (
                      <div className="table-panel">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>对方</th>
                              <th>宠物</th>
                              <th>阶段</th>
                              <th>进度</th>
                              <th>状态</th>
                            </tr>
                          </thead>
                          <tbody>
                            {petsInfo.bonds.map((b) => (
                              <tr key={b.bondId}>
                                <td className="cell-strong">{b.friendEmail}</td>
                                <td>
                                  {b.ownPetName} ↔ {b.friendPetName}
                                </td>
                                <td>
                                  <span
                                    className={
                                      b.stage === 'trusted'
                                        ? 'pill ok'
                                        : b.stage === 'familiar'
                                          ? 'pill muted'
                                          : 'pill'
                                    }
                                  >
                                    {b.stage === 'trusted'
                                      ? '默契朋友'
                                      : b.stage === 'familiar'
                                        ? '熟悉伙伴'
                                        : '初次见面'}
                                  </span>
                                </td>
                                <td>{b.progress}</td>
                                <td>{b.status === 'active' ? '活跃' : b.status}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="muted">暂无宠物或羁绊</p>
                    )}
                  </>
                )}
              </div>

              {/* 互动历史（礼物 / 拜访 / 好友关系） */}
              <div className="section-card">
                <h4>互动历史</h4>
                {detailLoading ? (
                  <div className="table-skeleton" aria-hidden="true">
                    <div className="table-skeleton-row" />
                    <div className="table-skeleton-row" />
                  </div>
                ) : (
                  <>
                    {social && social.gifts.length > 0 && (
                      <>
                        <p className="muted drawer-sublabel">礼物（近 20 条）</p>
                        <div className="table-panel">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>时间</th>
                                <th>方向</th>
                                <th>对方</th>
                                <th>点心</th>
                                <th>状态</th>
                              </tr>
                            </thead>
                            <tbody>
                              {social.gifts.map((g) => (
                                <tr key={g.giftId}>
                                  <td>{g.createdAt.slice(0, 10)}</td>
                                  <td>{g.direction === 'sent' ? '送出' : '收到'}</td>
                                  <td className="cell-strong">{g.peerEmail ?? '—'}</td>
                                  <td className="mono">{g.snackId}</td>
                                  <td>{g.status}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                    {social && social.visits.length > 0 && (
                      <>
                        <p className="muted drawer-sublabel">拜访（近 20 条）</p>
                        <div className="table-panel">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>时间</th>
                                <th>方向</th>
                                <th>对方</th>
                                <th>类型</th>
                                <th>状态</th>
                              </tr>
                            </thead>
                            <tbody>
                              {social.visits.map((v) => (
                                <tr key={v.visitId}>
                                  <td>{v.createdAt.slice(0, 10)}</td>
                                  <td>{v.direction === 'sent' ? '发起' : '收到'}</td>
                                  <td className="cell-strong">{v.peerEmail ?? '—'}</td>
                                  <td>{v.type}</td>
                                  <td>{v.status}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                    {social && social.friendships.length > 0 && (
                      <>
                        <p className="muted drawer-sublabel">好友关系</p>
                        <div className="table-panel">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>好友</th>
                                <th>状态</th>
                                <th>建立时间</th>
                              </tr>
                            </thead>
                            <tbody>
                              {social.friendships.map((f) => (
                                <tr key={f.friendshipId}>
                                  <td className="cell-strong">{f.friendEmail}</td>
                                  <td>
                                    <span
                                      className={f.status === 'active' ? 'pill ok' : 'pill muted'}
                                    >
                                      {f.status}
                                    </span>
                                  </td>
                                  <td>{f.acceptedAt ? f.acceptedAt.slice(0, 10) : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                    {social &&
                      social.gifts.length === 0 &&
                      social.visits.length === 0 &&
                      social.friendships.length === 0 && <p className="muted">暂无互动记录</p>}
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
