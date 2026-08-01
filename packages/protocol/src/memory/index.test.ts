import { describe, expect, it } from 'vitest';

import { MemoryRecordSchema, MemoryCandidateSchema, MemoryDedupeActionSchema } from './index.js';

const baseMemory = {
  memoryId: '11111111-1111-1111-1111-111111111111',
  ownerUserId: '22222222-2222-2222-2222-222222222222',
  bondId: null,
  category: 'preference',
  value: '用户喜欢抹茶',
  sourceTurnIds: ['33333333-3333-3333-3333-333333333333'],
  confidence: 0.95,
  userConfirmed: true,
  sensitivity: 'low',
  visibility: 'private',
  purpose: 'private_chat',
  validFrom: null,
  validTo: null,
  expiresAt: null,
  sourceType: 'user_confirmed',
  namespace: 'pet:default',
  embedding: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('protocol/memory', () => {
  it('accepts a valid memory record with defaults (10.5)', () => {
    const parsed = MemoryRecordSchema.parse(baseMemory);
    expect(parsed.importance).toBe(5); // 默认
    expect(parsed.memoryStatus).toBe('active'); // 默认
    expect(parsed.supersededBy).toBeNull(); // 默认
  });

  it('rejects a memory with sourceType=inferred but userConfirmed=true (10.6: 推断不得当作用户事实)', () => {
    const bad = { ...baseMemory, sourceType: 'inferred', userConfirmed: true };
    expect(MemoryRecordSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a memory with importance out of range (第二轮: 1-10)', () => {
    const bad = { ...baseMemory, importance: 11 };
    expect(MemoryRecordSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts a valid extraction candidate and dedupe action (10.6 mem0)', () => {
    const candidate = {
      value: '用户最近在备考',
      category: 'event',
      importance: 7,
      sourceType: 'user_stated',
      sensitivity: 'low',
    };
    expect(MemoryCandidateSchema.parse(candidate)).toMatchObject(candidate);
    for (const action of ['ADD', 'UPDATE', 'DELETE', 'NOOP'] as const) {
      expect(MemoryDedupeActionSchema.parse(action)).toBe(action);
    }
  });
});
