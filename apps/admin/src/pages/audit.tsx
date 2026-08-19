import { useCallback, useEffect, useRef, useState } from 'react';

import { adminApi, type AuditRow } from '../api.js';
import { Pagination } from '../pagination.js';

const PAGE_SIZE = 100;

const ACTION_LABELS: Record<string, string> = {
  'admin.login': '管理员登录',
  'admin.login_failed': '登录失败',
  'admin.login_rejected': '登录被拒（已停用）',
  'admin.refresh': '刷新会话',
  'admin.revoke': '退出登录',
  'admin.disable': '停用管理员',
  'admin.enable': '恢复管理员',
  'admin.password_change': '修改密码',
  'user.suspend': '暂停账号',
  'user.restore': '恢复账号',
  'device.revoke': '撤销设备',
  'waitlist.invite': '发放邀请',
  'waitlist.expire': '邀请过期',
  'sensitive.grant': '敏感授权',
  'sensitive.read': '敏感读取',
};

const RESOURCE_TYPES = [
  'admin',
  'user',
  'device',
  'waitlist',
  'chat',
  'private_memory',
  'bond_memory',
];

export function AuditPage() {
  const [rows, setRows] = useState<{ items: AuditRow[]; total: number } | null>(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 响应序号防护：筛选/翻页触发多次请求时，旧响应晚到不再覆盖新结果
  const loadSeq = useRef(0);
  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    const params: Record<string, string> = { page: String(page), pageSize: String(PAGE_SIZE) };
    if (action) params.action = action;
    if (resourceType) params.resourceType = resourceType;
    if (from) params.from = from;
    if (to) params.to = to;
    adminApi
      .auditLog(params)
      .then((d) => {
        if (seq === loadSeq.current) setRows(d);
      })
      .catch((e: Error) => {
        if (seq === loadSeq.current) setError(e.message);
      });
  }, [page, action, resourceType, from, to]);

  useEffect(load, [load]);

  const resetPage =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(1);
    };

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>审计日志</h2>
          <p className="page-desc">管理员全部操作与敏感数据访问的追加式留痕</p>
        </div>
      </div>
      <div className="toolbar">
        <select
          value={action}
          onChange={(e) => resetPage(setAction)(e.target.value)}
          aria-label="动作筛选"
        >
          <option value="">全部动作</option>
          {Object.entries(ACTION_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={resourceType}
          onChange={(e) => resetPage(setResourceType)(e.target.value)}
          aria-label="资源类型筛选"
        >
          <option value="">全部资源</option>
          {RESOURCE_TYPES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <label>
          从{' '}
          <input
            type="date"
            value={from}
            onChange={(e) => resetPage(setFrom)(e.target.value)}
            aria-label="起始日期"
          />
        </label>
        <label>
          到{' '}
          <input
            type="date"
            value={to}
            onChange={(e) => resetPage(setTo)(e.target.value)}
            aria-label="截止日期"
          />
        </label>
      </div>
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {!error && !rows && <p className="muted">加载中…</p>}
      <div className="table-panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>操作</th>
              <th>资源</th>
              <th>原因</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {rows?.items.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.createdAt.slice(0, 19).replace('T', ' ')}</td>
                <td>
                  <span className="pill muted">{ACTION_LABELS[r.action] ?? r.action}</span>
                </td>
                <td>
                  {r.resourceType}
                  {r.resourceId ? <span className="mono"> / {r.resourceId.slice(0, 8)}…</span> : ''}
                </td>
                <td>{r.reason ?? '—'}</td>
                <td className="mono">{r.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows && rows.items.length === 0 && <p className="muted">暂无数据</p>}
      <Pagination page={page} pageSize={PAGE_SIZE} total={rows?.total ?? 0} onChange={setPage} />
    </section>
  );
}
