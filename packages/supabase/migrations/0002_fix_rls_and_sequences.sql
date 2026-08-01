-- ============================================================================
-- 0002_fix_rls_and_sequences.sql —— 框架审查修复（2026-08-01）
-- ============================================================================
-- 修复项：
--   1. （🔴3）profiles RLS 允许 active 好友双方读取昵称/头像（设计稿 11.1）
--   2. （🟠9）events 表 (room_id, room_seq) 唯一约束（9.6 顺序保证）
-- ============================================================================

-- ---------- 1. 好友双方可读对方公开资料 ----------
-- 原策略 profiles_self_only 只允许本人 → 好友场景 403。
-- 新增：若请求者是该用户的 active 好友（或未解除关系），可读昵称/头像/性格等公开字段。
drop policy if exists profiles_self_only on profiles;

create policy profiles_self_only on profiles
  for all using (user_id = auth.uid());

create policy profiles_friends_read on profiles
  for select
  using (
    exists (
      select 1
      from friendships f
      where f.status in ('active', 'paused')  -- 暂停关系仍可查看（6.8 暂停=停止互动但保留）
        and (
          (f.user_low_id = profiles.user_id and f.user_high_id = auth.uid())
          or
          (f.user_high_id = profiles.user_id and f.user_low_id = auth.uid())
        )
    )
  );

-- ---------- 2. events room_seq 唯一约束 ----------
-- 9.6：room_seq 保证单个好友关系中的事件顺序，并发下不得重复。
create unique index if not exists events_room_seq_unique
  on events (room_id, room_seq)
  where room_seq is not null;
