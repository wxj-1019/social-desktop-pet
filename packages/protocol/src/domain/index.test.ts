import { describe, expect, it } from 'vitest';

import { BondSchema, PetStateSchema, TaskSchema } from '../domain/index.js';

describe('protocol/domain', () => {
  it('accepts a valid bond at each stage (7.4)', () => {
    const bond = {
      bondId: '11111111-1111-1111-1111-111111111111',
      friendshipId: '22222222-2222-2222-2222-222222222222',
      petAId: '33333333-3333-3333-3333-333333333333',
      petBId: '44444444-4444-4444-4444-444444444444',
      stage: 'first_meet',
      progress: 0,
      status: 'active',
    };
    expect(BondSchema.parse(bond).stage).toBe('first_meet');
  });

  it('accepts all pet states (7.1)', () => {
    for (const s of ['IDLE', 'WALKING', 'VISITING', 'OFFLINE'] as const) {
      expect(PetStateSchema.parse(s)).toBe(s);
    }
  });

  it('rejects an invalid task type (6.7 MVP 仅一种)', () => {
    const bad = {
      taskId: '11111111-1111-1111-1111-111111111111',
      bondId: '22222222-2222-2222-2222-222222222222',
      type: 'mutual_watering_30d', // MVP 无此类型
      status: 'pending',
      windowStartedAt: '2026-08-01T00:00:00.000Z',
      expiresAt: '2026-08-08T00:00:00.000Z',
    };
    expect(TaskSchema.safeParse(bad).success).toBe(false);
  });
});
