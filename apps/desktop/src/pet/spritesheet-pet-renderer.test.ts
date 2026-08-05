import { describe, expect, it } from 'vitest';

import { DEFAULT_VISUAL_STATE } from './pet-renderer.js';
import { createSpritesheetPetRenderer } from './spritesheet-pet-renderer.js';

describe('createSpritesheetPetRenderer（PetRenderer 适配层）', () => {
  it('creates a renderer without notifying on construction', () => {
    const updates: unknown[] = [];
    createSpritesheetPetRenderer((s) => updates.push(s));
    expect(updates).toEqual([]);
  });

  it('playMotion merges motion/intensity, notifies once and resolves', async () => {
    const updates: unknown[] = [];
    const renderer = createSpritesheetPetRenderer((s) => updates.push(s));
    const result = renderer.playMotion('happy', 3);
    expect(result).toBeInstanceOf(Promise);
    await result;
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({ ...DEFAULT_VISUAL_STATE, motion: 'happy', intensity: 3 });
  });

  it('setExpression merges expression and notifies', () => {
    const updates: unknown[] = [];
    const renderer = createSpritesheetPetRenderer((s) => updates.push(s));
    renderer.setExpression('surprised');
    expect(updates).toEqual([{ ...DEFAULT_VISUAL_STATE, expression: 'surprised' }]);
  });

  it('state accumulates across calls (patch semantics)', () => {
    const updates: unknown[] = [];
    const renderer = createSpritesheetPetRenderer((s) => updates.push(s));
    renderer.playMotion('walk', 2);
    renderer.setExpression('happy');
    renderer.setSpeaking(true);
    renderer.setFacing('left');
    expect(updates.at(-1)).toEqual({
      motion: 'walk',
      intensity: 2,
      expression: 'happy',
      speaking: true,
      reducedMotion: false,
      facing: 'left',
    });
  });

  it('dispose suppresses all later updates and is idempotent', async () => {
    const updates: unknown[] = [];
    const renderer = createSpritesheetPetRenderer((s) => updates.push(s));
    renderer.dispose();
    renderer.dispose();
    await renderer.playMotion('happy', 3);
    renderer.setExpression('shy');
    renderer.setSpeaking(true);
    renderer.setReducedMotion(true);
    renderer.setFacing('left');
    expect(updates).toEqual([]);
  });
});
