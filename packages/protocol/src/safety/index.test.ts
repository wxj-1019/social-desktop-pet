import { describe, expect, it } from 'vitest';

import {
  InputClassificationSchema,
  OutputModerationResultSchema,
  ContentCategorySchema,
} from './index.js';

describe('protocol/safety', () => {
  it('accepts a crisis classification with default crisisLevel none (11.8)', () => {
    const parsed = InputClassificationSchema.parse({
      categories: ['prompt_injection'],
      confidence: 0.8,
    });
    expect(parsed.crisisLevel).toBe('none'); // 默认
  });

  it('rejects an unknown content category (11.8 固定枚举)', () => {
    expect(
      InputClassificationSchema.safeParse({
        categories: ['nonsense'],
        confidence: 0.5,
      }).success,
    ).toBe(false);
  });

  it('accepts a blocked output moderation (11.8 第三道)', () => {
    const parsed = OutputModerationResultSchema.parse({
      passed: false,
      blockedCategories: ['self_harm'],
      crisisLevel: 'high',
    });
    expect(parsed.blockedCategories).toEqual(['self_harm']);
  });

  it('exposes every category in ContentCategorySchema (11.8 覆盖清单)', () => {
    const cats = ContentCategorySchema.options;
    for (const required of [
      'self_harm',
      'sexual_exploitation',
      'minor_risk',
      'prompt_injection',
      'dependency_manipulation',
      'sycophancy_delusion', // 第二轮新增
      'ai_permanent_promise', // 第二轮新增
    ]) {
      expect(cats).toContain(required);
    }
  });
});
