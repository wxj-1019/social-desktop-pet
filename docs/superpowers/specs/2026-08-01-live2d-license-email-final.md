# Live2D 许可咨询邮件 —— 成品版（可直接复制发送）

> 发送人：Coconut Latte（生椰拿铁）· 18967498922@163.com
> 发送渠道：https://www.live2d.jp/eng/application-publication-license/ 表单（推荐），或官网 Contact 许可入口
> 发送日期：**✅ 已发送（2026-08-01，官网表单）**
> 收到回复后：归档到 docs/legal/ 并回填决策清单 V-1

---

## 主题（Subject，复制）

```
Pre-development License Classification Inquiry — AI Desktop Pet (1 Built-in Original Character + Paid Costume DLC, Windows Only, No User Model Import)
```

## 正文（Body，复制下面全部内容）

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

**Section 2 — Costume system (the critical grey area)**

2. We intend to sell additional costumes as DLC. Two implementation options are under consideration:
   - **(A)** Each costume is delivered as a **separate, complete .moc3 model file**; the app loads one at a time as a whole-model replacement.
   - **(B)** Costumes are implemented as **part/texture switches within a single .moc3 model** (no new model files added at runtime; model count always = 1).
     **Q: Under EULA §1.5 "indefinite number of models by adding or combining files or data", which of (A) or (B) would you classify as an Expandable Application? Is (B) explicitly outside the Expandable definition?**

3. If we ship a **finite, fixed set** of costume models bundled at install time (no post-launch additions), does that change the classification versus an **indefinite, ongoing** costume DLC pipeline?

**Section 3 — Distribution & monetization classification**

4. Our monetization is: free base app + paid costume DLC. **Q: Which Content Plan applies — Plan F (One-time, PC), Plan G (Running Royalty), or a combination?** Note Plan F's terms appear to exclude in-app purchases.

5. We are currently a Small-Scale Enterprise (annual sales < JPY 10,000,000). **Q: Confirm that under this scale, both Plan F and Plan G fees are ¥0, and that we are still required to execute (sign) the Publication License Agreement even though no fee is payable.**

6. **Q: How should we classify Windows desktop distribution?** Plan G's platform list (iOS/Android/HarmonyOS/Web) does not explicitly name desktop. Is desktop handled under Plan F, or under a separate arrangement?

**Section 4 — Future features (will NOT develop until classified)**

7. A future "character store" where **we (the provider) sell additional original characters we create** (still no user-imported models). **Q: Does a provider-operated store selling first-party model additions constitute an Expandable Application under §1.5(a) or §1.5(c)?**

8. A future plugin/extension system allowing third-party code. **Q: Confirmation that this triggers Expandable classification and requires the special Publication License Agreement.**

**Section 5 — Compliance details**

9. **Q: What are the exact logo/credit display obligations** for our product (placement, wording, size)? We understand a copyright statement is required — please provide the canonical text and placement spec.

10. **Q: Are there any restrictions on combining the Cubism SDK with generative AI** for driving model motion/expressions, beyond the standard license terms?

11. **Q: Confirm that the Cubism Editor license (used by our artists to create models) is separate from the SDK publication license**, and that PRO for indie is sufficient for our artists given our Small-Scale status.

We aim to begin the Publication License Agreement process at least one month before release. Thank you for your guidance.

Best regards,
Coconut Latte (生椰拿铁)
18967498922@163.com

---

## 发送前核对清单

- [ ] 主题行完整复制（含 Windows Only 说明）
- [ ] 正文完整复制（11 个问题 + 产品描述 + 签名）
- [ ] 发送后记录日期与渠道（填在本文档头部）
- [ ] 若一周未回复：可发一封简短催问（"May I ask for an update on the inquiry sent on [date]?"）
