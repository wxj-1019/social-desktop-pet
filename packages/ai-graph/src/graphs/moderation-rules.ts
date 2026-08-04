/**
 * 输出审核规则版 —— 11.2 第四道（输出侧记忆泄漏校验）。
 *
 * 定位：注入的 Moderation provider（12.5 免费 Moderation，可判语义泄漏）就绪前，
 * 用确定性信号做第一道输出侧拦截：
 * - PII 泄漏：手机号 / 身份证 / 银行卡 / 邮箱（模型把用户隐私写进回复 = 泄漏）
 * - 敏感细节引用：健康/财务等具体数据被回复主动提及（非 allowlist 授权）
 *
 * 边界：allowlist（retrievedMemoryIds）核对交给注入 provider（需要语义判断）；
 * 规则版只拦截确定性信号，宁可漏放不可误伤正常回复。
 * 拦截类别映射到 ContentCategory 枚举（protocol 契约）：
 *   PII → pii_credential；健康/财务/身份细节 → friend_privacy_leak。
 */
import type { ContentCategory } from '@pet/protocol';

export interface RuleModerationResult {
  passed: boolean;
  blockedCategories: ContentCategory[];
  crisisLevel: 'none' | 'low' | 'medium' | 'high';
}

/** PII：大陆手机号 */
const PHONE_PATTERN = /1[3-9]\d{9}/u;
/** PII：18 位身份证 */
const ID_CARD_PATTERN = /\b\d{17}[\dXx]\b/u;
/** PII：银行卡（13-19 位数字） */
const BANK_CARD_PATTERN = /\b\d{13,19}\b/u;
/** PII：邮箱 */
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/u;

/** 敏感细节引用：回复主动输出健康/财务具体数据（非检索授权） */
const SENSITIVE_DETAIL_PATTERNS: RegExp[] = [
  /(?:我的)?(?:血糖|血压|心率|体检报告|诊断结果|病历)/u,
  /(?:我的)?(?:工资单|存款余额|房贷金额|欠款金额|银行卡号)/u,
  /(?:我的)?(?:身份证号|家庭住址|门牌号)/u,
];

/** 规则版输出审核：返回通过与否 + 拦截类别（crisisLevel 恒 none——输出侧危机由注入 provider 判） */
export function ruleModerateOutput(text: string): RuleModerationResult {
  const blockedCategories: ContentCategory[] = [];

  if (PHONE_PATTERN.test(text) || ID_CARD_PATTERN.test(text) || EMAIL_PATTERN.test(text)) {
    blockedCategories.push('pii_credential');
  }
  if (BANK_CARD_PATTERN.test(text)) {
    blockedCategories.push('pii_credential');
  }
  // 健康/财务/身份细节被回复主动引用 → 隐私泄漏信号（allowlist 语义核对留 provider）
  const hasSensitiveDetail = SENSITIVE_DETAIL_PATTERNS.some((test) => test.test(text));
  if (hasSensitiveDetail && !blockedCategories.includes('friend_privacy_leak')) {
    blockedCategories.push('friend_privacy_leak');
  }

  return {
    passed: blockedCategories.length === 0,
    blockedCategories,
    crisisLevel: 'none',
  };
}
