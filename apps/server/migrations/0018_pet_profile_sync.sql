-- 0018_pet_profile_sync.sql —— 桌宠档案跨设备同步（P2 收尾）
-- pets 表存服务端档案快照：桌面端 PetProfile（protocol PetProfileSchema 校验后整存），
-- 登录后拉取覆盖本地、本地变更时上报（最后写赢；synced_at 供后续冲突策略演进）。
-- RLS：与 bonds/gift_events 等业务表一致不启用（应用层 owner 校验为主防线，
-- 约定 4；pets 的 admin 全表统计依赖无 RLS 读）。

alter table pets
  add column if not exists profile_sync jsonb,
  add column if not exists synced_at timestamptz;
