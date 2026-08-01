-- ============================================================================
-- 0003_self_hosted.sql —— 自建后端兼容层（D-13，2026-08-01）
-- ============================================================================
-- 原 Supabase 托管提供 auth schema（auth.users 表 + auth.uid() 函数），
-- 0001/0002 的 RLS 策略依赖它们。自建 Postgres 没有这些，此处补齐：
--   1. auth.users：自建 Auth 服务的用户表（注册/登录/撤销由 apps/server 写入）
--   2. auth.uid()：从 request.jwt.claims GUC 读取当前用户 id——
--      Node 服务在每个事务里 SET LOCAL request.jwt.claims = '{"sub":"<uuid>"}'，
--      RLS 策略据此判定（Postgres 官方 RLS 文档推荐做法，非 Supabase 专属）。
--   3. schema_migrations：apps/server/src/db/migrate.ts 的迁移记账表
-- ============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,          -- argon2id/bcrypt 哈希（自建 Auth 写入）
  created_at    timestamptz not null default now()
);

-- 0001 中 profiles.user_id references auth.users(id) 依赖此表存在。

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select case
    when current_setting('request.jwt.claims', true) is null then null::uuid
    else (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid
  end
$$;

-- 迁移记账表（apps/server 启动时检查并执行未应用的 migrations）
create table if not exists schema_migrations (
  version     text primary key,         -- 文件名（0001_init.sql 等）
  applied_at  timestamptz not null default now()
);

-- 自建 Auth 的 refresh 会话（9.8：每设备一个、轮换即撤销旧 token）
create table if not exists refresh_sessions (
  token_hash text primary key,          -- sha256(token)，明文绝不下落
  user_id    uuid not null references auth.users(id) on delete cascade,
  device_id  uuid not null,             -- 对应 devices.device_id（0001）
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists refresh_sessions_user_device_idx
  on refresh_sessions (user_id, device_id);
