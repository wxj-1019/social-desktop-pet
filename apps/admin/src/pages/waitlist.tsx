import { useCallback, useEffect, useState } from 'react';

import { adminApi, type WaitlistRow } from '../api.js';

export function WaitlistPage() {
  const [status, setStatus] = useState('');
  const [data, setData] = useState<{ items: WaitlistRow[]; total: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const params: Record<string, string> = { page: '1', pageSize: '50' };
    if (status) params.status = status;
    adminApi
      .waitlist(params)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [status]);

  useEffect(load, [load]);

  const invite = async (row: WaitlistRow) => {
    setError(null);
    setNotice(null);
    try {
      const result = await adminApi.inviteWaitlist(row.id);
      setNotice(result.code ? `已邀请 ${row.email}，兑换码 ${result.code}` : `已邀请 ${row.email}`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const expire = async (row: WaitlistRow) => {
    if (!window.confirm(`确认将 ${row.email} 的邀请标记为过期？`)) return;
    setError(null);
    setNotice(null);
    try {
      await adminApi.expireWaitlist(row.id);
      setNotice(`已过期：${row.email}`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="page">
      <h2>运营邀请</h2>
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">全部状态</option>
          <option value="pending">待邀请</option>
          <option value="invited">已邀请</option>
          <option value="joined">已加入</option>
          <option value="expired">已过期</option>
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
            <th>状态</th>
            <th>报名时间</th>
            <th>邀请时间</th>
            <th>兑换时间</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data?.items.map((row) => (
            <tr key={row.id}>
              <td>{row.email}</td>
              <td>{row.status}</td>
              <td>{row.createdAt.slice(0, 10)}</td>
              <td>{row.invitedAt ? row.invitedAt.slice(0, 10) : '—'}</td>
              <td>{row.claimedAt ? row.claimedAt.slice(0, 10) : '—'}</td>
              <td>
                {row.status === 'pending' && (
                  <button onClick={() => void invite(row)}>发放邀请</button>
                )}
                {row.status === 'invited' && (
                  <button onClick={() => void expire(row)}>标记过期</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">共 {data?.total ?? 0} 条（单页最多 50）</p>
    </section>
  );
}
