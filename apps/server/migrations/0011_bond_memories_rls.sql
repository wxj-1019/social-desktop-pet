-- ============================================================================
-- 0011_bond_memories_rls.sql —— 羁绊记忆成员校验完整策略（9.9 / 10.7 / 7.5）
-- ============================================================================
-- 0001 的占位策略只校验 revoked_at is null → 任何登录用户可读所有未撤销的
-- 羁绊记忆（纵深防御缺口）。本 migration 替换为完整成员校验：
--   - 读：请求者必须是 bond 的 pet 主人之一 + 双方同意（7.5 共享条件）+ 未撤销
--   - 写：proposed_by 必须为本人且是 bond 成员
--   - 改/撤：仅 bond 成员（任意一方撤销即退出共享，7.5）
-- 应用层仍为主防线（AGENTS.md 第 4 条），RLS 兜底。
-- ============================================================================

drop policy if exists bond_memories_member_only on bond_memories;

-- 读：成员 + 双同意 + 未撤销
create policy bond_memories_member_only on bond_memories
  for select using (
    revoked_at is null
    and consented_a_at is not null
    and consented_b_at is not null
    and exists (
      select 1 from bonds b
      join pets p on p.pet_id in (b.pet_a_id, b.pet_b_id)
      where b.bond_id = bond_memories.bond_id
        and p.owner_user_id = auth.uid()
    )
  );

-- 写：提案人必须本人且是 bond 成员（防冒名写入他人 bond）
create policy bond_memories_member_insert on bond_memories
  for insert with check (
    proposed_by = auth.uid()
    and exists (
      select 1 from bonds b
      join pets p on p.pet_id in (b.pet_a_id, b.pet_b_id)
      where b.bond_id = bond_memories.bond_id
        and p.owner_user_id = auth.uid()
    )
  );

-- 改/撤：仅 bond 成员（双方之一可撤销共享）
create policy bond_memories_member_update on bond_memories
  for update using (
    exists (
      select 1 from bonds b
      join pets p on p.pet_id in (b.pet_a_id, b.pet_b_id)
      where b.bond_id = bond_memories.bond_id
        and p.owner_user_id = auth.uid()
    )
  );
