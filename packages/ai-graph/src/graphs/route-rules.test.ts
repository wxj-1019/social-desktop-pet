import { describe, expect, it } from 'vitest';

import { ruleRoute } from './route-rules.js';

describe('ruleRoute（10.3 路由分级规则版）', () => {
  it('动作指令（整句）→ L0', () => {
    expect(ruleRoute('坐下')).toEqual({ level: 'L0', reason: 'action_command:sit' });
    expect(ruleRoute('打个招呼')).toEqual({ level: 'L0', reason: 'action_command:wave' });
  });

  it('指令词出现在句中不误判 L0（整句锚定）', () => {
    const r = ruleRoute('睡觉是什么原理');
    expect(r.level).toBe('L1');
  });

  it('短问候/闲聊 → L1', () => {
    expect(ruleRoute('你好呀')).toEqual({ level: 'L1', reason: 'short_chat' });
    expect(ruleRoute('在吗')).toEqual({ level: 'L1', reason: 'short_chat' });
    expect(ruleRoute('今天天气不错')).toEqual({ level: 'L1', reason: 'short_chat' });
  });

  it('记忆需求信号 → L2（记忆融合档）', () => {
    const r = ruleRoute('你还记得我上次说的那家咖啡店吗');
    expect(r.level).toBe('L2');
    expect(r.reason).toBe('memory_signal');
  });

  it('情绪信号 → L2', () => {
    const r = ruleRoute('我今天有点难过');
    expect(r.level).toBe('L2');
    expect(r.reason).toBe('emotion_signal');
  });

  it('中长文本（>20 字）→ L2 兜底', () => {
    const r = ruleRoute('周末和朋友去了趟郊区的公园，天气很好，拍了很多照片。');
    expect(r.level).toBe('L2');
    expect(r.reason).toBe('medium_text');
  });

  it('超长文本 → L3（高能力档）', () => {
    const long =
      '最近工作压力特别大，项目要上线了，连续加班了好几天，每天都到很晚才回家，' +
      '感觉有点撑不住，又不敢跟同事说，怕拖了后腿，也怕领导觉得我能力不行，' +
      '每天回家都特别累，连饭都不想吃，周末也完全没有力气出门，就窝在家里，' +
      '你觉得我该怎么办才好，是不是应该跟领导好好谈谈，还是先撑着把项目做完再说？';
    const r = ruleRoute(long);
    expect(r.level).toBe('L3');
    expect(r.reason).toBe('long_text');
  });

  it('连续多问（≥3 问句）→ L3', () => {
    const r = ruleRoute('你吃饭了吗？今天去哪了？心情怎么样？');
    expect(r.level).toBe('L3');
    expect(r.reason).toBe('multi_question');
  });

  it('空白输入 → L1 兜底（不抛异常）', () => {
    expect(ruleRoute('  ').level).toBe('L1');
  });
});
