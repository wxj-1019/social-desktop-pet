import { describe, expect, it, vi } from 'vitest';

import { queryAdminAudit, writeAdminAudit } from './admin-audit.js';

function fakePool(rows: unknown[] = []) {
  // rest 参数声明让 mock.calls 具化为 unknown[][]（否则 [] 空元组，下面的 as 转型无法过 tsc）
  return { query: vi.fn(async (..._args: unknown[]) => ({ rows, rowCount: rows.length })) };
}

describe('admin audit', () => {
  it('writeAdminAudit inserts with all fields as parameters', async () => {
    const pool = fakePool();
    await writeAdminAudit(pool as never, {
      adminId: 'a1',
      action: 'user.suspend',
      resourceType: 'user',
      resourceId: 'u1',
      reason: '测试暂停',
      ip: '127.0.0.1',
      metadata: { deviceCount: 2 },
    });
    const [sql, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('insert into admin_audit_log');
    expect(params).toEqual([
      'a1',
      'user.suspend',
      'user',
      'u1',
      '测试暂停',
      '127.0.0.1',
      '{"deviceCount":2}',
    ]);
  });

  it('writeAdminAudit tolerates null adminId (login failures)', async () => {
    const pool = fakePool();
    await writeAdminAudit(pool as never, {
      adminId: null,
      action: 'admin.login_failed',
      resourceType: 'admin',
    });
    const [, params] = pool.query.mock.calls[0] as [string, unknown[]];
    expect(params[0]).toBeNull();
  });

  it('queryAdminAudit builds filters, pagination and total count', async () => {
    const pool = fakePool([
      {
        id: 'e1',
        admin_id: 'a1',
        action: 'user.suspend',
        resource_type: 'user',
        resource_id: 'u1',
        reason: null,
        request_ip: null,
        created_at: '2026-08-18T00:00:00Z',
      },
    ]);
    const result = await queryAdminAudit(pool as never, {
      adminId: 'a1',
      action: 'user.suspend',
      from: '2026-08-01',
      page: 2,
      pageSize: 10,
    });
    expect(result.total).toBe(1);
    expect(result.items[0]!.action).toBe('user.suspend');
    const [sql] = pool.query.mock.calls[0] as [string];
    expect(sql).toContain('count(*)');
  });
});
