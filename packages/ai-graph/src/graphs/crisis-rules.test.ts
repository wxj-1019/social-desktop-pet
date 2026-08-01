import { describe, expect, it } from 'vitest';

import { buildChatFlow, detectCrisis } from '@pet/ai-graph';
import { initialChatFlowState } from '@pet/ai-graph';

describe('detectCrisis（11.8 规则版预筛）', () => {
  it('high 命中：明确自伤表达', () => {
    const r = detectCrisis('我真的不想活了');
    expect(r.crisisLevel).toBe('high');
    expect(r.categories).toContain('self_harm');
  });

  it('medium 命中：严重情绪危机', () => {
    expect(detectCrisis('我撑不下去了').crisisLevel).toBe('medium');
  });

  it('normal 口语不误伤（规则保守）', () => {
    expect(detectCrisis('想死你了我的宝').crisisLevel).toBe('none');
    expect(detectCrisis('累死了，今天好忙').crisisLevel).toBe('none');
    expect(detectCrisis('你好呀').crisisLevel).toBe('none');
  });

  it('多类别命中聚合（无 high 词时取 medium）', () => {
    const r = detectCrisis('我撑不下去了，真想杀了你');
    expect(r.crisisLevel).toBe('medium');
    expect(r.categories).toContain('self_harm');
    expect(r.categories).toContain('violence');
  });
});

describe('chat-flow 危机分支（11.8 条件边激活）', () => {
  it('命中危机 → 走 crisis_response，不生成普通回复', async () => {
    const graph = buildChatFlow();
    const state = initialChatFlowState({
      threadId: 'crisis-1',
      userId: 'u1',
      deviceId: 'd1',
      userMessage: '我不想活了',
      scenario: 'private_chat',
    });
    const result = await graph.invoke(state, { threadId: 'crisis-1' });
    // crisis_response 节点：危机协议输出 + 不抽取记忆
    expect(result.crisisLevel).toBe('high');
    expect(result.memoryExtractTriggered).toBe(false);
  });

  it('普通消息不触发危机分支（正常生成路径不变）', async () => {
    const graph = buildChatFlow();
    const state = initialChatFlowState({
      threadId: 'normal-1',
      userId: 'u1',
      deviceId: 'd1',
      userMessage: '今天天气不错',
      scenario: 'private_chat',
    });
    const result = await graph.invoke(state, { threadId: 'normal-1' });
    expect(result.inputClassification?.crisisLevel).toBe('none');
    expect(result.crisisLevel).toBeUndefined(); // 未走危机分支
    expect(result.modelOutput?.dialogue).toContain('今天天气不错');
  });
});
