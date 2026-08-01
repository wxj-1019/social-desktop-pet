-- ============================================================================
-- 0007_chat_messages.sql —— AI 对话历史（10.x；保留期 11.4 chatHistoryDays=90）
-- ============================================================================
-- 云端 chat 会话持久化：user 消息与 assistant 回复成对落库，
-- 客户端挂载时经 GET /chat/history 恢复最近 N 条（跨设备可续）。
-- ============================================================================

create table if not exists chat_messages (
  message_id uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(user_id) on delete cascade,
  thread_id  text not null,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_user_time_idx
  on chat_messages (user_id, created_at desc);
