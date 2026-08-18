/**
 * 轻量输入校验（admin 域专用）—— 防止非法参数落到 Postgres cast/UUID 绑定导致 500。
 * 不跨端共享（admin 契约仅服务端消费），故不引入 @pet/protocol/zod 依赖。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID 格式校验（path param → uuid 列绑定前必须校验，否则 PG 22P02 → 500） */
export function isValidUuid(s: string): boolean {
  return UUID_RE.test(s);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 日历级日期校验（2026-02-30 / 2026-13-01 等非日历日期拒绝；regex 只查格式不查日历） */
export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
}

/** 分页参数收敛：非法/越界回默认；pageSize clamp [1,100] */
export function parsePaging(q: Record<string, string | undefined>): {
  page: number;
  pageSize: number;
} {
  const page = Number.isFinite(Number(q.page)) ? Math.max(1, Math.trunc(Number(q.page))) : 1;
  const pageSize = Number.isFinite(Number(q.pageSize))
    ? Math.min(100, Math.max(1, Math.trunc(Number(q.pageSize))))
    : 20;
  return { page, pageSize };
}
