-- ============================================================================
-- 0008_memory_confirmations.sql —— 记忆分级确认队列 + 审计日志（10.6 / D-3 / 11.2）
-- ============================================================================
-- memory_confirmations：敏感候选（health/finance/relationship/identity）的
--   HITL 确认队列。D-3：敏感 → 确认卡（记住/仅本次聊天/修改），普通 → 自动保存。
-- memory_audit_log：记忆写操作审计（11.2 第四道：谁、何时、写了什么），
--   与 graph_checkpoints 互补（图运行轨迹 vs 记忆数据变更）。
-- ============================================================================

create table if not exists memory_confirmations (
  confirmation_id uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references profiles(user_id) on delete cascade,
  category        text not null check (category in ('preference','commitment','event','fact','bond')),
  value           text not null,
  importance      int not null default 5 check (importance between 1 and 10),
  source_type     text not null default 'user_stated'
                  check (source_type in ('user_stated','user_confirmed','system_event','inferred')),
  sensitivity     text not null default 'medium' check (sensitivity in ('low','medium','high')),
  source_turn_ids uuid[] not null default '{}',
  status          text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  created_at      timestamptz not null default now()
);

create index if not exists memory_confirmations_pending_idx
  on memory_confirmations (owner_user_id, status, created_at);

create table if not exists memory_audit_log (
  audit_id        uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references profiles(user_id) on delete cascade,
  action          text not null check (action in
                  ('auto_save','pending_confirm','user_confirmed','user_rejected','invalidate','dedupe_noop')),
  memory_id       uuid,
  value           text not null,
  source_turn_ids uuid[] not null default '{}',
  created_at      timestamptz not null default now()
);

create index if not exists memory_audit_log_owner_time_idx
  on memory_audit_log (owner_user_id, created_at desc);

-- RLS 纵深防御（AGENTS.md 第 4 条：应用层校验为主，RLS 兜底）
alter table memory_confirmations enable row level security;
alter table memory_audit_log enable row level security;

create policy memory_confirmations_owner_only on memory_confirmations
  for all using (owner_user_id = auth.uid());

create policy memory_audit_log_owner_only on memory_audit_log
  for all using (owner_user_id = auth.uid());
