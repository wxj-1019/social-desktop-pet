import type { ActionIntent, Emotion, PetExpression, PetMotion, PetState } from '@pet/protocol';
import { describe, expect, it } from 'vitest';

import {
  actionIntentToMotion,
  emotionToExpression,
  EXPRESSIONS,
  MOTIONS,
  normalizeIntensity,
  shouldInterrupt,
  stateToExpression,
  stateToMotion,
} from './visual-mapping.js';

describe('visual-mapping (7.1 → 7.2 跨进程视觉映射)', () => {
  it('MOTIONS covers the 10 manifest motions', () => {
    expect([...MOTIONS].sort()).toEqual(
      ['happy', 'idle', 'sad', 'sit', 'sleep', 'surprised', 'talk', 'touch', 'walk', 'wave'].sort(),
    );
  });

  it('EXPRESSIONS covers the 6 manifest expressions', () => {
    expect([...EXPRESSIONS].sort()).toEqual(
      ['happy', 'neutral', 'sad', 'shy', 'surprised', 'warm'].sort(),
    );
  });

  it('maps every action intent to a motion (穷尽 actionIntent)', () => {
    const cases: Array<[ActionIntent, PetMotion]> = [
      ['idle', 'idle'],
      ['wave', 'wave'],
      ['nod', 'talk'],
      ['shake_head', 'surprised'],
      ['touch', 'touch'],
      ['sit', 'sit'],
      ['sleep', 'sleep'],
      ['walk', 'walk'],
      ['cheer', 'happy'],
      ['comfort', 'touch'],
    ];
    for (const [intent, motion] of cases) {
      expect(actionIntentToMotion(intent)).toBe(motion);
    }
  });

  it('maps every emotion to an expression (穷尽 emotion)', () => {
    const cases: Array<[Emotion, PetExpression]> = [
      ['neutral', 'neutral'],
      ['warm', 'warm'],
      ['happy', 'happy'],
      ['sad', 'sad'],
      ['surprised', 'surprised'],
      ['shy', 'shy'],
      ['apologetic', 'sad'],
      ['concerned', 'warm'],
    ];
    for (const [emotion, expression] of cases) {
      expect(emotionToExpression(emotion)).toBe(expression);
    }
  });

  it('normalizeIntensity clamps/rounds at the documented boundaries', () => {
    // <=2 → 1
    expect(normalizeIntensity(-1)).toBe(1);
    expect(normalizeIntensity(0)).toBe(1);
    expect(normalizeIntensity(1)).toBe(1);
    expect(normalizeIntensity(2)).toBe(1);
    // <=4 → 2
    expect(normalizeIntensity(2.5)).toBe(2);
    expect(normalizeIntensity(3)).toBe(2);
    expect(normalizeIntensity(4)).toBe(2);
    // else → 3
    expect(normalizeIntensity(4.5)).toBe(3);
    expect(normalizeIntensity(5)).toBe(3);
    expect(normalizeIntensity(10)).toBe(3);
  });

  it('maps every pet state to a motion (穷尽 state)', () => {
    const cases: Array<[PetState, PetMotion]> = [
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

  it('stateToExpression: warm by default, neutral when sleeping/hidden/offline', () => {
    expect(stateToExpression('IDLE')).toBe('warm');
    expect(stateToExpression('STARTING')).toBe('warm');
    expect(stateToExpression('SLEEPING')).toBe('neutral');
    expect(stateToExpression('HIDDEN')).toBe('neutral');
    expect(stateToExpression('OFFLINE')).toBe('neutral');
  });

  it('shouldInterrupt respects motion priority (防抖动)', () => {
    expect(shouldInterrupt('sleep', 'idle')).toBe(false);
    expect(shouldInterrupt('sleep', 'walk')).toBe(false);
    expect(shouldInterrupt('idle', 'sleep')).toBe(true);
    expect(shouldInterrupt('wave', 'touch')).toBe(true); // 4 > 3
    expect(shouldInterrupt('wave', 'wave')).toBe(false); // 同级不打断
    expect(shouldInterrupt('happy', 'sad')).toBe(false); // 同级不打断
  });
});
