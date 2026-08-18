import { describe, expect, it } from 'vitest';

import {
  actionIntentToMotion as stateActionIntentToMotion,
  emotionToExpression as stateEmotionToExpression,
  EXPRESSIONS as StateEXPRESSIONS,
  MOTIONS as StateMOTIONS,
  normalizeIntensity as stateNormalizeIntensity,
  shouldInterrupt as stateShouldInterrupt,
  stateToExpression as stateStateToExpression,
  stateToMotion as stateStateToMotion,
} from '@pet/pet-state';

import { isModelReady, parseModelManifest } from './model-loader.js';
import {
  actionIntentToMotion,
  emotionToExpression,
  EXPRESSIONS,
  MOTIONS,
  normalizeIntensity,
  shouldInterrupt,
  stateToExpression,
  stateToMotion,
} from './motion-mapping.js';

describe('motion-mapping（re-export 兼容层）', () => {
  it('re-exports MOTIONS / EXPRESSIONS identical to @pet/pet-state', () => {
    expect(MOTIONS).toEqual(StateMOTIONS);
    expect(EXPRESSIONS).toEqual(StateEXPRESSIONS);
  });

  it('re-exports mapping functions identical to @pet/pet-state (同一引用)', () => {
    expect(stateToMotion).toBe(stateStateToMotion);
    expect(stateToExpression).toBe(stateStateToExpression);
    expect(shouldInterrupt).toBe(stateShouldInterrupt);
    expect(actionIntentToMotion).toBe(stateActionIntentToMotion);
    expect(emotionToExpression).toBe(stateEmotionToExpression);
    expect(normalizeIntensity).toBe(stateNormalizeIntensity);
  });

  it('re-exported functions still behave as expected (smoke)', () => {
    expect(stateToMotion('CHATTING')).toBe('talk');
    expect(stateToExpression('OFFLINE')).toBe('neutral');
    expect(shouldInterrupt('idle', 'sleep')).toBe(true);
    expect(actionIntentToMotion('cheer')).toBe('happy');
    expect(emotionToExpression('apologetic')).toBe('sad');
    expect(normalizeIntensity(5)).toBe(3);
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
