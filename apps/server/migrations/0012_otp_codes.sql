-- ============================================================================
-- 0012_otp_codes.sql —— 邮箱 OTP（13.2 事务邮件：OTP 登录）
-- ============================================================================
-- - code 只存 sha256 哈希（AGENTS.md 第 8 条精神：凭据明文绝不下落）
-- - 6 位数字 / 15 分钟 TTL / 5 次尝试上限 / 60s 重发冷却（应用层校验）
-- - 公开表（OTP 请求发生在鉴权前，无用户身份可绑 RLS）；
--   应用层防护：冷却 + 尝试上限 + 过期清理（request 时顺带清理该邮箱过期行）
-- ============================================================================

create table if not exists otp_codes (
  otp_id      uuid primary key default gen_random_uuid(),
  email       text not null,
  code_hash   text not null,
  purpose     text not null default 'login',
  attempts    int not null default 0,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists otp_codes_email_recent_idx
  on otp_codes (email, created_at desc);
