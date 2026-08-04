-- ============================================================================
-- 0013_waitlist_invite.sql —— 邀请流程状态机（4.3 传播循环 / 13.2 事务邮件）
-- ============================================================================
-- 状态机：
--   pending --(运营 invite，生成兑换码 + 邀请邮件)--> invited
--   invited --(公开 claim {email, code} 校验通过)--> joined
--   invited --(invite_expires_at 超期未兑换)--> expired   （惰性判定：claim/查询时检查）
--   joined --(用户注册)--> claimed_by 绑定（register 顺带，幂等）
--
-- 兑换码只存 sha256 哈希（AGENTS.md 第 8 条精神：凭据明文绝不下落）。
-- ============================================================================

alter table waitlist
  add column if not exists invite_code_hash text,
  add column if not exists invited_at timestamptz,
  add column if not exists invite_expires_at timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by uuid references profiles(user_id);

alter table waitlist drop constraint if exists waitlist_status_check;
alter table waitlist add constraint waitlist_status_check
  check (status in ('pending', 'invited', 'joined', 'expired'));
