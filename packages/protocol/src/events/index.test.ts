import { describe, expect, it } from 'vitest';

import { InboxItemSchema, SemanticEventSchema } from './index.js';

const baseEvent = {
  v: 1,
  eventId: '11111111-1111-1111-1111-111111111111',
  type: 'pet.action.applied',
  roomSeq: 283,
  serverTimestamp: '2026-08-01T12:00:00.125Z',
  expiresAt: '2026-08-01T12:00:10.125Z',
  reliability: 'A',
  payload: { action: 'wave', animationSeed: 81723, durationMs: 1800 },
};

describe('protocol/events', () => {
  it('accepts a valid authoritative event (9.3)', () => {
    expect(SemanticEventSchema.parse(baseEvent)).toMatchObject({ roomSeq: 283 });
  });

  it('rejects events with missing required fields (9.3)', () => {
    const bad = { ...baseEvent, v: 2 }; // v 必须为 1
    expect(SemanticEventSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts an inbox item with its own seq (9.6)', () => {
    const parsed = InboxItemSchema.parse({ inboxSeq: 9182, event: baseEvent });
    expect(parsed.inboxSeq).toBe(9182);
  });
});
