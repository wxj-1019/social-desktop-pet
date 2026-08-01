# Live2D 许可书面咨询邮件（V-1 · 第 0–1 周发出）

> 收件渠道：https://www.live2d.jp/eng/application-publication-license/ 表单，或 license 问询入口
> 邮件语言：英文（Live2D 官方支持英语/日语）
> 发送方：产品负责人（团队 2–3 人，公司年销售额 < ¥1000 万 → Small-Scale）
> 截止：**立即发出**（官方要求发布前至少 1 个月启动签约流程，回复周期不可控）
> 完成后：将书面回复归档到 `docs/legal/` 并回填决策清单 V-1

---

## 邮件正文（复制即可发送）

**Subject: Pre-development License Classification Inquiry — AI Desktop Pet (1 Built-in Original Character + Paid Costume DLC, Windows Only, No User Model Import)**

Dear Live2D Licensing Team,

We are developing a desktop AI companion application ("desktop pet") using the Cubism SDK, currently in the pre-release verification stage. Before finalizing our architecture, we respectfully request your **written classification** on the following points. We will not develop the marked features until your written response is received.

**About our product (current scope):**

- Platform: Windows 10/11 x64 desktop application only (macOS may follow in a later version).
- The application ships with **exactly one (1) original Live2D character model** that we create ourselves.
- **End users cannot import, upload, or load any external Live2D models.** No character store, no plugin system, no user-generated content.
- AI dialogue (text) drives the model's expressions and motions.
- Monetization: free base app + paid costume DLC (see Section 2 for implementation details). No subscription in MVP.
- Company scale: small-scale enterprise (annual sales < JPY 10,000,000).

**Section 1 — Baseline configuration (confirmation)**

1. Our baseline configuration (one built-in original model, no user-imported models, AI-driven expressions/motions) — does this fall under the **standard SDK Release License (Plan F/G)**, and is it correct that it is **NOT an "Expandable Application"** under EULA §1.5?

**Section 2 — Costume system (the critical grey area)** 2. We intend to sell additional costumes as DLC. Two implementation options are under consideration:

- **(A)** Each costume is delivered as a **separate, complete .moc3 model file**; the app loads one at a time as a whole-model replacement.
- **(B)** Costumes are implemented as **part/texture switches within a single .moc3 model** (no new model files added at runtime; model count always = 1).
  **Q: Under EULA §1.5 "indefinite number of models by adding or combining files or data", which of (A) or (B) would you classify as an Expandable Application? Is (B) explicitly outside the Expandable definition?**

3. If we ship a **finite, fixed set** of costume models bundled at install time (no post-launch additions), does that change the classification versus an **indefinite, ongoing** costume DLC pipeline?

**Section 3 — Distribution & monetization classification** 4. Our monetization is: free base app + paid costume DLC. **Q: Which Content Plan applies — Plan F (One-time, PC), Plan G (Running Royalty), or a combination?** Note Plan F's terms appear to exclude in-app purchases. 5. We are currently a Small-Scale Enterprise (annual sales < JPY 10,000,000). **Q: Confirm that under this scale, both Plan F and Plan G fees are ¥0, and that we are still required to execute (sign) the Publication License Agreement even though no fee is payable.** 6. **Q: How should we classify Windows desktop distribution?** Plan G's platform list (iOS/Android/HarmonyOS/Web) does not explicitly name desktop. Is desktop handled under Plan F, or under a separate arrangement?

**Section 4 — Future features (will NOT develop until classified)** 7. A future "character store" where **we (the provider) sell additional original characters we create** (still no user-imported models). **Q: Does a provider-operated store selling first-party model additions constitute an Expandable Application under §1.5(a) or §1.5(c)?** 8. A future plugin/extension system allowing third-party code. **Q: Confirmation that this triggers Expandable classification and requires the special Publication License Agreement.**

**Section 5 — Compliance details** 9. **Q: What are the exact logo/credit display obligations** for our product (placement, wording, size)? We understand a copyright statement is required — please provide the canonical text and placement spec. 10. **Q: Are there any restrictions on combining the Cubism SDK with generative AI** for driving model motion/expressions, beyond the standard license terms? 11. **Q: Confirm that the Cubism Editor license (used by our artists to create models) is separate from the SDK publication license**, and that PRO for indie is sufficient for our artists given our Small-Scale status.

We aim to begin the Publication License Agreement process at least one month before release. Thank you for your guidance.

Best regards,
[Your Name / Studio Name]
[Contact Email]

---

## 发送前核对清单

- [ ] 邮件里保留"我们不会在收到书面回复前开发标注功能"（Sections 1/2 的关键保护）
- [ ] 附上产品一句话介绍（可选，降低被当作垃圾邮件的概率）
- [ ] 记录发送日期与渠道（回填决策清单 V-1 时限：第 1–2 周门禁前）
- [ ] 收到回复后：归档书面裁定 + 确认服装实现方式（D-8 部件级换装）归类

## 背景依据（用于内部判断，不需发给 Live2D）

- 按[调研发现 §3](./2026-08-01-research-findings.md)：Small-Scale 下 Plan F/G 费用为 ¥0，但**签约义务仍存在**；样本素材（Kei/Epsilon）严禁商用（EULA §5.5）；产品名不得含 "Live2D"（§5.3.1）
- 关键判断：部件级换装（方式 B）大概率不触发 Expandable（模型数恒为 1）；独立模型文件（方式 A）触发 §1.5(a) 风险
- 若书面裁定方式 B 仍要求专项许可：Small-Scale 下费用仍为 0，但需评估签约复杂度（备选方案：Spine/E-mote，见调研发现 §3.5）
