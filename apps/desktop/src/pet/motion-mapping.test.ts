import { describe, expect, it } from 'vitest';

import { isModelReady, parseModelManifest } from './model-loader.js';
import {
  MOTION_PRIORITY,
  shouldInterrupt,
  stateToExpression,
  stateToMotion,
} from './motion-mapping.js';

describe('stateToMotion（7.1 → 7.2 动作映射）', () => {
  it('maps every pet state to a manifest motion', () => {
    const cases: Array<[Parameters<typeof stateToMotion>[0], string]> = [
      ['STARTING', 'idle'],
      ['IDLE', 'idle'],
      ['WALKING', 'walk'],
      ['SITTING', 'sit'],
      ['SLEEPING', 'sleep'],
      ['CHATTING', 'talk'],
      ['HOSTING', 'wave'],
      ['VISITING', 'wave'],
      ['QUIET', 'idle'],
      ['HIDDEN', 'idle'],
      ['OFFLINE', 'idle'],
    ];
    for (const [state, motion] of cases) {
      expect(stateToMotion(state)).toBe(motion);
    }
  });

  it('chatting maps to talk (口型动作)', () => {
    expect(stateToMotion('CHATTING')).toBe('talk');
  });
});

describe('stateToExpression', () => {
  it('warm by default, neutral when sleeping/offline', () => {
    expect(stateToExpression('IDLE')).toBe('warm');
    expect(stateToExpression('SLEEPING')).toBe('neutral');
    expect(stateToExpression('OFFLINE')).toBe('neutral');
  });
});

describe('shouldInterrupt（7.2 防抖动）', () => {
  it('sleep is not interrupted by idle/walk (优先级)', () => {
    expect(shouldInterrupt('sleep', 'idle')).toBe(false);
    expect(shouldInterrupt('sleep', 'walk')).toBe(false);
    expect(shouldInterrupt('idle', 'sleep')).toBe(true);
    expect(shouldInterrupt('wave', 'touch')).toBe(true); // 4 > 3
  });

  it('priorities are total for all motions', () => {
    for (const m of Object.keys(MOTION_PRIORITY)) {
      expect(typeof MOTION_PRIORITY[m as keyof typeof MOTION_PRIORITY]).toBe('number');
    }
  });
});

describe('ModelManifest（8.8 清单校验）', () => {
  const valid = {
    version: 1,
    character: 'placeholder',
    models: [
      { id: 'character-default', path: 'character-default/model3.json', status: 'pending-license' },
    ],
    motions: ['idle', 'walk', 'sit', 'sleep', 'happy', 'sad', 'surprised', 'wave', 'touch', 'talk'],
    expressions: ['neutral', 'warm', 'happy', 'sad', 'surprised', 'shy'],
  };

  it('parses a valid manifest', () => {
    const m = parseModelManifest(valid);
    expect(m.motions).toContain('idle');
    expect(isModelReady(m)).toBe(false); // pending-license
  });

  it('rejects invalid motion names (清单与映射表不一致会被拦截)', () => {
    expect(() => parseModelManifest({ ...valid, motions: ['idle', 'fly'] })).toThrow();
  });
});
