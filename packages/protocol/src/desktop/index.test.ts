import { describe, expect, it } from 'vitest';

import { ActionIntentSchema, EmotionSchema } from '../index.js';

import {
  ActionSourceSchema,
  BooleanSettingSchema,
  PanelOpenSchema,
  PetActionDecisionSchema,
  PetActionRequestSchema,
  PetChatEventSchema,
  PetChatSourceSchema,
  PetDragPointSchema,
  PetExpressionSchema,
  PetFacingSchema,
  PetInteractionSchema,
  PetMotionSchema,
  PetProfileSchema,
  PetRuntimeSnapshotSchema,
  PetSocialEventSchema,
  PetVisualCommandSchema,
  SessionLoginPayloadSchema,
  SessionRegisterPayloadSchema,
} from './index.js';

const VALID_UUID = '7f9d7e2c-4d2a-4b3a-9f2e-1a2b3c4d5e6f';

const validOutput = {
  dialogue: '欢迎回来',
  emotion: 'warm',
  actionIntent: 'wave',
  intensity: 1,
};

describe('protocol/desktop/profile', () => {
  it('parses the default profile (petId star-isle)', () => {
    const profile = PetProfileSchema.parse({
      version: 1,
      petId: 'star-isle',
      displayName: '星屿',
      reducedMotion: false,
      dnd: false,
      bubbleEnabled: true,
    });
    expect(profile.petId).toBe('star-isle');
    expect(profile.displayName).toBe('星屿');
  });

  it('parses a codenono profile', () => {
    const profile = PetProfileSchema.parse({
      version: 1,
      petId: 'codenono',
      displayName: 'CodeNoNo',
      reducedMotion: false,
      dnd: false,
      bubbleEnabled: true,
    });
    expect(profile.petId).toBe('codenono');
  });

  it('rejects an unknown petId', () => {
    expect(() =>
      PetProfileSchema.parse({
        version: 1,
        petId: 'unknown-pet',
        displayName: '?',
        reducedMotion: false,
        dnd: false,
        bubbleEnabled: true,
      }),
    ).toThrow();
  });

  it('rejects extra fields on the profile', () => {
    expect(() =>
      PetProfileSchema.parse({
        version: 1,
        petId: 'star-isle',
        displayName: '星屿',
        reducedMotion: false,
        dnd: false,
        bubbleEnabled: true,
        theme: 'dark',
      }),
    ).toThrow();
  });
});

describe('protocol/desktop/drag point', () => {
  it('accepts valid in-range coordinates', () => {
    const p = PetDragPointSchema.parse({ x: 0, y: 100_000 });
    expect(p.x).toBe(0);
    expect(p.y).toBe(100_000);
  });

  it('rejects NaN', () => {
    expect(() => PetDragPointSchema.parse({ x: NaN, y: 0 })).toThrow();
  });

  it('rejects Infinity', () => {
    expect(() => PetDragPointSchema.parse({ x: 0, y: Infinity })).toThrow();
  });

  it('rejects out-of-bounds coordinates', () => {
    expect(() => PetDragPointSchema.parse({ x: 100_001, y: 0 })).toThrow();
    expect(() => PetDragPointSchema.parse({ x: 0, y: -100_001 })).toThrow();
  });

  it('rejects extra fields', () => {
    expect(() => PetDragPointSchema.parse({ x: 1, y: 2, z: 3 })).toThrow();
  });
});

describe('protocol/desktop/runtime snapshot', () => {
  it('parses a runtime snapshot', () => {
    const snap = PetRuntimeSnapshotSchema.parse({
      state: 'CHATTING',
      online: true,
      dnd: false,
      hidden: false,
    });
    expect(snap.state).toBe('CHATTING');
    expect(snap.online).toBe(true);
  });

  it('rejects extra fields on the snapshot', () => {
    expect(() =>
      PetRuntimeSnapshotSchema.parse({
        state: 'IDLE',
        online: true,
        dnd: false,
        hidden: false,
        camera: 'on',
      }),
    ).toThrow();
  });
});

describe('protocol/desktop/visual command', () => {
  it('parses every discriminated branch', () => {
    expect(
      PetVisualCommandSchema.parse({ type: 'motion', motion: 'wave', intensity: 2 }).type,
    ).toBe('motion');
    expect(PetVisualCommandSchema.parse({ type: 'expression', expression: 'happy' }).type).toBe(
      'expression',
    );
    expect(PetVisualCommandSchema.parse({ type: 'speaking', active: true }).type).toBe('speaking');
    expect(PetVisualCommandSchema.parse({ type: 'facing', facing: 'left' })).toMatchObject({
      type: 'facing',
      facing: 'left',
    });
    expect(PetVisualCommandSchema.parse({ type: 'bubble', text: '你好' })).toMatchObject({
      type: 'bubble',
      text: '你好',
    });
    expect(PetVisualCommandSchema.parse({ type: 'bubble', text: null })).toMatchObject({
      type: 'bubble',
      text: null,
    });
  });

  it('rejects an unknown type', () => {
    expect(() => PetVisualCommandSchema.parse({ type: 'dance' })).toThrow();
  });

  it('rejects out-of-range motion intensity', () => {
    expect(() =>
      PetVisualCommandSchema.parse({ type: 'motion', motion: 'idle', intensity: 0 }),
    ).toThrow();
    expect(() =>
      PetVisualCommandSchema.parse({ type: 'motion', motion: 'idle', intensity: 4 }),
    ).toThrow();
  });

  it('rejects extra fields on each branch', () => {
    expect(() =>
      PetVisualCommandSchema.parse({ type: 'motion', motion: 'idle', intensity: 1, velocity: 9 }),
    ).toThrow();
    expect(() =>
      PetVisualCommandSchema.parse({ type: 'expression', expression: 'happy', duration: 5 }),
    ).toThrow();
  });
});

describe('protocol/desktop/interaction & actions', () => {
  it('parses a head touch interaction and rejects extras', () => {
    expect(PetInteractionSchema.parse({ kind: 'head_touch' }).kind).toBe('head_touch');
    expect(() => PetInteractionSchema.parse({ kind: 'head_touch', count: 2 })).toThrow();
  });

  it('parses an action request (reason optional) strictly', () => {
    const req = PetActionRequestSchema.parse({ intent: 'wave', source: 'local_interaction' });
    expect(req.intent).toBe('wave');
    const reqWithReason = PetActionRequestSchema.parse({
      intent: 'touch',
      source: 'cloud_ai',
      reason: '模型建议',
    });
    expect(reqWithReason.reason).toBe('模型建议');
  });

  it('rejects invalid action requests', () => {
    expect(() =>
      PetActionRequestSchema.parse({ intent: 'wave', source: 'local_interaction', extra: true }),
    ).toThrow();
    expect(() =>
      PetActionRequestSchema.parse({ intent: 'dance', source: 'local_interaction' }),
    ).toThrow();
    expect(() => PetActionRequestSchema.parse({ intent: 'wave', source: 'robot' })).toThrow();
  });

  it('parses an action decision (reason enum optional) strictly', () => {
    expect(PetActionDecisionSchema.parse({ approved: true, intent: 'sit' }).approved).toBe(true);
    expect(
      PetActionDecisionSchema.parse({ approved: false, intent: 'walk', reason: 'dnd' }).reason,
    ).toBe('dnd');
  });

  it('rejects invalid action decisions', () => {
    expect(() =>
      PetActionDecisionSchema.parse({ approved: true, intent: 'sit', reason: 'busy' }),
    ).toThrow();
    expect(() =>
      PetActionDecisionSchema.parse({ approved: true, intent: 'sit', note: 'x' }),
    ).toThrow();
  });
});

describe('protocol/desktop/chat events', () => {
  it('parses every phase', () => {
    const start = PetChatEventSchema.parse({ phase: 'start', source: 'local_chat', text: 'hi' });
    expect(start.phase).toBe('start');
    const update = PetChatEventSchema.parse({
      phase: 'update',
      source: 'cloud_ai',
      text: '正在思考…',
    });
    expect(update.phase).toBe('update');
    const done = PetChatEventSchema.parse({
      phase: 'done',
      source: 'cloud_ai',
      output: validOutput,
    });
    expect(done.phase).toBe('done');
    const error = PetChatEventSchema.parse({
      phase: 'error',
      source: 'local_chat',
      message: '超时',
    });
    expect(error.phase).toBe('error');
  });

  it('rejects a done event with illegal intensity (9)', () => {
    expect(() =>
      PetChatEventSchema.parse({
        phase: 'done',
        source: 'cloud_ai',
        output: { ...validOutput, intensity: 9 },
      }),
    ).toThrow();
  });

  it('rejects extra fields on chat events', () => {
    expect(() =>
      PetChatEventSchema.parse({ phase: 'start', source: 'local_chat', text: 'hi', id: 'abc' }),
    ).toThrow();
  });

  it('rejects start text longer than 2000 chars', () => {
    expect(() =>
      PetChatEventSchema.parse({ phase: 'start', source: 'local_chat', text: 'a'.repeat(2001) }),
    ).toThrow();
  });

  it('rejects error messages longer than 200 chars', () => {
    expect(() =>
      PetChatEventSchema.parse({ phase: 'error', source: 'local_chat', message: 'a'.repeat(201) }),
    ).toThrow();
  });
});

describe('protocol/desktop/social events', () => {
  it('parses a valid gift.snack_sent event (with optional nickname)', () => {
    const event = PetSocialEventSchema.parse({
      type: 'gift.snack_sent',
      giftId: 'gift-1',
      snackId: 'snack_cookie',
      fromUserId: 'user-1',
      fromNickname: 'Alice',
    });
    expect(event).toMatchObject({
      type: 'gift.snack_sent',
      giftId: 'gift-1',
      snackId: 'snack_cookie',
      fromUserId: 'user-1',
      fromNickname: 'Alice',
    });
  });

  it('parses a gift event without a nickname', () => {
    const event = PetSocialEventSchema.parse({
      type: 'gift.snack_sent',
      giftId: 'gift-2',
      snackId: 'snack_candy',
      fromUserId: 'user-2',
    });
    expect(event.fromNickname).toBeUndefined();
  });

  it('rejects an unknown event type', () => {
    expect(() =>
      PetSocialEventSchema.parse({
        type: 'gift.visit',
        giftId: 'gift-3',
        snackId: 'snack_tea',
        fromUserId: 'user-3',
      }),
    ).toThrow();
  });

  it('rejects extra fields on the gift event', () => {
    expect(() =>
      PetSocialEventSchema.parse({
        type: 'gift.snack_sent',
        giftId: 'gift-4',
        snackId: 'snack_cookie',
        fromUserId: 'user-4',
        toUserId: 'user-5',
      }),
    ).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => PetSocialEventSchema.parse({ type: 'gift.snack_sent' })).toThrow();
    expect(() =>
      PetSocialEventSchema.parse({
        type: 'gift.snack_sent',
        giftId: 'gift-5',
        snackId: 'snack_cookie',
      }),
    ).toThrow();
  });
});

describe('protocol/desktop/panel & settings', () => {
  it('parses every panel view and rejects unknown views', () => {
    for (const view of ['login', 'chat', 'friends'] as const) {
      expect(PanelOpenSchema.parse({ view }).view).toBe(view);
    }
    expect(() => PanelOpenSchema.parse({ view: 'settings' })).toThrow();
  });

  it('parses a boolean setting and rejects extras', () => {
    expect(BooleanSettingSchema.parse({ enabled: true }).enabled).toBe(true);
    expect(() => BooleanSettingSchema.parse({ enabled: true, extra: 1 })).toThrow();
  });
});

describe('protocol/desktop/session', () => {
  it('parses a valid login payload', () => {
    const payload = SessionLoginPayloadSchema.parse({
      email: 'pet@example.com',
      password: 'password123',
      deviceId: VALID_UUID,
    });
    expect(payload.email).toBe('pet@example.com');
  });

  it('rejects a non-uuid deviceId', () => {
    expect(() =>
      SessionLoginPayloadSchema.parse({
        email: 'pet@example.com',
        password: 'password123',
        deviceId: 'not-a-uuid',
      }),
    ).toThrow();
  });

  it('rejects short passwords', () => {
    expect(() =>
      SessionLoginPayloadSchema.parse({
        email: 'pet@example.com',
        password: 'short',
        deviceId: VALID_UUID,
      }),
    ).toThrow();
  });

  it('rejects invalid emails', () => {
    expect(() =>
      SessionLoginPayloadSchema.parse({
        email: 'not-an-email',
        password: 'password123',
        deviceId: VALID_UUID,
      }),
    ).toThrow();
  });

  it('rejects extra fields on the login payload', () => {
    expect(() =>
      SessionLoginPayloadSchema.parse({
        email: 'pet@example.com',
        password: 'password123',
        deviceId: VALID_UUID,
        remember: true,
      }),
    ).toThrow();
  });

  it('parses a valid register payload and rejects empty nicknames', () => {
    const reg = SessionRegisterPayloadSchema.parse({
      email: 'pet@example.com',
      password: 'password123',
      deviceId: VALID_UUID,
      nickname: '星屿',
    });
    expect(reg.nickname).toBe('星屿');
    expect(() =>
      SessionRegisterPayloadSchema.parse({
        email: 'pet@example.com',
        password: 'password123',
        deviceId: VALID_UUID,
        nickname: '   ',
      }),
    ).toThrow();
  });

  it('rejects extra fields on the register payload (extend keeps strict)', () => {
    expect(() =>
      SessionRegisterPayloadSchema.parse({
        email: 'pet@example.com',
        password: 'password123',
        deviceId: VALID_UUID,
        nickname: '星屿',
        inviteCode: 'abc',
      }),
    ).toThrow();
  });
});

describe('protocol/desktop/root reuse', () => {
  it('exposes the desktop enums', () => {
    expect(ActionSourceSchema.options).toContain('system');
    expect(PetMotionSchema.options).toContain('wave');
    expect(PetExpressionSchema.options).toContain('shy');
    expect(PetFacingSchema.options).toEqual(['left', 'right']);
    expect(PetChatSourceSchema.options).toContain('cloud_ai');
  });

  it('still exposes AI enums from the root entry (no regression)', () => {
    expect(EmotionSchema.options).toContain('warm');
    expect(ActionIntentSchema.options).toContain('wave');
  });
});
