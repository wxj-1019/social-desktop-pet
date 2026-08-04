-- ============================================================================
-- 0009_waitlist.sql —— Waitlist 落地页报名（4.3 传播循环）
-- ============================================================================
-- 公开报名表（无 RLS：服务器统一管理，仅内部写入）：
--   pending → invited（发出邀请邮件，13.2 待邮件供应商）→ joined（注册成功）
-- email 唯一约束兜底重复报名（应用层 409）。
-- ============================================================================

create table if not exists waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  status     text not null default 'pending'
             check (status in ('pending', 'invited', 'joined')),
  created_at timestamptz not null default now()
);

create index if not exists waitlist_status_idx
  on waitlist (status, created_at);
