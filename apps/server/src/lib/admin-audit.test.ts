import { describe, expect, it, vi } from 'vitest';

import { queryAdminAudit, writeAdminAudit } from './admin-audit.js';

function fakePool(rows: unknown[] = []) {
  // count 查询返回 count(*) 行（total），其余（insert/select）返回给定 rows；
  // rest 参数声明让 mock.calls 具化为 unknown[][]（否则 [] 空元组，as 转型无法过 tsc）
  return {
    query: vi.fn(async (...args: unknown[]) => {
      const sql = String(args[0]);
      return sql.includes('count(*)')
        ? { rows: [{ total: 7 }], rowCount: 1 }
        : { rows, rowCount: rows.length };
    }),
  };
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
        created_at: new Date('2026-08-18T00:00:00Z'),
      },
    ]);
    const result = await queryAdminAudit(pool as never, {
      adminId: 'a1',
      action: 'user.suspend',
      from: '2026-08-01',
      page: 2,
      pageSize: 10,
    });
    expect(result.total).toBe(7);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
    expect(result.items[0]!.action).toBe('user.suspend');
    expect(result.items[0]!.createdAt).toBe('2026-08-18T00:00:00.000Z');
    const [countSql] = pool.query.mock.calls[0] as [string];
    expect(countSql).toContain('count(*)');
    expect(countSql).toContain('admin_id = $1');
    expect(countSql).toContain('action = $2');
    expect(countSql).toContain('created_at >= $3::date');
    const [selectSql] = pool.query.mock.calls[1] as [string];
    expect(selectSql).toContain('limit $4');
    expect(selectSql).toContain('offset $5');
  });

  it('queryAdminAudit truncates fractional page/pageSize（1.5 不进 LIMIT 导致 PG 500）', async () => {
    const pool = fakePool([]);
    const result = await queryAdminAudit(pool as never, { page: 2.7, pageSize: 1.5 });
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(1);
    // 非法（NaN）回默认
    const fallback = await queryAdminAudit(pool as never, { page: Number('abc') });
    expect(fallback.page).toBe(1);
    expect(fallback.pageSize).toBe(20);
  });
});
