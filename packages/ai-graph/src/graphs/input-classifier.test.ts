/**
 * V-13 分类器测试 —— LLM 结构化分类（多轮上下文）+ 容错解析 + 规则兜底。
 */
import { describe, expect, it } from 'vitest';

import type { LlmClient } from '../llm/types.js';

import {
  classifyWithLlm,
  parseClassificationJson,
  ruleClassification,
  type ClassifierTurn,
} from './input-classifier.js';

function mockLlmReturning(text: string): LlmClient {
  return {
    streamChat: async (_messages, onToken) => {
      onToken(text);
      return text;
    },
  };
}

describe('parseClassificationJson（V-13 契约容错解析）', () => {
  it('合法输出 → 结构化结果', () => {
    const r = parseClassificationJson(
      '{"crisisLevel":"high","categories":["self_harm"],"routeLevel":"SAFETY","confidence":0.95}',
    );
    expect(r).toEqual({
      crisisLevel: 'high',
      categories: ['self_harm'],
      routeLevel: 'SAFETY',
      confidence: 0.95,
    });
  });

  it('杂讯前缀/代码块容错', () => {
    const r = parseClassificationJson(
      '好的，分类结果：```json\n{"crisisLevel":"medium","categories":["none"],"routeLevel":"L2","confidence":0.7}\n```',
    );
    expect(r?.crisisLevel).toBe('medium');
    expect(r?.routeLevel).toBe('L2');
  });

  it('非法枚举/缺失字段 → null（调用方降级规则版）', () => {
    expect(parseClassificationJson('{"crisisLevel":"urgent","routeLevel":"L1"}')).toBeNull();
    expect(parseClassificationJson('{"crisisLevel":"low"}')).toBeNull(); // 缺 routeLevel
    expect(parseClassificationJson('不是 JSON')).toBeNull();
    expect(
      parseClassificationJson(
        '{"crisisLevel":"high","categories":["unknown_cat"],"routeLevel":"L1","confidence":1}',
      ),
    ).toEqual({
      crisisLevel: 'high',
      categories: [],
      routeLevel: 'L1',
      confidence: 1,
    });
  });

  it('confidence 越界收敛到 [0,1]', () => {
    expect(
      parseClassificationJson(
        '{"crisisLevel":"none","categories":["none"],"routeLevel":"L1","confidence":99}',
      )?.confidence,
    ).toBe(1);
    expect(
      parseClassificationJson(
        '{"crisisLevel":"none","categories":["none"],"routeLevel":"L1","confidence":-3}',
      )?.confidence,
    ).toBe(0);
  });
});

describe('classifyWithLlm（多轮上下文）', () => {
  it('prompt 包含最近多轮（user+assistant）', async () => {
    const turns: ClassifierTurn[] = [
      { role: 'user', content: '最近好累' },
      { role: 'assistant', content: '辛苦了，注意休息' },
      { role: 'user', content: '感觉撑不下去了' },
    ];
    let seenUserPrompt = '';
    const llm: LlmClient = {
      streamChat: async (messages, onToken) => {
        seenUserPrompt = messages[1]?.content ?? '';
        onToken(
          '{"crisisLevel":"medium","categories":["self_harm"],"routeLevel":"SAFETY","confidence":0.8}',
        );
        return 'ok';
      },
    };
    const r = await classifyWithLlm(llm, turns);
    expect(r?.crisisLevel).toBe('medium');
    expect(seenUserPrompt).toContain('最近好累');
    expect(seenUserPrompt).toContain('撑不下去了');
    expect(seenUserPrompt).toContain('星屿：辛苦了');
  });

  it('LLM 抛错 → null（回退规则版）', async () => {
    const llm: LlmClient = {
      streamChat: async () => {
        throw new Error('model down');
      },
    };
    expect(await classifyWithLlm(llm, [{ role: 'user', content: '在吗' }])).toBeNull();
  });

  it('LLM 输出非法 → null（回退规则版）', async () => {
    const llm = mockLlmReturning('抱歉我无法分类');
    expect(await classifyWithLlm(llm, [{ role: 'user', content: '在吗' }])).toBeNull();
  });
});

describe('ruleClassification（无 LLM 兜底，行为与既有规则版一致）', () => {
  it('危机命中 → high + self_harm（路由仍走规则版，危机由 crisisLevel 分支处理）', () => {
    const r = ruleClassification([{ role: 'user', content: '我不想活了' }]);
    expect(r.crisisLevel).toBe('high');
    expect(r.categories).toContain('self_harm');
  });

  it('正常短聊 → none + L1', () => {
    const r = ruleClassification([{ role: 'user', content: '你好呀' }]);
    expect(r.crisisLevel).toBe('none');
    expect(r.routeLevel).toBe('L1');
  });

  it('只看最后一轮（规则版无多轮语义）', () => {
    const r = ruleClassification([
      { role: 'user', content: '今天天气不错' },
      { role: 'assistant', content: '是呀' },
      { role: 'user', content: '你还记得上次那家咖啡店吗' },
    ]);
    expect(r.routeLevel).toBe('L2'); // 记忆信号来自最后一轮
  });
});
