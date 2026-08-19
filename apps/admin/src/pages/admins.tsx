import { useCallback, useEffect, useState } from 'react';

import { adminApi, AdminApiError } from '../api.js';

interface AdminRow {
  id: string;
  email: string;
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string;
}

/** 密码强度评分（0-4）：长度 ≥12 + 大小写 + 数字 + 特殊字符 */
function passwordStrength(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  return score;
}

const STRENGTH_LABELS = ['', '较弱', '一般', '较强', '很强'];

/**
 * 管理员页 —— 账号生命周期（停用/启用）与自助改密。
 * 停用即撤会话（服务端同事务）；自锁保护由服务端兜底（不能停用自己/最后一个 active）。
 */
export function AdminsPage() {
  const [items, setItems] = useState<AdminRow[] | null>(null);
  const [meId, setMeId] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    adminApi
      .admins()
      .then((r) => setItems(r.items))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    adminApi
      .me()
      .then((r) => setMeId(r.admin.id))
      .catch(() => undefined);
  }, [load]);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setNotice(null);
    if (next.length < 12) {
      setError('新密码至少 12 位');
      return;
    }
    if (next !== confirm) {
      setError('两次输入的新密码不一致');
      return;
    }
    setBusy(true);
    try {
      await adminApi.changePassword(current, next);
      setNotice('密码已更新；本人全部会话已撤销，请使用新密码重新登录。');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(
        err instanceof AdminApiError && err.code === 'invalid_credentials'
          ? '当前密码不正确'
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  const strength = passwordStrength(next);

  const toggle = async (row: AdminRow) => {
    if (busy) return;
    const disabling = row.status === 'active';
    if (
      !window.confirm(
        disabling
          ? `确认停用 ${row.email}？其全部会话将立即失效，无法登录后台。`
          : `确认恢复 ${row.email} 的后台登录能力？`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (disabling) {
        await adminApi.disableAdmin(row.id);
        setNotice(`已停用：${row.email}`);
      } else {
        await adminApi.enableAdmin(row.id);
        setNotice(`已恢复：${row.email}`);
      }
      load();
    } catch (err) {
      const code = err instanceof AdminApiError ? err.code : '';
      if (code === 'last_active_admin') setError('不能停用最后一个可用管理员（后台入口保护）');
      else if (code === 'cannot_disable_self') setError('不能停用当前登录的自己');
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>管理员</h2>
          <p className="page-desc">管理员账号生命周期与凭证安全；停用即撤销全部会话</p>
        </div>
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

      <h3>修改我的密码</h3>
      <form className="grant-form" onSubmit={(e) => void changePassword(e)}>
        <label>
          当前密码
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <label>
          新密码（≥12 位）
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            required
          />
          {next && (
            <span className="pw-strength">
              <span className="pw-strength-track">
                <span
                  className={`pw-strength-fill level-${strength}`}
                  style={{ width: `${(strength / 4) * 100}%` }}
                />
              </span>
              <span className="pw-strength-label">{STRENGTH_LABELS[strength]}</span>
            </span>
          )}
        </label>
        <label>
          确认新密码
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? '提交中…' : '更新密码'}
        </button>
      </form>

      <h3>管理员账号</h3>
      {!items && !error && <p className="muted">加载中…</p>}
      {items && (
        <div className="table-panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>邮箱</th>
                <th>状态</th>
                <th>最后登录</th>
                <th>创建时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.email}
                    {row.id === meId && <span className="pill">我</span>}
                  </td>
                  <td>
                    <span className={row.status === 'active' ? 'pill ok' : 'pill danger'}>
                      {row.status === 'active' ? '可用' : '已停用'}
                    </span>
                  </td>
                  <td>{row.lastLoginAt ? row.lastLoginAt.slice(0, 19).replace('T', ' ') : '—'}</td>
                  <td>{row.createdAt.slice(0, 10)}</td>
                  <td>
                    {row.id !== meId && (
                      <button
                        className={row.status === 'active' ? 'danger' : undefined}
                        disabled={busy}
                        onClick={() => void toggle(row)}
                      >
                        {row.status === 'active' ? '停用' : '恢复'}
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
