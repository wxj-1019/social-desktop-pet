import { useCallback, useEffect, useState } from 'react';

import { adminApi, type AdminDevice, type AdminUserDetail, type AdminUserSummary } from '../api.js';

export function UsersPage() {
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [data, setData] = useState<{ items: AdminUserSummary[]; total: number } | null>(null);
  const [selected, setSelected] = useState<AdminUserDetail | null>(null);
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    const params: Record<string, string> = { page: '1', pageSize: '50' };
    if (keyword.trim()) params.q = keyword.trim();
    if (status) params.status = status;
    adminApi
      .users(params)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [keyword, status]);

  useEffect(load, [load]);

  const openDetail = async (userId: string) => {
    setError(null);
    const [detail, devs] = await Promise.all([
      adminApi.userDetail(userId),
      adminApi.userDevices(userId),
    ]);
    setSelected(detail);
    setDevices(devs.items);
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
      <h2>用户管理</h2>
      <div className="toolbar">
        <input
          placeholder="搜索邮箱 / 昵称 / userId"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
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
              <td>{u.accountStatus === 'active' ? '正常' : '已暂停'}</td>
              <td>{u.deviceCount}</td>
              <td>{u.online ? '在线' : '—'}</td>
              <td>{u.createdAt.slice(0, 10)}</td>
              <td>
                <button
                  onClick={() => void openDetail(u.userId).catch((e: Error) => setError(e.message))}
                >
                  详情
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">共 {data?.total ?? 0} 人（单页最多 50）</p>

      {selected && (
        <div className="drawer" role="dialog" aria-label="用户详情">
          <div className="drawer-head">
            <h3>{selected.email}</h3>
            <button onClick={() => setSelected(null)}>关闭</button>
          </div>
          <dl className="detail-list">
            <dt>userId</dt>
            <dd>{selected.userId}</dd>
            <dt>账号状态</dt>
            <dd>{selected.accountStatus === 'active' ? '正常' : '已暂停'}</dd>
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
                  <td>{d.revokedAt ? '已撤销' : '正常'}</td>
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
      )}
    </section>
  );
}
