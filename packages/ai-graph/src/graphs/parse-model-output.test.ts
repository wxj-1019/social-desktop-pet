import { describe, expect, it } from 'vitest';

import { chunkDialogue, parseModelOutput } from './parse-model-output.js';

describe('parseModelOutput（10.2 结构化输出容错解析）', () => {
  it('纯 JSON 完整解析', () => {
    const raw =
      '{"dialogue":"今天也要加油哦！","emotion":"warm","actionIntent":"cheer","intensity":4}';
    const out = parseModelOutput(raw);
    expect(out).toEqual({
      dialogue: '今天也要加油哦！',
      emotion: 'warm',
      actionIntent: 'cheer',
      intensity: 4,
    });
  });

  it('```json 代码块包裹的 JSON', () => {
    const raw =
      '```json\n{"dialogue":"抱抱你","emotion":"concerned","actionIntent":"comfort","intensity":3}\n```';
    const out = parseModelOutput(raw);
    expect(out.dialogue).toBe('抱抱你');
    expect(out.emotion).toBe('concerned');
    expect(out.actionIntent).toBe('comfort');
    expect(out.intensity).toBe(3);
  });

  it('前缀杂讯（"好的：{...}"）', () => {
    const raw =
      '好的：{"dialogue":"没问题！","emotion":"happy","actionIntent":"nod","intensity":2}';
    const out = parseModelOutput(raw);
    expect(out.dialogue).toBe('没问题！');
    expect(out.emotion).toBe('happy');
    expect(out.actionIntent).toBe('nod');
    expect(out.intensity).toBe(2);
  });

  it('整段非法 JSON → 回退：dialogue=原文、默认 emotion/actionIntent/intensity', () => {
    const raw = '今天天气真不错，我们出去走走吧！';
    const out = parseModelOutput(raw);
    expect(out.dialogue).toBe(raw);
    expect(out.emotion).toBe('neutral');
    expect(out.actionIntent).toBe('idle');
    expect(out.intensity).toBe(1);
  });

  it('emotion 非法 → 兜底 neutral，但 dialogue 保留', () => {
    const raw =
      '{"dialogue":"我会一直陪着你","emotion":"evil_grin","actionIntent":"wave","intensity":2}';
    const out = parseModelOutput(raw);
    expect(out.dialogue).toBe('我会一直陪着你');
    expect(out.emotion).toBe('neutral');
    expect(out.actionIntent).toBe('wave');
    expect(out.intensity).toBe(2);
  });

  it('actionIntent 非法 → 兜底 idle，其余字段保留', () => {
    const raw = '{"dialogue":"打个招呼","emotion":"shy","actionIntent":"backflip","intensity":5}';
    const out = parseModelOutput(raw);
    expect(out.dialogue).toBe('打个招呼');
    expect(out.emotion).toBe('shy');
    expect(out.actionIntent).toBe('idle');
    expect(out.intensity).toBe(5);
  });

  it('dialogue 超长 → 截断 600', () => {
    const long = '星'.repeat(700);
    const raw = `{"dialogue":"${long}","emotion":"happy","actionIntent":"wave","intensity":2}`;
    const out = parseModelOutput(raw);
    expect(out.dialogue.length).toBe(600);
    expect(out.dialogue.startsWith('星'.repeat(600))).toBe(true);
    expect(out.emotion).toBe('happy');
    expect(out.actionIntent).toBe('wave');
  });

  it('intensity 越界/非法 → 兜底 1，其余字段保留', () => {
    const raw = '{"dialogue":"好耶！","emotion":"happy","actionIntent":"cheer","intensity":9}';
    const out = parseModelOutput(raw);
    expect(out.dialogue).toBe('好耶！');
    expect(out.emotion).toBe('happy');
    expect(out.actionIntent).toBe('cheer');
    expect(out.intensity).toBe(1);
  });

  it('intensity 非整数（如 3.7）→ 兜底 1', () => {
    const out = parseModelOutput(
      '{"dialogue":"嘿嘿","emotion":"happy","actionIntent":"wave","intensity":3.7}',
    );
    expect(out.intensity).toBe(1);
  });

  it('dialogue 非 string（如数字）→ 回退原文', () => {
    const raw = '{"dialogue":12345,"emotion":"neutral","actionIntent":"idle","intensity":1}';
    const out = parseModelOutput(raw);
    expect(out.dialogue).toBe(raw);
    expect(out.emotion).toBe('neutral');
  });

  it('空字符串 → 回退默认', () => {
    const out = parseModelOutput('');
    expect(out.dialogue).toBe('');
    expect(out.emotion).toBe('neutral');
    expect(out.actionIntent).toBe('idle');
    expect(out.intensity).toBe(1);
  });
});

describe('chunkDialogue（流式模拟切分）', () => {
  it('空串 → 空数组', () => {
    expect(chunkDialogue('')).toEqual([]);
  });

  it('短文本（≤size）→ 单个 chunk', () => {
    expect(chunkDialogue('你好')).toEqual(['你好']);
    expect(chunkDialogue('hi')).toEqual(['hi']);
  });

  it('长文本按 size 切分，末尾不足 size 保留剩余', () => {
    expect(chunkDialogue('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('中文按字符切分（不按字节）', () => {
    expect(chunkDialogue('今天也要加油哦', 4)).toEqual(['今天也要', '加油哦']);
  });

  it('默认 size=4，可显式传 size', () => {
    expect(chunkDialogue('1234567')).toEqual(['1234', '567']);
    expect(chunkDialogue('1234567', 3)).toEqual(['123', '456', '7']);
  });
});
