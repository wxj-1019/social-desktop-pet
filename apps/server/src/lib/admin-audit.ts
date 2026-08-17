/**
 * 管理员审计 —— 追加式日志（写 + 查）。
 * 只记录必要 metadata（不写密码/token/模型密钥）；查询支持时间/管理员/动作/资源过滤。
 */
import type pg from 'pg';

export interface AdminAuditEntry {
  adminId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  reason?: string | null;
  ip?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AdminAuditRow {
  id: string;
  adminId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  reason: string | null;
  ip: string | null;
  createdAt: string;
}

export async function writeAdminAudit(pool: pg.Pool, entry: AdminAuditEntry): Promise<void> {
  await pool.query(
    `insert into admin_audit_log (admin_id, action, resource_type, resource_id, reason, request_ip, metadata)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      entry.adminId,
      entry.action,
      entry.resourceType,
      entry.resourceId ?? null,
      entry.reason ?? null,
      entry.ip ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}

export interface AdminAuditQuery {
  adminId?: string;
  action?: string;
  resourceType?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export async function queryAdminAudit(
  pool: pg.Pool,
  q: AdminAuditQuery,
): Promise<{ items: AdminAuditRow[]; total: number }> {
  const page = Number.isFinite(q.page) ? Math.max(1, q.page!) : 1;
  const pageSize = Number.isFinite(q.pageSize) ? Math.min(100, Math.max(1, q.pageSize!)) : 20;
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.adminId) {
    params.push(q.adminId);
    where.push(`admin_id = $${params.length}`);
  }
  if (q.action) {
    params.push(q.action);
    where.push(`action = $${params.length}`);
  }
  if (q.resourceType) {
    params.push(q.resourceType);
    where.push(`resource_type = $${params.length}`);
  }
  if (q.from) {
    params.push(q.from);
    where.push(`created_at >= $${params.length}::date`);
  }
  if (q.to) {
    params.push(q.to);
    where.push(`created_at < $${params.length}::date + interval '1 day'`);
  }
  const whereSql = where.length > 0 ? `where ${where.join(' and ')}` : '';

  const count = await pool.query(
    `select count(*)::int as total from admin_audit_log ${whereSql}`,
    params,
  );
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await pool.query(
    `select id, admin_id, action, resource_type, resource_id, reason, request_ip, created_at
     from admin_audit_log ${whereSql}
     order by created_at desc
     limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return {
    total: Number(count.rows[0]?.total ?? 0),
    items: rows.map((r) => ({
      id: String(r.id),
      adminId: r.admin_id ? String(r.admin_id) : null,
      action: r.action as string,
      resourceType: r.resource_type as string,
      resourceId: r.resource_id as string | null,
      reason: r.reason as string | null,
      ip: r.request_ip as string | null,
      createdAt: (r.created_at as Date).toISOString(),
    })),
  };
}
