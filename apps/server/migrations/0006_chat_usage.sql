-- ============================================================================
-- 0006_chat_usage.sql —— 12.7 成本保护：chat 用量记账（2026-08-02）
-- ============================================================================
-- 每用户每日对话预算（dailyChatRequestsPerUser）+ token 估算累计，
-- 供 chat 路由在调用模型前检查、调用后记账。速率/并发限制为内存态（路由层）。
-- ============================================================================

create table if not exists chat_usage (
  user_id       uuid not null references profiles(user_id) on delete cascade,
  usage_date    date not null default current_date,
  request_count int  not null default 0,
  token_estimate int not null default 0,   -- 输入+输出字符数/4 的估算（12.7 观测）
  primary key (user_id, usage_date)
);
