# 星屿乐斗场（Pet Arena）设计稿

- **状态**：设计稿，待审阅
- **日期**：2026-08-21
- **目标**：在星屿（StarIsle）中实现类《Q宠大乐斗》的宠物对战玩法——好友桌宠自动回合制切磋 + 数值养成（等级成长 + 武器/防具/饰品 + 主动/被动技能）+ 战绩。对战作为**独立模块**，异步即时结算，不挂靠拜访/礼物链路；AI 战报解说为可选放量项。**适配 MVP 单好友槽**（设计稿 §6.1：每账号最多 1 个活动好友）：榜单/分层次数收敛为"唯一好友对比与统一限额"。
- **关联代码**：`packages/protocol/src/battle/*`、`packages/battle/src/*`（新增）、`packages/config/src/limits.ts`、`apps/server/src/routes/battles.ts`（新增）、`apps/server/migrations/0014_battles.sql`、`apps/desktop/src/app/battle.tsx`（新增）、`packages/pet-state/src/visual-mapping.ts`、`packages/ai-graph/src/graphs/battle-commentary.ts`（阶段 D，可选）
- **关联文档**：`AGENTS.md`、`docs/status-2026-08-03.md`、`docs/superpowers/specs/2026-08-01-ai-social-desktop-pet-design.md`（§3.1 好友关系 / §12.7 成本保护；§9.4 收件箱仅为可选集成项，非 MVP 依赖）

---

## 1. 玩法参考：Q宠大乐斗核心体验

从 [百度百科](https://baike.baidu.com/item/q%E5%AE%A0%E5%A4%A7%E4%B9%90%E6%96%97/6376315)、[新手指引](https://fight.qq.com/webplat/info/news_version3/805/1425/1427/m1291/201112/51309.shtml) 及社区攻略（[体力机制 1](http://www.07073.com/fight/gonglue/417161.html)、[体力机制 2](https://www.07073.com/fight/gonglue/417163.html)）归纳其核心：

| 系统      | 机制                                                                               |
| --------- | ---------------------------------------------------------------------------------- |
| 战斗      | 自动回合制一对一：属性 + 技能 + 随机（先手/闪避/暴击）决定每回合伤害，无需实时出招 |
| 数值      | 生命/攻击/敏捷等属性，等级随经验提升，派生"战力"用于匹配与排行                     |
| 体量/机会 | 挑战受**每日次数 + 冷却**限制（体力机制），好友互搏、防爆肝                        |
| 养成      | 升级、武器/防具/技能/道具，槽位装配，命格/称号                                     |
| 社交      | 挑战好友（好友可离线，战斗自动结算）、战报可见、乐斗榜排行                         |
| 目标感    | 每日任务/奖励、升级正反馈、好友间排名竞争                                          |

**借鉴边界（与 README「来源与许可」一致）**：只借鉴玩法交互思路与数值框架，不复制任何腾讯素材/代码/角色。

---

## 2. 设计目标与非目标

### 2.1 目标

1. **异步即结算（独立对战模块）**：发起挑战 → 服务端立即按双方档案结算 → 战报落 `battle_records`，双方均可拉取（好友不在线也能被挑战，登录打开乐斗场即可见）。MVP **不依赖**拜访/礼物/羁绊/收件箱链路；在线用户可选 WS 即时推送战报，离线用户由 `GET /battles/records` 拉取补齐。
2. **确定性可审计**：结算核心为纯函数 + 显式随机种子（可回放、可压测、可单测），服务端为唯一权威（不信任客户端数值，同 gift.ts 哲学）。
3. **零新增付费模型成本**：基础战报用模板；AI 解说走独立低成本档注入 + 免费审核（对齐 12.5/12.7）。
4. **社交闭环（最小依赖）**：挑战入口在好友页，仅校验 `friendships.status='active'` 与拉黑名单；战报存 `battle_records`（双方可查），WS 推送为可选增强，不写 `events/user_inbox`。**单好友适配**：MVP 无"好友圈榜单"，战绩为"我 vs 唯一好友"对比（多好友 P1 后再评估榜单，见 §12）。
5. **限额防刷**：每日次数/冷却/经验日上限/战力匹配范围全部进 `LIMITS`，feature flag 分阶段放量。
6. **内容丰富但克制**：武器/防具/饰品/主动与被动技能齐全，但**无货币、无商店、无随机强化**——产出靠首胜/每日任务宝箱，防止玩法与经济系统膨胀。

### 2.2 非目标（MVP 明确不做）

1. 实时同步对战（双方同时在线轮流出招、帧同步）——列为 P1 扩展，不在 MVP。
2. **付费/市场/强化经济**（RMB/乐斗币、商店、随机强化）——**明确不做**。武器/防具/饰品仅**任务/首胜宝箱**产出，无货币、无交易、无强化；重复获得自动折算经验。
3. **战斗道具与经脉系统**：MVP **不纳入**战斗道具（战斗前嗑药）与经脉/天赋树，后续按封测反馈评估（见 §12 第 3 项）。
4. **多对手好友圈榜单**：MVP 单好友槽下无意义——砍掉；待多好友（P1）落地后再评估（见 §12 第 2 项）。
5. 竞技场天梯匹配陌生人——MVP 不做（好友圈榜单也已砍，见非目标 4）；多好友 P1 后再评估。
6. 动画引擎级战斗演出（Live2D 骨骼对战）——用现有 React SVG/spritesheet/图片角色做动作映射与面板内回合动画。

---

## 3. 玩法与数值原型

### 3.1 属性与战力（6 项基准 + 派生）

每用户一份战斗档案（角色皮肤 = 外观，不影响数值）：

```
基础属性（随等级成长）：
  hp       生命   = 100 + 12 × level     受攻击消耗
  attack   攻击   = 10 + 2 × level       单次攻击伤害基准
  defense  防御   = 5 + 1.5 × level      伤害减免 = floor(defense × 0.35)
  speed    速度   = 5 + level            先手率与闪避率来源
  暴击率 = 5%（装备/被动可叠加）
  闪避率 = 3% + |Δspeed| × 0.5%（封顶 25%）
等级：level 1 起，由经验 exp 升级
战力 power = round(hp/5 + attack×2.2 + defense×1.5 + speed×1.5 + 装备评分)
```

### 3.2 回合结算（纯函数，seed 可复现）

单回合流程（最多 `maxRounds` 回合，超限按剩余 HP 判胜负、同 HP 判平局）：

1. **先手判定**：`mine / (mine + theirs)` 概率由 seed 掷出（饰品/技能可修正）。
2. **主动技能尝试**：先手方先掷（每技能独立触发率，触发后冷却 N 回合）；`眩晕波` 命中则对手本回合跳过行动。
3. **攻击判定**（未眩晕时按序）：
   - **闪避**：目标按 `dodgeRate` 判定 → 闪避成功则 25% 概率触发**反击**（60% 伤害反打）；
   - **暴击**：`critRate` 判定 → 伤害 ×1.6（武器暴伤修正叠加）；
   - **伤害**：`max(1, attack × (0.85~1.15) − defense × 0.35)`，再叠加武器特效 / 技能修正；
   - **命中特效**：连击（追加一次普攻）/ 吸血 / 眩晕，按装备技能表判定。
4. 攻守交替，直到一方 HP ≤ 0。

```
simulateBattle(challenger, defender, { seed }) → BattleSummary
```

`BattleSummary` 含回合序列（行动/伤害/双方余血/关键事件）与结果（challenger_win / defender_win / draw）。

> **攻防不对等**：防守方是"被打"，**不使用主动技能**（被动与装备特效仍生效）——公平且防刷（挑战需要备战成本，防守只是被动挨打拿保底）。

### 3.3 经验与成长

```
胜利（发起方胜）：exp + 40 + 对方等级×5；失败：exp + 12
防守方被动结算：胜 +20 / 败 +6（防守不吃亏但奖励低于主动挑战）
每日经验日上限：dailyExpCap（防小号互刷爆肝）
升级所需：level 升 n 需 n×50 exp（累进）
```

### 3.4 每日限制（进 LIMITS）

| 限额                     | 默认值 | 说明                                                                                                   |
| ------------------------ | ------ | ------------------------------------------------------------------------------------------------------ |
| `battlesPerFriendPerDay` | 1      | 同一好友每日最多被挑战/挑战 1 次（MVP 唯一好友即全部对手；多好友后按好友独立计数）                     |
| `battlesPerDay`          | 4      | 后端兜底上限（单好友下已被 `battlesPerFriendPerDay` 封顶；多好友时生效）                               |
| `battleCooldownMs`       | 30 min | 两次主动挑战间隔（体感节奏）                                                                           |
| `dailyExpCap`            | 300    | 每日经验获取上限                                                                                       |
| `powerMatchRangeRatio`   | 0.5    | **软提示**（不硬拒绝）：战力/等级差悬殊时提示"实力悬殊"，仍可挑战——单好友下无第二人选，硬拒绝=无仗可打 |
| `dailyChestPerDay`       | 2      | 每日可领取宝箱次数（首胜 1 + 每日任务 1）                                                              |
| `maxRounds`              | 30     | 单场回合上限（30×~10 判定，单次结算 <10ms）                                                            |

### 3.5 武器 / 防具 / 饰品（3 槽 + 品质）

```
品质：白1 / 绿2 / 蓝3 / 紫4 / 金5 —— 数值系数 q = 1.0 / 1.2 / 1.5 / 1.9 / 2.4

武器（攻击主加成 + 特效）：
  宽刃剑  atk+15%×q   特效：暴击伤害 +25%
  蛇影弓  atk+10%×q   特效：10% 概率追加一次普攻（连击）
  折凳    atk+18%×q   特效：8% 概率眩晕 1 回合
  桃花扇  atk+12%×q   特效：吸血 8%（回复造成伤害的 8%）
防具（防御/生命主加成 + 特效）：
  金丝软甲 def+20%×q  特效：受击伤害 -6%
  皮甲     def+15%×q  特效：被暴击伤害 -15%
  寒玉护符 hp+15%×q   特效：受致命一击时保留 1HP（每场一次）
饰品（速度/概率加成）：
  疾风挂坠 speed+15%×q  特效：闪避 +6%
  夜明珠    暴击 +5%×q  特效：先手率 +10%
  四叶草    闪避 +5%×q  特效：暴击 +3%
```

> 模板数据集中在 `packages/battle/src/data.ts`（服务端白名单 + zod 校验）。名称仅借鉴通用奇幻概念（宽刃剑/蛇影弓/折凳等为玩法参考，见 [武器效果全解析](https://www.40407.com/news/201209/146896.html)、[蛇影弓](https://baike.baidu.com/item/%E8%9B%87%E5%BD%B1%E5%BC%93/15460540)、[折凳](https://baike.baidu.com/item/%E6%8A%98%E5%87%B3/0)），素材/数值均原创（README 许可边界不变）。

### 3.6 技能（2 主动 + 1 被动）

```
主动技能（每回合按触发率尝试，触发后冷却 N 回合）：
  重击    1.5×atk 伤害          触发 30%  冷却 2 回合
  烈焰    1.3×atk、无视 30% 防御 触发 25%  冷却 3
  治疗术  恢复 20% 最大 HP       触发 25%  冷却 4
  连击    追加一次普攻           触发 20%  冷却 3
  眩晕波  跳过对手下回合行动     触发 15%  冷却 4
被动技能（常驻修正，与装备叠加）：
  坚韧  def+10%    疾风  闪避+8%    狂暴  暴击+8%
```

> 技能参考 [帮派技能](https://baike.baidu.com/item/%E5%B8%AE%E6%B4%BE%E6%8A%80%E8%83%BD/65401796) 的主动/被动分法与触发式设计；冷却/触发机制原创。技能随等级解锁：主动技能 5 级解锁第 1 槽、10 级第 2 槽；被动 15 级解锁（防新人开局碾压）。

### 3.7 装备获取循环（无货币、无商店）

```
获取循环（无经济系统，产出全部来自玩法本身）：
  ① 首胜宝箱（每日 1 次）：随机获得一件品质 ≥ 绿的武器/防具/饰品
  ② 每日任务宝箱（每日 1 次）：随机一件品质 ≥ 蓝的装备
  ③ 输方安慰：每日前 3 次战败各加 10 exp（小额，非装备）
  ④ 重复装备自动折算经验；装备实例上限 200/人（超出滚动清理最早未穿戴者）
```

> **战斗道具与经脉系统已砍**（2026-08-21 评审）——MVP 不包含战斗前嗑药与经脉/天赋树；后续按封测反馈评估（见 §12 第 3 项）。武器/防具/饰品名称仅借鉴通用奇幻概念（详见 §3.5 注），素材/数值均原创。

---

## 4. 系统架构与落点（严格对齐 AGENTS.md 约定）

```
新增 packages/battle       纯逻辑（属性成长/战力/回合结算/装备技能模板 data.ts/限额规则）——依赖仅 @pet/protocol
新增 packages/protocol/src/battle/   领域类型 + zod schema（唯一真相源，禁子路径 import）
新增 apps/server/src/routes/battles.ts   挑战/档案/战绩/对比 API（requireAuth + 应用层权限校验）
新增 apps/server/migrations/0014_battles.sql
新增 apps/desktop/src/app/battle.tsx     面板页（档案/挑战/战绩/对比）+ styles
修改 packages/config/src/limits.ts + feature-flags.ts   battleArena 开关 + 限额
修改 packages/pet-state/src/visual-mapping.ts          战斗相关动作映射（复用现有动作，见 §7）
```

> 好友/拉黑校验复用 `apps/server/src/lib/relationships.ts` 的 `findActiveFriendship / isBlocked`（仅查询复用，不引入拜访/礼物的写入链路）。

### 4.1 约定遵守清单（实现时逐条对照）

1. **类型单一真相源**：所有跨端类型/校验放 `@pet/protocol`；battle 包只 import 根入口。
2. **图而非过程函数**：战斗结算不是 AI 流程（10.1），不强制状态图；但允许用 `StateGraph` 表达"回合循环"以获得观测/重放（二选一：纯函数 `simulateBattle` 为 MVP 推荐，graph 版为可选替代）。
3. **数据库提交即真相**：挑战事务内完成 结算→battle_records→双方档案更新。通知不是真相：在线用户由 WS 推送，离线用户由 `GET /battles/records` 拉取补齐；MVP 不强制 `events/user_inbox`（AGENTS.md 约定 3 的收件箱投递仅在需要统一收件箱体验时接入）。
4. **应用层权限校验为主** + 事务开头 `set local request.jwt.claims`（RLS 兜底，migration 里加 battle 表 RLS 策略）。
5. **限额防刷**：每日计数/冷却/战力范围在服务端校验（对齐 12.7 成本保护思路）。
6. **IPC 安全基线**：桌面端挑战调用走既有 `api client` + IPC 校验，不新增无校验通道。
7. **审核成本**：AI 战报解说（阶段 D）走独立低成本模型注入 + 免费 Moderation（复用 `moderation.ts`）。
8. **密钥留服务端**：无新增密钥需求。

---

## 5. 数据模型（migration 0014 草案）

```sql
-- 0014_battles.sql
create table if not exists battle_profiles (
  user_id      uuid primary key references profiles(user_id) on delete cascade,
  level        int  not null default 1,
  exp          int  not null default 0,
  hp           int  not null,
  attack       int  not null,
  defense      int  not null,
  speed        int  not null,
  power        int  not null,
  wins         int  not null default 0,
  losses       int  not null default 0,
  weapon_id    uuid references battle_gear(gear_id) on delete set null,
  armor_id     uuid references battle_gear(gear_id) on delete set null,
  accessory_id uuid references battle_gear(gear_id) on delete set null,
  skill_a      text,          -- 服务端白名单主动技能 id，可空
  skill_b      text,
  passive_skill text,         -- 被动技能 id，可空
  daily_battles int not null default 0,   -- 今日主动挑战数（懒重置：按 updated 日期比较）
  daily_exp    int not null default 0,    -- 今日获得经验（懒重置）
  daily_chests int not null default 0,    -- 今日已领宝箱数（懒重置）
  updated_at   timestamptz not null default now()
);

-- 已拥有装备（实例表；模板数据在 packages/battle/src/data.ts 白名单内）
create table if not exists battle_gear (
  gear_id      uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references profiles(user_id) on delete cascade,
  template_id  text not null,           -- 'broad_sword' | 'snake_bow' | …
  quality      int  not null check (quality between 1 and 5),
  source       text not null,           -- 'starter' | 'first_win' | 'daily_task'
  created_at   timestamptz not null default now()
);

-- 审计账本：宝箱领取/装备穿戴/重复折算（11.2 审计精神）
create table if not exists battle_ledger (
  ledger_id  uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(user_id) on delete cascade,
  action     text not null,             -- 'chest_claim' | 'gear_equip' | 'gear_repeat_exp' | 'gear_starter'
  detail     jsonb not null,
  created_at timestamptz not null default now()
);

-- 幂等/防重复挑战：同 (challenger, defender, 日期) 唯一
create table if not exists battle_records (
  record_id      uuid primary key default gen_random_uuid(),
  challenger_id  uuid not null references profiles(user_id) on delete cascade,
  defender_id    uuid not null references profiles(user_id) on delete cascade,
  winner_id      uuid,                     -- null = draw
  rounds         int  not null,
  outcome        text not null check (outcome in ('challenger_win','defender_win','draw')),
  seed           bigint not null,          -- 结算种子（回放/审计）
  summary        jsonb not null,           -- BattleSummarySchema：回合序列 + 模板战报
  created_at     timestamptz not null default now(),
  check (challenger_id <> defender_id)
);
create index if not exists battle_records_user_idx on battle_records (challenger_id, created_at desc);
create index if not exists battle_records_defender_idx on battle_records (defender_id, created_at desc);

-- RLS（纵深防御，主防线仍是应用层；auth.uid() 为 0000 兼容层函数，
-- 事务内 set_config('request.jwt.claims', rlsClaimsJson(userId), true) 注入）
alter table battle_profiles enable row level security;
alter table battle_gear enable row level security;
alter table battle_ledger enable row level security;
alter table battle_records enable row level security;
create policy battle_profiles_self on battle_profiles
  for select using (user_id = auth.uid());
create policy battle_gear_self on battle_gear
  for select using (owner_id = auth.uid());
create policy battle_ledger_self on battle_ledger
  for select using (user_id = auth.uid());
create policy battle_records_party on battle_records
  for select using (challenger_id = auth.uid() or defender_id = auth.uid());
```

> 注：`daily_*` 字段用"日期字段 + 懒重置"（避免新增每日表与定时任务）。MVP **不写** `events/user_inbox`——战报只存 `battle_records`，双方按各自 user_id 查询。若未来要统一收件箱体验，可补事件投递（`type='battle.finished'`，A 类）作为可选增强。

### 5.1 档案生命周期（lazy init + 防守方虚拟化）

1. **lazy init**：用户首次打开乐斗场（GET `/battles/profile`）或首次被挑战时，事务内按等级公式物化 `battle_profiles` 行并发放 **starter 装备**（白色宽刃剑 + 皮甲 + 四叶草，`battle_ledger.action='gear_starter'`）——不在 migration 里为所有用户造行。
2. **防守方无档案**：对手从未打开乐斗场 → 挑战时按「Lv.1 默认公式 + 无装备 + 无技能」**虚拟化防守档案**（公平默认：没养成的对手不强）；档案例不存在时防守奖励照发（`wins/losses` 记在 `battle_records`，防守方下次打开乐斗场再 lazy init 并累加）。
3. **幂等**：lazy init 用 `insert ... on conflict do nothing` + 返回行，重复请求不重复发 starter。

---

## 6. API 契约（routes/battles.ts）

全部走 `requireAuth`；请求体不信任客户端数值（toUserId / skillId 白名单校验，其余服务端算）。挑战不依赖拜访/礼物/羁绊链路，仅依赖好友关系与拉黑校验。

| 方法 | 路径                                | 说明                                                                                                                                  |
| ---- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | `/battles/profile`                  | 我的档案（属性/等级/经验/装备三槽/技能槽/今日剩余次数）                                                                               |
| GET  | `/battles/inventory`                | 我的装备实例列表（含穿戴状态）                                                                                                        |
| POST | `/battles/gear/equip`               | `{ gearId, slot }` 穿戴/卸下（slot ∈ weapon/armor/accessory；先卸旧件再上新）                                                         |
| PUT  | `/battles/profile/skills`           | `{ skillA?, skillB?, passiveSkill? }` 更换技能（白名单 + 等级解锁校验）                                                               |
| POST | `/battles/claim`                    | `{ chest: 'first_win'                                                                                                                 | 'daily_task' }`领取宝箱（校验`dailyChestPerDay`；产出入 `battle_gear`+`battle_ledger`） |
| POST | `/battles/challenge`                | `{ toUserId, clientEventId? }` → 校验好友+拉黑+每日限额+冷却+战力范围 → 结算（含装备/技能修正）→ 事务落库 → 返回 `BattleSummary` 摘要 |
| GET  | `/battles/records?limit=20&before=` | 我的战报列表（含**我作为挑战方或防守方**的记录、对手显示名/胜负/回合数/摘要）                                                         |
| GET  | `/battles/records/:recordId`        | 单场战报明细（含完整回合序列，供回放动画）                                                                                            |
| GET  | `/battles/matchup`                  | 与唯一好友的对比（双方等级/战力/胜率/装备名+品质摘要、历史战绩、羁绊进度）——替代多好友榜单                                            |

**挑战响应示例**：

```json
{
  "recordId": "…", "outcome": "challenger_win",
  "rounds": 7, "expDelta": 45,
  "summary": { "seed": 12345, "rounds": [ { "attacker": "challenger", "action": "attack", "damage": 18, "crit": false, "hpAfter": {"challenger": 62, "defender": 40} }, … ] }
}
```

### 6.1 事件负载（protocol）

```ts
// packages/protocol/src/battle/index.ts
export const BattleOutcomeSchema = z.enum(['challenger_win', 'defender_win', 'draw']);
export const BattleTurnSchema = z
  .object({
    attacker: z.enum(['challenger', 'defender']),
    action: z.enum(['attack', 'dodge', 'crit', 'counter', 'skill']),
    skillId: z.string().optional(),
    damage: z.number().int().nonnegative(),
    crit: z.boolean(),
    hpAfter: z.object({ challenger: z.number().int(), defender: z.number().int() }),
  })
  .strict();
export const BattleSummarySchema = z
  .object({ seed: z.number().int(), rounds: z.array(BattleTurnSchema) })
  .strict();
export const BattleProfileSchema = z
  .object({
    level: z.number().int().positive(),
    exp: z.number().int().nonnegative(),
    hp: z.number().int().positive(),
    attack: z.number().int().positive(),
    defense: z.number().int().nonnegative(),
    speed: z.number().int().positive(),
    power: z.number().int().positive(),
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    weaponId: z.string().uuid().nullable(),
    armorId: z.string().uuid().nullable(),
    accessoryId: z.string().uuid().nullable(),
    skillA: z.string().nullable(),
    skillB: z.string().nullable(),
    passiveSkill: z.string().nullable(),
  })
  .strict();
export const BattleGearSchema = z
  .object({
    gearId: z.string().uuid(),
    templateId: z.string(),
    quality: z.number().int().min(1).max(5),
    slot: z.enum(['weapon', 'armor', 'accessory']),
    equipped: z.boolean(),
  })
  .strict();
export const ChallengeRequestSchema = z
  .object({ toUserId: z.string().uuid(), clientEventId: z.string().optional() })
  .strict();
/** （可选增强，仅接入 events 收件箱时启用；MVP 不依赖） */
export const BattleFinishedPayloadSchema = z
  .object({
    recordId: z.string().uuid(),
    outcome: BattleOutcomeSchema,
    expDelta: z.number().int(),
    summary: BattleSummarySchema,
  })
  .strict();
```

> 装备/技能模板键（`battle_gear.template_id`、`skill_a`、`skill_b`、`passive_skill`）全部由 `packages/battle/src/data.ts` 导出并经 schema 校验，服务端白名单判定，不信任客户端任意字符串。

---

## 7. 桌宠表现

### 7.1 动作映射（MVP 复用现有动作，不扩张 ActionIntent）

| 场景          | 动作       | 说明                                                                                       |
| ------------- | ---------- | ------------------------------------------------------------------------------------------ |
| 战胜          | `cheer`    | 已有动作（HOSTING/IDLE 白名单内）                                                          |
| 战败 / 被连败 | `sad`      | 已有动作                                                                                   |
| 被挑战提示    | `wave`     | 防守方打开乐斗场"战绩"可见新战报；在线时可选 WS 推送提示                                   |
| 面板战报回放  | 面板内动画 | 每回合切表情/位置（攻击→surprised、闪避→surprised+位移、胜利→happy、失败→sad），不动桌宠窗 |

可视化映射新增只改 `visual-mapping.ts` 的**组合/辅助函数**（如 `battleMoodToExpression(outcome)`），**不新增 PetMotion**（避免动 model-manifest 与各渲染器帧表；P2 再评估新增 attack/dodge 专用动作）。

### 7.2 面板页面（apps/desktop/src/app/battle.tsx + panel.css）

复用现有棉花糖浅色主题 token（`--panel-accent` / `--panel-surface` / `--panel-border` / `--radius-*`）与 `app.tsx` tab 机制。

- **乐斗场入口**：面板新增「乐斗场」tab；好友页每个好友卡片在「送点心/拜访」旁增加「切磋」按钮（friends.tsx 的 `friend-actions` 区）。
- **Tab 1 战备/档案**（见下方线框）：档案卡 + 属性 + 装备三槽 + 技能三槽 + 宝箱/挑战次数入口。
- **Tab 2 好友挑战**：好友卡片扩展对手摘要（Lv/战力/胜率/装备名+品质，**特效与技能配置隐藏**）；确认弹层 → 战报回放弹层。
- **Tab 3 战绩与对比**：战绩统计 + 战报列表 + **「我 vs 唯一好友」对比卡**（等级/战力/胜率/装备摘要/羁绊进度——替代被砍的多好友榜单）。
- 降级：后端不可达/未启用 flag → 入口隐藏或显示"乐斗场建设中"。

#### Tab 1 战备/档案 线框

```
┌─ 乐斗场 · 战备 ────────────────────────────┐
│  ┌───────────────────────────────┐        │
│  │ [角色头像]  Lv.12 ★           │        │
│  │          战力 2,340            │        │
│  │ [███████████░░░░] 经验 420/600 │        │
│  └───────────────────────────────┘        │
│  属性  ♥244  ⚔34  🛡26  ⚡17  暴击5% 闪避8% │
│  装备                                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐      │
│  │武器      │ │防具      │ │饰品      │      │
│  │蛇影弓    │ │金丝软甲  │ │四叶草    │      │
│  │[蓝]攻击+ │ │[金]防御+ │ │[紫]闪避+ │      │
│  │连击10%   │ │受击-6%   │ │暴击+3%   │      │
│  └─────────┘ └─────────┘ └─────────┘      │
│  技能                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │主动① 重击 │ │主动② 烈焰 │ │被动 🔒Lv15│   │
│  │触发30%   │ │触发25%   │ │未解锁     │   │
│  └──────────┘ └──────────┘ └──────────┘   │
│  宝箱 [首胜宝箱][每日任务宝箱]  今日挑战 3/8 │
└───────────────────────────────────────────┘
```

#### 背包与装备详情（战备页内弹层）

```
┌─ 背包（按槽分组，品质色卡网格）──────┐
│ 武器 ✕3       防具 ✕2       饰品 ✕1 │
│ ▦蛇影弓·蓝✓   ▦金丝软甲·金✓  ▦四叶草·紫✓│
│ ▦宽刃剑·白    ▦皮甲·绿                 │
│ ▦折凳·白                               │
└──────────────────────────────────────┘
点某件 → 详情卡：
┌─ 蛇影弓 · 蓝 ──────────────────┐
│ 攻击 +10%×q(1.5) = +15%        │
│ 特效：10% 概率追加一次普攻       │
│ 来源：首胜宝箱                   │
│ [穿戴到武器槽]（已穿戴→[卸下]）  │
│ [折算经验]（重复件灰置）         │
└────────────────────────────────┘
```

#### 战报回放弹层（挑战结果）

```
┌─ 战报回放 ─────────────────────────┐
│  🐱 星屿  vs  🐱 bob               │
│  ♥ 140/244     ♥ 90/210            │
│ R3 你闪避了 bob 的攻击！            │
│ R3 你触发【重击】！造成 78 伤害     │
│ R3 【暴击！】×1.6 → 120 伤害        │
│ R4 bob 触发【烈焰】…                │
│ ⏮ ◀ ▶ ⏭        （播放/跳过）      │
│ ──────────────────────────────    │
│ 🏆 胜利！ +52 经验                  │
│ 掉落：[蓝]蛇影弓（重复 → +30 经验） │
└────────────────────────────────────┘
```

### 7.3 装备/技能视觉规范（新增 panel.css token，不新增图片资源）

1. **品质色**（与棉花糖浅色主题协调，用卡片左边框 4px 色条 + 名称角标，不用大面积底色）：

   | 品质 | 色值      | 角标 |
   | ---- | --------- | ---- |
   | 白   | `#E5E7EB` | 白   |
   | 绿   | `#34D399` | 绿   |
   | 蓝   | `#60A5FA` | 蓝   |
   | 紫   | `#C084FC` | 紫   |
   | 金   | `#FBBF24` | 金   |

2. **槽位图标**：武器 ⚔️ / 防具 🛡️ / 饰品 ✨（内联 SVG 或 emoji，保持"无图片素材、全原创"原则）；空槽显示 `+` 占位并整卡可点（打开背包）。
3. **技能卡**：圆角色块 + 技能名首字徽章（无图标资源）；主动技能显示「触发率/冷却」，被动显示「常驻」；未解锁显示 🔒 + 等级条件。
4. **对手公开范围（产品决策）**：好友卡片仅展示对方 **等级/战力/胜率/装备名+品质**；**特效与技能配置隐藏**（保留试错与神秘感，与浅层社交调性一致）。
5. **状态反馈**：复用既有 `notice--success / error / warning` token——胜利绿、战败红、掉落金；挑战冷却/次数不足时按钮禁用并给出剩余时间文案。
6. **动效**：战报回放步进复用 `styles.css` 既有缓动曲线（`--ease-spring` 等）；回合关键帧（暴击/闪避/技能）用 CSS 类切换表情（复用 `battleMoodToExpression` 映射）；桌宠窗在结算后由 Main 播 `cheer/sad`。
7. **可访问性**：装备/技能卡带 `aria-label`（如 `蛇影弓 蓝色，攻击加成百分之十五，特效追加普攻`）；回放支持暂停/跳过；不自动播放声音。

---

## 8. 差异化结合（阶段 D 起，全部可选，不影响 MVP）

1. **AI 战报解说**：模板产出基础战报（"第 3 回合你闪避了 xx 的攻击！"）；`battle-commentary.ts`（ai-graph 图，独立低成本模型注入 + 免费 Moderation）把回合摘要改写成有个性的叙事战报，回填 `battle_records.summary`。
2. **记忆/羁绊联动（可选扩展，默认关闭）**：若后续要打通社交记忆，可为切磋结果给 `bonds.progress +1` 或写共享记忆候选（走 10.6 既有管线）。**MVP 不做**——与拜访/礼物链路解耦。
3. **聊天联动（可选）**：若启用了第 2 项，chat-flow 检索到切磋记忆后桌宠会记得输赢并调侃/安慰（复用 10.7 记忆检索，零新图）。

---

## 9. 风控与反作弊

- 服务端结算唯一权威；客户端只传 `toUserId/gearId/skillId`；装备/技能模板 id 全部服务端白名单（`data.ts` 导出 + zod 校验）。
- 每日每好友 1 次 + 每日总上限 + 冷却 + 经验日上限，四项组合封住"小号互刷"主要路径（宝箱领取同样每日限次）。
- 实力悬殊**软提示**（不硬拒绝，MVP 单好友下无第二人选）；防守方不受亏：防守奖励保底。
- 装备实例归属校验：穿戴/卸下只允许操作自己的 `battle_gear`（事务内校验 owner_id = 当前用户），宝箱产出走 `battle_ledger` 审计。
- 确定性种子落库 → 运营可审计回放；前端回放动画只是渲染 `summary`，不重新结算。
- 好友关系校验：挑战仅限 `friendships.status='active'`，拉黑名单内拒绝（复用 `isBlocked/findActiveFriendship`）。
- 事件幂等：挑战按钮防抖 + 服务端 `clientEventId + receipt` 幂等模式（防双击重复挑战；模式与既有业务一致，但与拜访/礼物数据表无关）。

---

## 10. 分阶段实施路线

### 阶段 A：纯逻辑核心（无后端/UI 依赖）

- 新建 `packages/battle`：`attributes.ts`（成长/战力/装备加成聚合）、`data.ts`（武器/防具/饰品/技能模板表，白名单键 + zod 校验）、`simulate.ts`（回合结算：先手/技能/闪避反击/暴击/伤害/特效，seed 注入）、`rules.ts`（每日限额/战力范围/宝箱掉落判定）。
- 单测：属性成长边界、装备/技能对各条判定的修正、闪避/暴击/反击/连击/吸血/眩晕/治疗/平局/回合上限、掉落概率分布、限额规则；**seed 相同 → 结果相同**（确定性锁定）。
- 产出：vitest 全绿。

### 阶段 B：协议 + 数据 + 服务端

- `packages/protocol/src/battle/index.ts`（§6.1 schema；`BattleFinishedPayloadSchema` 标注可选）。
- `migrations/0014_battles.sql`（§5：battle_profiles 含装备/技能字段 + battle_gear/battle_ledger/battle_records + RLS 策略）。
- `routes/battles.ts`（§6）：挑战（事务：结算+记录+双方档案更新）、档案、库存、穿戴、技能、宝箱领取、战绩（含防守方视角）、对比。
- `config/limits.ts` + `feature-flags.ts` 新增 battleArena 限额（含 `dailyChestPerDay`）/开关。
- 单测：挑战全链路（好友/非好友/拉黑/超限/战力范围软提示/幂等/防守奖励/**lazy init 幂等**/**防守方虚拟化**）、战绩对比、防守方可查记录、宝箱掉落与限额、装备穿戴归属校验。
- e2e：`e2e/battle.spec.ts`（预置 alice/bob 好友 → 挑战 → 战报双方可见；后端不可达自动 skip，沿用既有惯例）。

> **MVP 范围 = 阶段 A + B + C**（无榜单、无实时、无 AI 解说、无道具/经脉）；阶段 D（AI 解说）独立立项，封测后按反馈决定。

### 阶段 C：桌面端

- `app/battle.tsx` 三 Tab（战备档案/挑战/战绩对比）+ 面板路由 + 样式；挑战入口（好友页 + 菜单）。
- 战报回放动画（回合序列逐步播放：闪避/暴击/反击/技能特效）+ `visual-mapping.ts` 表情组合。
- e2e：`star-isle.spec` 风格打开面板 → 乐斗场 → 战备穿戴 → 挑战 alice → 看到战报。

### 阶段 D：AI 解说（可选放量）

- `ai-graph` 的 `battle-commentary.ts` 图 + 低成本模型注入 + Moderation（复用）。
- 战报叙事化回填 `battle_records.summary`。
- 打磨：动作/文案/战绩对比变化 toast；管理后台 `admin-pets` 扩展查看 battle 档案（P2）。
- **不做**：记忆/羁绊联动（如后续要，按 §8 第 2 项独立评审）。

**验收线**：每阶段结束 `pnpm test`、`typecheck`、`lint`、`format` 全绿；阶段 B 后 `pnpm migrate` 可重复应用（幂等）；阶段 C 后 Windows 真机截图验收。

---

## 11. 落点索引新增行（供 AGENTS.md 功能落点速查表）

| 你要做的事                                       | 改这里                                               |
| ------------------------------------------------ | ---------------------------------------------------- |
| 改对战数值/回合结算/成长                         | `packages/battle/src/*`（纯逻辑，可单测）            |
| 改武器/装备/技能模板与掉落                       | `packages/battle/src/data.ts`                        |
| 改乐斗 API（挑战/档案/库存/穿戴/宝箱/战绩/对比） | `apps/server/src/routes/battles.ts`                  |
| 改乐斗表/RLS                                     | `apps/server/migrations/0014_battles.sql`            |
| 改乐斗面板页                                     | `apps/desktop/src/app/battle.tsx` + `panel.css`      |
| 改对战限额/开关                                  | `packages/config/src/limits.ts` + `feature-flags.ts` |
| 改 AI 战报解说                                   | `packages/ai-graph/src/graphs/battle-commentary.ts`  |

---

## 12. 风险与开放问题

1. **数值平衡**：MVP 数值是"玩法原型"级别，需要封测调校（沿用 2026-08-03 P0 桌宠目测调优的迭代方式）。**概率封顶**：暴击/闪避/先手等叠加必须 clamp（建议 ≤30%/30%），防装备+技能+饰品叠出极端值。
2. **多好友（P1）落地后再评估**：好友圈榜单、分层次数（`battlesPerDay` 生效）、实时同步对战（30s 窗口轮流出招，依赖 `ws.ts` 在线状态与房间机制）——MVP 全部不做，避免单好友在场的复杂度空转。
3. **内容扩展方向**：若封测反馈良好，可扩展——强化（消耗重复装备）、更多技能/装备模板、以及**战斗道具与经脉系统**（§3.7 已砍，列为后补候选）；反之收缩（去掉某一层系统）。模板全部集中在 `data.ts + LIMITS`，便于开关。
4. **单好友成长节奏**：每日 1 战 + 2 宝箱的产出节奏偏慢，装备池（10 模板 × 5 品质）约 3–4 周可集齐——封测期确认"毕业速度"与留存是否匹配，必要时调宝箱频率/经验曲线。
5. **不与现有"拜访/礼物"体验冲突**：乐斗入口独立成 Tab，不挤占既有社交动线。
6. **新手引导**：lazy init 发放 starter 装备后，首次进乐斗场需简短引导（什么是战力/槽位怎么穿），hook 到面板既有 onboarding 风格。

---

## 附：参考资料

- 《q宠大乐斗》玩法：[百度百科](https://baike.baidu.com/item/q%E5%AE%A0%E5%A4%A7%E4%B9%90%E6%96%97/6376315) · [新手指引](https://fight.qq.com/webplat/info/news_version3/805/1425/1427/m1291/201112/51309.shtml)
- 每日体力/次数机制：[攻略 1](http://www.07073.com/fight/gonglue/417161.html) · [攻略 2](https://www.07073.com/fight/gonglue/417163.html)
- 武器体系与特效：[武器效果全解析](https://www.40407.com/news/201209/146896.html) · [蛇影弓](https://baike.baidu.com/item/%E8%9B%87%E5%BD%B1%E5%BC%93/15460540) · [折凳](https://baike.baidu.com/item/%E6%8A%98%E5%87%B3/0)
- 技能/被动（主动/被动分法、触发式设计）：[帮派技能](https://baike.baidu.com/item/%E5%B8%AE%E6%B4%BE%E6%8A%80%E8%83%BD/65401796)
- 回合制战斗通用设计参考（实现对照）：[Cocos-PetBattle（回合制，乐观帧同步）](https://github.com/gokepler/Cocos-PetBattle)
