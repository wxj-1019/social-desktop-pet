-- ============================================================================
-- 0017_chat_usage_dims.sql —— chat 用量成败/限流维度（2026-08-18）
-- ============================================================================
-- 12.7 观测补全：request_count 一直把被 429 拒绝的请求也算在内且分不清成败。
-- fail_count：图执行抛错（SSE error 帧）的次数
-- limit_hits：命中每日预算/token 预算被 429 的次数（含在 request_count 内，可拆分成功数）
-- ============================================================================

alter table chat_usage add column if not exists fail_count int not null default 0;
alter table chat_usage add column if not exists limit_hits int not null default 0;
