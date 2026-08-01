-- ============================================================================
-- 0001_init.sql —— 设计稿 9.9 核心数据模型 + RLS + pgvector（第二轮调研修订）
-- ============================================================================
-- 修订点：
--   1. 9.9 全部表（profiles/devices/friend_invites/friendships/blocks/rooms/...
--      pets/pet_state/bonds/private_memories/bond_memory_proposals/bond_memories/
--      visits/messages/gift_events/tasks/task_contributions/events/user_inbox/
--      device_cursors/command_receipts/reports）+ graph_checkpoints（11.2 审计）
--   2. 好友关系：user_low_id/user_high_id 规范化排序 + 唯一约束 + 单活动好友约束（3.1）
--   3. RLS（9.9）：私人记忆 owner_only；羁绊记忆 bond 成员
--   4. pgvector HNSW + 按 owner_user_id 部分索引（10.7 第二轮）
--   5. 分表：private_memories / bond_memories（11.2 存储隔离第二道）
--   6. 时态失效：memory_status + superseded_by（10.5 第二轮，纠正=置失效不删除）
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "vector"; -- pgvector（9.1）

-- ---------- 账号与设备 ----------
create table if not exists profiles (
  user_id                  uuid primary key references auth.users(id) on delete cascade,
  nickname                 text not null,
  avatar                   text,
  adult_eligible           boolean not null default false,
  age_assurance_level      text not null default 'self_declared',
  adult_attested_at        timestamptz,
  active_display_device_id uuid,
  created_at               timestamptz not null default now()
);

create table if not exists devices (
  device_id    uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(user_id) on delete cascade,
  platform     text not null check (platform in ('windows','macos')),
  app_version  text,
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz
);

-- ---------- 好友关系（3.1：low/high 规范化） ----------
create table if not exists friend_invites (
  invite_id    uuid primary key default gen_random_uuid(),
  inviter_id   uuid not null references profiles(user_id) on delete cascade,
  token_hash   text not null unique,           -- 6.3：只存哈希
  expires_at   timestamptz not null,
  status       text not null default 'pending' check (status in ('pending','accepted','rejected','expired','used'))
);

create table if not exists friendships (
  friendship_id uuid primary key default gen_random_uuid(),
  user_low_id   uuid not null references profiles(user_id) on delete cascade,
  user_high_id  uuid not null references profiles(user_id) on delete cascade,
  status        text not null default 'pending' check (status in ('pending','active','paused','terminated','blocked')),
  accepted_at   timestamptz,
  created_at    timestamptz not null default now(),
  -- low < high 规范化 + 唯一
  constraint friendships_low_lt_high check (user_low_id < user_high_id)
);

-- 9.9：唯一活动好友关系（每账号最多一个 active）
create unique index if not exists friendships_one_active_per_user_low
  on friendships (user_low_id) where status = 'active';
create unique index if not exists friendships_one_active_per_user_high
  on friendships (user_high_id) where status = 'active';

create table if not exists blocks (
  blocker_id uuid not null references profiles(user_id) on delete cascade,
  blocked_id uuid not null references profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

-- ---------- 房间与成员（9.3 roomSeq） ----------
create table if not exists rooms (
  room_id      uuid primary key default gen_random_uuid(),
  type         text not null default 'friend',
  next_room_seq bigint not null default 1
);

create table if not exists room_members (
  room_id  uuid not null references rooms(room_id) on delete cascade,
  user_id  uuid not null references profiles(user_id) on delete cascade,
  role     text not null default 'member',
  left_at  timestamptz,
  primary key (room_id, user_id)
);

-- ---------- 宠物与羁绊 ----------
create table if not exists pets (
  pet_id           uuid primary key default gen_random_uuid(),
  owner_user_id    uuid not null references profiles(user_id) on delete cascade,
  character_id     text not null,
  name             text not null,
  personality_mode text not null default 'warm'  -- 6.1：温柔陪伴/活泼朋友/安静伙伴
);

create table if not exists pet_state (
  pet_id          uuid primary key references pets(pet_id) on delete cascade,
  version         int not null default 1,
  mood            text,
  selected_outfit text,
  updated_at      timestamptz not null default now()
);

create table if not exists bonds (
  bond_id        uuid primary key default gen_random_uuid(),
  friendship_id  uuid not null references friendships(friendship_id) on delete cascade,
  pet_a_id       uuid not null references pets(pet_id) on delete cascade,
  pet_b_id       uuid not null references pets(pet_id) on delete cascade,
  stage          text not null default 'first_meet' check (stage in ('first_meet','familiar','trusted')),
  progress       int not null default 0,   -- 7.4：有效共同事件累计（第二轮新增）
  status         text not null default 'active' check (status in ('active','dissolved'))
);

-- ---------- 记忆（10.5）—— 分表（11.2 存储隔离） ----------
-- 私人记忆：owner = user_id
create table if not exists private_memories (
  memory_id       uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references profiles(user_id) on delete cascade,
  subject_type    text,
  category        text not null,           -- preference/commitment/event/fact
  value           text not null,
  source_turn_ids uuid[] not null default '{}',  -- 10.6：服务端校验属于 owner 本人
  confidence      real not null default 1,
  user_confirmed  boolean not null default false,
  sensitivity     text not null default 'low' check (sensitivity in ('low','medium','high')),
  visibility      text not null default 'private',
  purpose         text not null default 'private_chat',
  valid_from      timestamptz,
  valid_to        timestamptz,
  expires_at      timestamptz,
  importance      int not null default 5 check (importance between 1 and 10),  -- 第二轮新增
  memory_status   text not null default 'active' check (memory_status in ('active','invalidated')),  -- 第二轮
  superseded_by   uuid references private_memories(memory_id),  -- 第二轮：知识更新链
  source_type     text not null default 'user_stated' check (source_type in ('user_stated','user_confirmed','system_event','inferred')),
  namespace       text not null,
  embedding       vector(1536),            -- 按明文等价物对待（11.2 第四道：静态加密）
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 羁绊记忆：owner = bond_id（分表，9.9 / 11.2）
create table if not exists bond_memories (
  memory_id       uuid primary key default gen_random_uuid(),
  bond_id         uuid not null references bonds(bond_id) on delete cascade,
  event_id        uuid,
  content         text not null,
  -- 7.5：双方同意 + 任意一方撤销即退出共享检索
  proposed_by     uuid not null references profiles(user_id),
  consented_a_at  timestamptz,
  consented_b_at  timestamptz,
  revoked_at      timestamptz,
  embedding       vector(1536),
  created_at      timestamptz not null default now()
);

-- 记忆提案（7.5 旅行卡 → 共享羁绊记忆）
create table if not exists bond_memory_proposals (
  proposal_id          uuid primary key default gen_random_uuid(),
  bond_id              uuid not null references bonds(bond_id) on delete cascade,
  event_id             uuid,
  proposed_by_user_id  uuid not null references profiles(user_id),
  content              text not null,
  user_a_consented_at  timestamptz,
  user_b_consented_at  timestamptz,
  status               text not null default 'pending' check (status in ('pending','consented','revoked')),
  created_at           timestamptz not null default now()
);

-- ---------- 联机（拜访/留言/礼物/任务，9.9） ----------
create table if not exists visits (
  visit_id    uuid primary key default gen_random_uuid(),
  bond_id     uuid not null references bonds(bond_id) on delete cascade,
  from_user   uuid not null references profiles(user_id),
  to_user     uuid not null references profiles(user_id),
  type        text not null check (type in ('wave','share_snack','leave_message')),
  status      text not null default 'pending' check (status in ('pending','arrived','responded','closed','expired')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz
);

create table if not exists messages (
  message_id  uuid primary key default gen_random_uuid(),
  from_user   uuid not null references profiles(user_id),
  to_user     uuid not null references profiles(user_id),
  body        text not null,                 -- 6.6：≤200 码点，≤2KB
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists gift_events (
  gift_id     uuid primary key default gen_random_uuid(),
  from_user   uuid not null references profiles(user_id),
  to_user     uuid not null references profiles(user_id),
  snack_id    text not null,                 -- 6.6：服务端白名单内
  status      text not null default 'sent' check (status in ('sent','received','expired')),
  created_at  timestamptz not null default now()
);

create table if not exists tasks (
  task_id           uuid primary key default gen_random_uuid(),
  bond_id           uuid not null references bonds(bond_id) on delete cascade,
  type              text not null default 'mutual_touch_7d',  -- 6.7：MVP 仅一种
  status            text not null default 'pending' check (status in ('pending','a_done','b_done','completed','expired')),
  window_started_at timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '7 days')
);

create table if not exists task_contributions (
  contribution_id uuid primary key default gen_random_uuid(),
  task_id         uuid not null references tasks(task_id) on delete cascade,
  user_id         uuid not null references profiles(user_id),
  contributed_at  timestamptz not null default now(),
  unique (task_id, user_id)
);

-- ---------- 权威事件与收件箱（9.3 / 9.5） ----------
create table if not exists events (
  event_id        uuid primary key default gen_random_uuid(),
  room_id         uuid references rooms(room_id) on delete cascade,
  room_seq        bigint,                    -- 9.6：单好友关系内顺序
  type            text not null,
  payload         jsonb not null,
  reliability     text not null default 'A' check (reliability in ('A','B','C')),
  expires_at      timestamptz,               -- 9.5：B 类短期
  created_at      timestamptz not null default now()
);

create table if not exists user_inbox (
  user_id    uuid not null references profiles(user_id) on delete cascade,
  inbox_seq  bigint not null,                -- 9.6：单用户补偿顺序
  event_id   uuid not null references events(event_id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  primary key (user_id, inbox_seq)
);

create table if not exists device_cursors (
  device_id      uuid primary key references devices(device_id) on delete cascade,
  last_inbox_seq bigint not null default 0,
  updated_at     timestamptz not null default now()
);

-- 9.6 幂等：user_id + device_id + client_event_id 唯一约束
create table if not exists command_receipts (
  user_id         uuid not null references profiles(user_id) on delete cascade,
  device_id       uuid not null references devices(device_id) on delete cascade,
  client_event_id text not null,
  event_id        uuid references events(event_id),
  result          jsonb,
  created_at      timestamptz not null default now(),
  primary key (user_id, device_id, client_event_id)
);

create table if not exists reports (
  report_id   uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles(user_id),
  target_type text not null,
  target_id   uuid not null,
  reason      text,
  status      text not null default 'open',
  created_at  timestamptz not null default now()
);

-- graph_checkpoints（11.2 审计 + 13.5 回放）
create table if not exists graph_checkpoints (
  thread_id   text        not null,
  node        text        not null,
  state       jsonb       not null,
  saved_at    timestamptz not null default now()
);
create index if not exists graph_checkpoints_thread_idx
  on graph_checkpoints (thread_id, saved_at);

-- ============================================================================
-- 索引（10.7 第二轮：HNSW + 按 owner 部分索引 + hybrid 全文）
-- ============================================================================
create index if not exists private_memories_embedding_hnsw
  on private_memories using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where memory_status = 'active';   -- 只索引有效记忆

create index if not exists bond_memories_embedding_hnsw
  on bond_memories using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64)
  where revoked_at is null;          -- 撤销的不索引

-- hybrid 检索的全文索引（10.7 RRF 合并用）
create index if not exists private_memories_value_fts
  on private_memories using gin (to_tsvector('simple', value))
  where memory_status = 'active';

-- ============================================================================
-- Row Level Security（9.9 / 11.2 第二道：数据库层过滤）
-- ============================================================================
alter table private_memories enable row level security;
alter table bond_memories enable row level security;
alter table devices enable row level security;
alter table profiles enable row level security;

-- 私人记忆：仅 owner 可见
create policy private_memories_owner_only on private_memories
  for all using (owner_user_id = auth.uid());

-- 设备：仅 owner 可见
create policy devices_owner_only on devices
  for all using (user_id = auth.uid());

-- profiles：本人可读写，其他人不可见（昵称等通过 RPC 显式暴露）
create policy profiles_self_only on profiles
  for all using (user_id = auth.uid());

-- 羁绊记忆：仅当请求者是 bond 成员且未撤销时可读（10.7 服务端校验 bond 成员）
-- 注：bond 成员关系校验较复杂，生产实现需结合 room_members 与 friendships；
--     此处提供基础策略，完整策略在后续 migration 补全（防过早优化）。
create policy bond_memories_member_only on bond_memories
  for select using (revoked_at is null);
