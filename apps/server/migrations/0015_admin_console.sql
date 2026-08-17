-- ============================================================================
-- 0015_admin_console.sql —— 管理后台（2026-08-18）
-- ============================================================================
-- 独立管理员域（与桌宠用户 auth.users 隔离）：
--   admin_users          管理员账号（argon2id 哈希；初始账号由 CLI 创建，不入库）
--   admin_sessions       refresh token 只存 sha256 哈希（与 9.8 同原则）
--   admin_audit_log      追加式审计（不提供删除接口）
--   admin_sensitive_grants 聊天/记忆原文的一次性短时授权
-- auth.users 增加账号暂停列（登录检查 + 全量撤销会话/设备）
-- waitlist 状态机补充 'expired'（0009 原有 check 不含该值，管理后台需显式过期）
-- ============================================================================

create table if not exists admin_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,
  status        text not null default 'active' check (status in ('active', 'disabled')),
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists admin_sessions (
  token_hash   text primary key,
  admin_id     uuid not null references admin_users(id) on delete cascade,
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);
create index if not exists admin_sessions_admin_idx on admin_sessions (admin_id);

create table if not exists admin_audit_log (
  id            uuid primary key default gen_random_uuid(),
  admin_id      uuid references admin_users(id) on delete set null,
  action        text not null,
  resource_type text not null,
  resource_id   text,
  reason        text,
  request_ip    text,
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on admin_audit_log (created_at desc);
create index if not exists admin_audit_log_admin_idx on admin_audit_log (admin_id, created_at desc);

alter table auth.users add column if not exists account_status text not null default 'active'
  check (account_status in ('active', 'suspended'));
alter table auth.users add column if not exists suspended_at timestamptz;
alter table auth.users add column if not exists suspended_reason text;

create table if not exists admin_sensitive_grants (
  grant_id         uuid primary key default gen_random_uuid(),
  admin_id         uuid not null references admin_users(id) on delete cascade,
  target_user_id   uuid not null references auth.users(id) on delete cascade,
  resource_type    text not null check (resource_type in ('chat', 'private_memory', 'bond_memory')),
  resource_scope   jsonb not null default '{}',
  grant_token_hash text not null unique,
  reason           text not null,
  expires_at       timestamptz not null,
  used_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists admin_sensitive_grants_admin_idx on admin_sensitive_grants (admin_id);

-- waitlist 显式过期（0009 的 check 不含 'expired'；需先删后加）
alter table waitlist drop constraint if exists waitlist_status_check;
alter table waitlist add constraint waitlist_status_check
  check (status in ('pending', 'invited', 'joined', 'expired'));
