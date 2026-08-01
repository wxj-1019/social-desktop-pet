import { describe, expect, it } from 'vitest';

import { ModelOutputSchema, RoutingDecisionSchema } from './index.js';

describe('protocol/ai', () => {
  it('accepts a valid structured model output', () => {
    const out = ModelOutputSchema.parse({
      dialogue: '欢迎回来，今天还顺利吗？',
      emotion: 'warm',
      actionIntent: 'wave',
      intensity: 1,
    });
    expect(out.dialogue).toBe('欢迎回来，今天还顺利吗？');
  });

  it('rejects extra fields (strict contract, 10.2)', () => {
    expect(() =>
      ModelOutputSchema.parse({
        dialogue: 'x',
        emotion: 'warm',
        actionIntent: 'wave',
        intensity: 1,
        // 不允许：拒绝额外字段
        systemCommand: 'rm -rf',
      }),
    ).toThrow();
  });

  it('accepts a routing decision at every level L0..SAFETY (10.3)', () => {
    for (const level of ['L0', 'L1', 'L2', 'L3', 'SAFETY'] as const) {
      expect(RoutingDecisionSchema.parse({ level, reason: 'r' }).level).toBe(level);
    }
  });
});
