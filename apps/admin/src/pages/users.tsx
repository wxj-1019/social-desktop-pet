import { useCallback, useEffect, useRef, useState } from 'react';

import {
  adminApi,
  type AdminDevice,
  type AdminUserDetail,
  type AdminUserSummary,
  type UsageRow,
} from '../api.js';
import { Pagination } from '../pagination.js';

const PAGE_SIZE = 50;

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

export function UsersPage() {
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ items: AdminUserSummary[]; total: number } | null>(null);
  const [selected, setSelected] = useState<AdminUserDetail | null>(null);
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [usage, setUsage] = useState<UsageRow[] | null>(null);
  const [chatSummaries, setChatSummaries] = useState<ChatSummaryRow[] | null>(null);
  const [memorySummaries, setMemorySummaries] = useState<MemorySummaryRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 响应序号防护：快速输入/翻页触发多次请求时，旧响应晚到不再覆盖新结果
  const loadSeq = useRef(0);
  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    const params: Record<string, string> = { page: String(page), pageSize: String(PAGE_SIZE) };
    if (keyword.trim()) params.q = keyword.trim();
    if (status) params.status = status;
    adminApi
      .users(params)
      .then((d) => {
        if (seq === loadSeq.current) setData(d);
      })
      .catch((e: Error) => {
        if (seq === loadSeq.current) setError(e.message);
      });
  }, [keyword, status, page]);

  useEffect(load, [load]);

  const openDetail = async (userId: string) => {
    setError(null);
    const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    // 用量/摘要失败不阻塞详情打开（降级为空列表）
    const [detail, devs, usageRes, chats, mems] = await Promise.all([
      adminApi.userDetail(userId),
      adminApi.userDevices(userId),
      adminApi.usageForUser(userId, weekAgo, today).catch(() => ({ items: [] as UsageRow[] })),
      adminApi.chatSummary(userId).catch(() => ({ items: [] as ChatSummaryRow[] })),
      adminApi.memoriesSummary(userId).catch(() => ({ items: [] as MemorySummaryRow[] })),
    ]);
    setSelected(detail);
    setDevices(devs.items);
    setUsage(usageRes.items);
    setChatSummaries(chats.items);
    setMemorySummaries(mems.items);
  };

  const closeDetail = () => {
    setSelected(null);
    setUsage(null);
    setChatSummaries(null);
    setMemorySummaries(null);
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

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>用户管理</h2>
          <p className="page-desc">搜索与管理注册用户、设备与账号状态</p>
        </div>
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
        >
          <option value="">全部状态</option>
          <option value="active">正常</option>
          <option value="suspended">已暂停</option>
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
      {!error && !data && <p className="muted">加载中…</p>}
      <div className="table-panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>邮箱</th>
              <th>昵称</th>
              <th>状态</th>
              <th>设备数</th>
              <th>在线</th>
              <th>注册时间</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data?.items.map((u) => (
              <tr key={u.userId}>
                <td>{u.email}</td>
                <td>{u.nickname ?? '—'}</td>
                <td>
                  <span className={u.accountStatus === 'active' ? 'pill ok' : 'pill danger'}>
                    {u.accountStatus === 'active' ? '正常' : '已暂停'}
                  </span>
                </td>
                <td>{u.deviceCount}</td>
                <td>{u.online ? <span className="pill ok">在线</span> : '—'}</td>
                <td>{u.createdAt.slice(0, 10)}</td>
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

      {selected && (
        <>
          <div className="drawer-overlay" onClick={closeDetail} aria-hidden="true" />
          <div className="drawer" role="dialog" aria-label="用户详情">
            <div className="drawer-head">
              <h3>{selected.email}</h3>
              <button onClick={closeDetail}>关闭</button>
            </div>
            <dl className="detail-list">
              <dt>userId</dt>
              <dd>{selected.userId}</dd>
              <dt>账号状态</dt>
              <dd>
                <span className={selected.accountStatus === 'active' ? 'pill ok' : 'pill danger'}>
                  {selected.accountStatus === 'active' ? '正常' : '已暂停'}
                </span>
              </dd>
              {selected.suspendedReason && (
                <>
                  <dt>暂停原因</dt>
                  <dd>{selected.suspendedReason}</dd>
                </>
              )}
              <dt>7 天聊天请求</dt>
              <dd>{selected.chatRequests7d}</dd>
              <dt>最后在线</dt>
              <dd>{selected.lastSeenAt ? selected.lastSeenAt : '—'}</dd>
              <dt>宠物 / 好友 / 记忆</dt>
              <dd>
                {selected.petCount} / {selected.friendCount} / {selected.memoryCount}
              </dd>
            </dl>
            <div className="drawer-actions">
              {selected.accountStatus === 'active' ? (
                <button className="danger" onClick={suspend}>
                  暂停账号
                </button>
              ) : (
                <button onClick={restore}>恢复账号</button>
              )}
            </div>
            <h4>设备</h4>
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
                      <td>{d.lastSeenAt}</td>
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
                                void act(() => adminApi.revokeDevice(d.deviceId), '设备已撤销');
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

            <h4>近 7 天用量</h4>
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
                      <td>{r.requests}</td>
                      <td>{r.tokens}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {usage && usage.length === 0 && <p className="muted">暂无用量数据</p>}

            <h4>最近聊天（脱敏摘要）</h4>
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
            {chatSummaries && chatSummaries.length === 0 && <p className="muted">暂无聊天记录</p>}

            <h4>记忆摘要（脱敏）</h4>
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
            {memorySummaries && memorySummaries.length === 0 && <p className="muted">暂无记忆</p>}
          </div>
        </>
      )}
    </section>
  );
}
