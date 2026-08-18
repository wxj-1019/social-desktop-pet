-- ============================================================================
-- 0016_waitlist_mail_status.sql —— 邀请邮件发送结果追踪（2026-08-18）
-- ============================================================================
-- 运营需要看到"该重发谁"：邀请邮件此前 fire-and-forget，失败只有服务端日志。
-- pending：已发邀请未投递（无邮件配置时直接置 skipped）
-- sent / failed：SMTP 结果回写；重邀时重置为 pending
-- ============================================================================

alter table waitlist add column if not exists invite_mail_status text not null default 'pending'
  check (invite_mail_status in ('pending', 'sent', 'failed', 'skipped'));
alter table waitlist add column if not exists invite_mail_at timestamptz;
