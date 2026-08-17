import { useState } from 'react';

import { adminApi } from '../api.js';

export function SensitivePage() {
  const [userId, setUserId] = useState('');
  const [resourceType, setResourceType] = useState<'chat' | 'private_memory' | 'bond_memory'>(
    'chat',
  );
  const [reason, setReason] = useState('');
  const [grant, setGrant] = useState<{
    grantId: string;
    token: string;
    expiresAt: string;
  } | null>(null);
  const [content, setContent] = useState<Array<Record<string, unknown>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const requestGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setContent(null);
    try {
      const g = await adminApi.createSensitiveAccess({
        targetUserId: userId,
        resourceType,
        reason,
        scope: {},
      });
      setGrant(g);
      const result = await adminApi.sensitiveContent(g.grantId, g.token);
      setContent(result.items);
      setGrant(null); // 读取后立即丢弃（授权已单次消费）
      setNotice('已按授权读取一次；本次授权已失效。');
    } catch (err) {
      setError((err as Error).message);
      setGrant(null);
      setContent(null);
    }
  };

  return (
    <section className="page">
      <h2>聊天与记忆（敏感数据）</h2>
      <p className="muted">
        默认只显示脱敏摘要。查看原文必须填写理由，系统签发 5
        分钟一次性授权，读取后立即失效并记入审计。
      </p>
      <form className="grant-form" onSubmit={(e) => void requestGrant(e)}>
        <label>
          用户 userId
          <input value={userId} onChange={(e) => setUserId(e.target.value)} required />
        </label>
        <label>
          资源类型
          <select
            value={resourceType}
            onChange={(e) =>
              setResourceType(e.target.value as 'chat' | 'private_memory' | 'bond_memory')
            }
          >
            <option value="chat">聊天记录</option>
            <option value="private_memory">私人记忆</option>
            <option value="bond_memory">羁绊记忆</option>
          </select>
        </label>
        <label>
          查看理由（≥5 字，写入审计）
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
        </label>
        <button type="submit">申请授权并查看</button>
      </form>
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
      {grant && <p className="muted">授权有效至 {grant.expiresAt}，正在读取…</p>}
      {content && (
        <table className="data-table">
          <thead>
            <tr>
              {Object.keys(content[0] ?? {}).map((k) => (
                <th key={k}>{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {content.map((row, i) => (
              <tr key={i}>
                {Object.values(row).map((v, j) => (
                  <td key={j}>{String(v)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
