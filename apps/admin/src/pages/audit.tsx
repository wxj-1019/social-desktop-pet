import { useEffect, useState } from 'react';

import { adminApi, type AuditRow } from '../api.js';

const ACTION_LABELS: Record<string, string> = {
  'admin.login': '管理员登录',
  'admin.login_failed': '登录失败',
  'admin.refresh': '刷新会话',
  'admin.revoke': '退出登录',
  'user.suspend': '暂停账号',
  'user.restore': '恢复账号',
  'device.revoke': '撤销设备',
  'waitlist.invite': '发放邀请',
  'waitlist.expire': '邀请过期',
  'sensitive.grant': '敏感授权',
  'sensitive.read': '敏感读取',
};

export function AuditPage() {
  const [rows, setRows] = useState<{ items: AuditRow[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminApi
      .auditLog({ page: '1', pageSize: '100' })
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <section className="page">
      <h2>审计日志</h2>
      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
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
              <td>{r.createdAt}</td>
              <td>{ACTION_LABELS[r.action] ?? r.action}</td>
              <td>
                {r.resourceType}
                {r.resourceId ? ` / ${r.resourceId.slice(0, 8)}…` : ''}
              </td>
              <td>{r.reason ?? '—'}</td>
              <td>{r.ip ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">共 {rows?.total ?? 0} 条（单页最多 100）</p>
    </section>
  );
}
