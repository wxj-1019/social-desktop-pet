-- ============================================================================
-- 0010_memory_confirm_supersede.sql —— 确认队列纠正链 + 抽取幂等标记（10.5/10.6）
-- ============================================================================
-- 1) memory_confirmations.superseded_memory_id：敏感 UPDATE 纠正的候选进入确认
--    队列时携带被纠正的旧记忆 id（确认后置失效 + superseded_by 链接；拒绝则
--    旧记忆保留，不丢数据）。此前 UPDATE 一律先置失效，拒绝确认会导致丢失。
-- 2) chat_messages.memory_extracted_at：run-memory-extract 幂等标记——每条 user
--    turn 只参与一次抽取窗口，避免连发消息时重叠窗口反复触发 LLM 抽取。
-- ============================================================================

alter table memory_confirmations
  add column if not exists superseded_memory_id uuid;

alter table chat_messages
  add column if not exists memory_extracted_at timestamptz;
