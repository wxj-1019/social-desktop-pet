import { describe, expect, it } from 'vitest';

import {
  CommandEnvelopeSchema,
  IdempotencyKeySchema,
  SendFreeSnackCommandSchema,
  InviteTokenSchema,
} from './index.js';

describe('protocol/commands', () => {
  it('accepts a valid idempotency key (9.6)', () => {
    const key = {
      userId: '11111111-1111-1111-1111-111111111111',
      deviceId: '22222222-2222-2222-2222-222222222222',
      clientEventId: 'evt-12345678',
    };
    expect(IdempotencyKeySchema.parse(key)).toMatchObject(key);
  });

  it('rejects a command envelope with a duplicate client_event_id too short (9.6)', () => {
    expect(
      CommandEnvelopeSchema.safeParse({
        userId: '11111111-1111-1111-1111-111111111111',
        deviceId: '22222222-2222-2222-2222-222222222222',
        clientEventId: 'x', // < 8
        type: 'gift.send_free_snack',
        payload: {},
      }).success,
    ).toBe(false);
  });

  it('accepts a valid free snack command (9.4)', () => {
    const cmd = {
      toUserId: '33333333-3333-3333-3333-333333333333',
      snackId: 'snack-cookie',
      note: '今天也加油',
    };
    expect(SendFreeSnackCommandSchema.parse(cmd)).toMatchObject(cmd);
  });

  it('rejects an invitation token shorter than 43 chars (6.3: ≥32 random bytes → URL-safe Base64 ≥43)', () => {
    expect(InviteTokenSchema.safeParse('too-short-token').success).toBe(false);
  });
});
