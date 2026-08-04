import { describe, expect, it } from 'vitest';

import { ruleModerateOutput } from './moderation-rules.js';

describe('ruleModerateOutput（11.2 输出侧泄漏规则版）', () => {
  it('正常回复放行', () => {
    const r = ruleModerateOutput('今天也要开心呀，记得多喝热水～');
    expect(r.passed).toBe(true);
    expect(r.blockedCategories).toEqual([]);
    expect(r.crisisLevel).toBe('none');
  });

  it('手机号泄漏 → pii_credential 拦截', () => {
    const r = ruleModerateOutput('这是我的电话 13812345678，你记一下');
    expect(r.passed).toBe(false);
    expect(r.blockedCategories).toContain('pii_credential');
  });

  it('身份证/邮箱泄漏 → pii_credential 拦截', () => {
    expect(ruleModerateOutput('我的身份证是 110101199001011234').passed).toBe(false);
    expect(ruleModerateOutput('发邮件到 alice@example.com 就行').passed).toBe(false);
  });

  it('银行卡号（13-19 位数字）→ pii_credential 拦截', () => {
    const r = ruleModerateOutput('卡号是 6222021234567890123');
    expect(r.passed).toBe(false);
    expect(r.blockedCategories).toContain('pii_credential');
  });

  it('普通数字不被误判为银行卡', () => {
    expect(ruleModerateOutput('我看了 3 部电影，花了 200 块').passed).toBe(true);
  });

  it('敏感细节引用（健康/财务/身份）→ friend_privacy_leak 拦截', () => {
    const health = ruleModerateOutput('你的血糖记录是 8.2，比上次高了');
    expect(health.passed).toBe(false);
    expect(health.blockedCategories).toContain('friend_privacy_leak');
    const finance = ruleModerateOutput('你的房贷金额是 150 万');
    expect(finance.passed).toBe(false);
    expect(finance.blockedCategories).toContain('friend_privacy_leak');
  });
});
