-- 4.2 好友房间确定性唯一键
-- 问题：findOrCreateRoom select-then-insert 无唯一约束，两人并发互送礼/拜访时
-- 各建一个 friend 房间（之后 limit 1 无序取到哪个不确定）。
-- 方案：rooms 加 member_key（排序后的双成员 uuid），friend 房间唯一索引；
--       代码改 insert on conflict 幂等创建（见 relationships.ts findOrCreateRoom）。

alter table rooms add column if not exists member_key text;

-- 回填已有 friend 房间：member_key = 排序后的双成员 uuid（'：' 分隔）
update rooms r
set member_key = (
  select string_agg(rm.user_id::text, ':' order by rm.user_id)
  from room_members rm
  where rm.room_id = r.room_id and rm.left_at is null
)
where r.type = 'friend' and r.member_key is null;

-- 部分唯一索引：仅 friend 房间且已回填（非 friend 类型 member_key 为空，不受约束）
create unique index if not exists rooms_friend_member_key_idx
  on rooms (member_key)
  where type = 'friend' and member_key is not null;
