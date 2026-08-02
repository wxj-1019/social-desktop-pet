# Star Isle Visible Desktop Pet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the original SVG fantasy pet Star Isle as an always-visible, draggable, touchable, offline-capable Windows desktop pet with a separate on-demand login/chat/friends panel.

**Architecture:** Electron Main owns one `PetStateMachine` through `PetRuntimeController`, plus a fixed transparent `petWindow` and lazy `panelWindow`. Both windows load the same renderer bundle with different `surface` query values; React SVG implements `PetRenderer`, while all window movement, tray recovery and persistence remain in validated Main-process controllers.

**Tech Stack:** TypeScript strict, Electron 33 (Windows-first in this milestone), React 18, inline SVG, CSS/Web Animations, zod, Vitest, Playwright Electron, pngjs, pnpm workspaces.

**Approved spec:** `docs/superpowers/specs/2026-08-01-star-isle-visible-pet-design.md`

---

## File Structure

### Shared contracts and state

- Create `packages/protocol/src/desktop/index.ts`: pet profile, IPC payload, runtime snapshot and visual command schemas.
- Create `packages/protocol/src/desktop/index.test.ts`: strict parsing, finite coordinate and unknown-field tests.
- Modify `packages/protocol/src/index.ts`: export desktop contracts from the package root.
- Modify `packages/pet-state/src/index.ts`: add action source, allow local actions while offline and export visual mappings.
- Modify `packages/pet-state/src/index.test.ts`: offline source and existing quiet/hidden regression tests.
- Create `packages/pet-state/src/visual-mapping.ts`: process-neutral state/intent/emotion visual mappings.
- Create `packages/pet-state/src/visual-mapping.test.ts`: exhaustive mapping tests.

### Electron Main and Preload

- Create `apps/desktop/electron/main/atomic-json-store.ts`: schema-validated atomic JSON persistence.
- Create `apps/desktop/electron/main/pet-profile-store.ts`: non-sensitive local profile store.
- Create `apps/desktop/electron/main/position-store.ts`: validated `PetPosition` persistence.
- Create `apps/desktop/electron/main/pet-runtime-controller.ts`: single state machine, timers, action approval and broadcasts.
- Create `apps/desktop/electron/main/pet-drag-controller.ts`: safe drag session and display clamping.
- Modify `apps/desktop/electron/main/display-controller.ts`: pet drag clamp and panel anchoring.
- Modify `apps/desktop/electron/main/window-controller.ts`: pet and panel windows with one renderer loader.
- Modify `apps/desktop/electron/main/ipc/register.ts`: schema-validated, sender-bound channels.
- Modify `apps/desktop/electron/main/security.ts`: complete IPC allowlist.
- Modify `apps/desktop/electron/main/tray-controller.ts`: real icon, panel entries, DND/pass-through recovery.
- Modify `apps/desktop/electron/main/index.ts`: wire stores, runtime, windows, IPC, tray and recovery.
- Modify `apps/desktop/electron/preload/index.ts`: typed pet runtime, drag, panel and profile API.
- Create `tools/generate-tray-icon.mjs`: deterministic original Star Isle tray PNG generator.
- Create `apps/desktop/resources/tray.png`: generated non-empty tray asset.

### Renderer

- Create `apps/desktop/src/pet/pet-renderer.ts`: renderer-neutral interface and visual state types.
- Create `apps/desktop/src/pet/star-isle-visual.tsx`: original layered SVG character.
- Create `apps/desktop/src/pet/svg-pet-renderer.ts`: `PetRenderer` implementation backed by React state.
- Create `apps/desktop/src/pet/pet-fallback.tsx`: static Star Isle error fallback.
- Create `apps/desktop/src/pet/pet-bubble.tsx`: fixed-size short dialogue bubble.
- Create `apps/desktop/src/pet/pointer-interaction.ts`: click/drag/double-click classifier.
- Create `apps/desktop/src/pet/pet-experience.tsx`: pet surface composition and IPC subscriptions.
- Create `apps/desktop/src/pet/use-pet-runtime.ts`: Main-owned runtime snapshot hook.
- Modify `apps/desktop/src/pet/motion-mapping.ts`: exhaustive intent/emotion adapters and intensity normalization.
- Modify `apps/desktop/src/main.tsx`: route `surface=pet|panel` while preserving `?poc`.
- Modify `apps/desktop/src/app/app.tsx`: export `AppPanel`; remove renderer-owned state machine.
- Modify `apps/desktop/src/app/chat-panel.tsx`: runtime chat events and cloud-to-local fallback.
- Modify `apps/desktop/src/app/local-chat.tsx`: runtime chat events.
- Modify `apps/desktop/src/lib/api/client.ts`: preserve complete `ModelOutput` from SSE done frames.
- Modify `apps/desktop/src/styles.css`: isolated pet and panel surfaces, SVG animations and reduced motion.

### Tests, build and documentation

- Add focused tests next to each created module.
- Modify `vitest.config.ts`: discover desktop `.test.tsx` component tests.
- Create `e2e/helpers/electron-app.ts`: isolated user data, pet/panel window lookup and cleanup.
- Create `e2e/helpers/pixel-assertions.ts`: PNG alpha/body-region checks.
- Create `e2e/star-isle.spec.ts`: visibility, interaction, drag, dual window and tray recovery.
- Modify existing `e2e/*.spec.ts`: use the panel helper instead of `firstWindow()` assumptions.
- Modify root `package.json`: add pngjs types and focused Star Isle E2E script.
- Modify `apps/desktop/electron-builder.yml`: include tray asset.
- Modify `.github/workflows/ci.yml`: add Windows Star Isle E2E job.
- Modify `README.md`, `AGENTS.md`, `docs/status-2026-08-02.md`, `docs/poc-window-capabilities.md`: record actual implemented behavior and manual evidence only after verification.

---

### Task 1: Stabilize Session Restore and Restore the Desktop Type Gate

**Files:**

- Modify: `apps/desktop/electron/preload/index.ts`
- Modify: `apps/desktop/electron/main/session-controller.ts`
- Modify: `apps/desktop/electron/main/session-controller.test.ts`
- Modify: `apps/desktop/electron/main/session-service.ts`
- Create: `apps/desktop/electron/main/session-service.test.ts`
- Modify: `apps/desktop/src/app/app.tsx`
- Modify: `apps/desktop/src/app/login.tsx`
- Modify: `apps/desktop/src/app/chat-panel.tsx`
- Verify: `apps/desktop/src/app/friends.tsx`

- [ ] **Step 1: Write failing refresh-rotation and single-restore tests**

Extend the fake auth API with `loadProfile(accessToken)` and make refresh rotate to `refresh-2`:

```ts
function makeAuth(): SessionAuthApi {
  return {
    refreshAccessToken: vi.fn(async () => ({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      accessExpiresAt: Date.now() + 15 * 60_000,
    })),
    loadProfile: vi.fn(async () => ({ userId: 'u1', deviceId: 'dev-1', nickname: 'Alice' })),
    revoke: vi.fn(async () => undefined),
  };
}

it('persists the rotated refresh token and restores profile', async () => {
  const storage = new MemoryStorage();
  storage.saveRefreshToken('refresh-1');
  const controller = new SessionController(storage, makeAuth());
  await controller.restore();
  expect(storage.loadRefreshToken()).toBe('refresh-2');
  expect(controller.snapshot.profile).toEqual({
    userId: 'u1',
    deviceId: 'dev-1',
    nickname: 'Alice',
  });
});

it('coalesces concurrent refresh calls into one rotation', async () => {
  const auth = makeAuth();
  const controller = new SessionController(new MemoryStorage(), auth);
  await Promise.all([controller.refresh('refresh-1'), controller.refresh('refresh-1')]);
  expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
});
```

Add a `createSessionHandlers` test with a fake controller snapshot and assert `handlers.init()` does not call `restore()`; Main performs restore once during bootstrap.

- [ ] **Step 2: Run the session tests and verify current behavior fails**

```bash
pnpm exec vitest run apps/desktop/electron/main/session-controller.test.ts apps/desktop/electron/main/session-service.test.ts
```

Expected: FAIL because rotation is not persisted, profile is not loaded, and the service test file/behavior is absent.

- [ ] **Step 3: Persist rotation, restore profile and make init snapshot-only**

Extend the API:

```ts
export interface SessionAuthApi {
  refreshAccessToken(refreshToken: string): Promise<SessionTokens>;
  loadProfile(accessToken: string): Promise<SessionProfile>;
  revoke(refreshToken: string): Promise<void>;
}
```

Make `refresh()` single-flight and move one rotation into `performRefresh()`:

```ts
private refreshInFlight: Promise<SessionState> | null = null;

refresh(refreshToken: string): Promise<SessionState> {
  if (this.refreshInFlight) return this.refreshInFlight;
  this.refreshInFlight = this.performRefresh(refreshToken).finally(() => {
    this.refreshInFlight = null;
  });
  return this.refreshInFlight;
}

private async performRefresh(refreshToken: string): Promise<SessionState> {
  this.state = { ...this.state, phase: 'REFRESHING' };
  try {
    const tokens = await this.auth.refreshAccessToken(refreshToken);
    const profile = await this.auth.loadProfile(tokens.accessToken);
    this.storage.saveRefreshToken(tokens.refreshToken);
    this.state = { phase: 'ACTIVE', profile, tokens };
  } catch (error) {
    this.storage.deleteRefreshToken();
    this.state = { phase: 'EXPIRED', profile: null, tokens: null, error: (error as Error).message };
  }
  return this.state;
}
```

Deleting the unusable stored token prevents endless restore attempts after an invalid rotation.

In `createAuthApi`, implement `loadProfile` with authenticated `GET ${baseUrl}/me`, mapping `body.device.deviceId` and nickname to `SessionProfile`. Change `createSessionHandlers.init()` to return the current snapshot without calling `session.restore()` again:

```ts
init: async (): Promise<SessionIpcResult> => ({
  phase: session.snapshot.phase,
  accessToken: session.snapshot.tokens?.accessToken ?? null,
  profile: session.snapshot.profile,
}),
```

- [ ] **Step 4: Add concrete Session IPC result types in preload**

Import the Main type as type-only and make every listener cleanup return `void`:

```ts
import type { SessionIpcResult } from '../main/session-service.js';

type SessionIpcError = { error: string };
type SessionResult = SessionIpcResult | SessionIpcError;

onDeepLink: (cb: (payload: string) => void) => {
  const listener = (_e: Electron.IpcRendererEvent, payload: string) => cb(payload);
  ipcRenderer.on('deeplink:payload', listener);
  return () => {
    ipcRenderer.removeListener('deeplink:payload', listener);
  };
},
session: {
  init: () => ipcRenderer.invoke('session:init') as Promise<SessionResult>,
  login: (payload: { email: string; password: string; deviceId: string }) =>
    ipcRenderer.invoke('session:login', payload) as Promise<SessionResult>,
  register: (payload: { email: string; password: string; deviceId: string; nickname: string }) =>
    ipcRenderer.invoke('session:register', payload) as Promise<SessionResult>,
  refresh: () => ipcRenderer.invoke('session:refresh') as Promise<SessionResult>,
  revoke: () => ipcRenderer.invoke('session:revoke') as Promise<{ phase: string } | SessionIpcError>,
},
```

- [ ] **Step 5: Narrow renderer results without casts**

In `app.tsx` and `login.tsx`, use the typed API and explicit error check:

```ts
const result = await window.pet.session.init();
if ('error' in result) {
  setPhase('signed_out');
  return;
}
setAccessToken(result.accessToken);
```

For login/register:

```ts
const result =
  mode === 'login'
    ? await window.pet.session.login({ email, password, deviceId })
    : await window.pet.session.register({ email, password, deviceId, nickname });
if ('error' in result) throw new Error(result.error);
if (!result.profile || !result.accessToken) throw new Error('登录响应缺少用户资料');
```

- [ ] **Step 6: Preserve the chat role literal type**

In the history mapper, use `satisfies ChatEntry`:

```ts
...msgs.map((message) => ({
  id: crypto.randomUUID(),
  role: message.role === 'user' ? 'user' : 'pet',
  text: message.content,
}) satisfies ChatEntry),
```

- [ ] **Step 7: Run the repaired session and type gates**

Run:

```bash
pnpm exec vitest run apps/desktop/electron/main/session-controller.test.ts apps/desktop/electron/main/session-service.test.ts
pnpm --filter @pet/desktop typecheck
```

Expected: session tests PASS; both `typecheck:node` and `typecheck:web` exit 0 with no diagnostics.

- [ ] **Step 8: Commit the gate repair**

```bash
git add apps/desktop/electron/preload/index.ts apps/desktop/electron/main/session-controller.ts apps/desktop/electron/main/session-controller.test.ts apps/desktop/electron/main/session-service.ts apps/desktop/electron/main/session-service.test.ts apps/desktop/src/app/app.tsx apps/desktop/src/app/login.tsx apps/desktop/src/app/chat-panel.tsx apps/desktop/src/app/friends.tsx
git commit -m "fix(desktop): restore strict renderer type gate"
```

---

### Task 2: Add Desktop Pet Protocol Contracts

**Files:**

- Create: `packages/protocol/src/desktop/index.ts`
- Create: `packages/protocol/src/desktop/index.test.ts`
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: Write failing strict-schema tests**

```ts
import { describe, expect, it } from 'vitest';

import {
  PetDragPointSchema,
  PetProfileSchema,
  PetRuntimeSnapshotSchema,
  PetVisualCommandSchema,
} from '../index.js';

describe('desktop pet contracts', () => {
  it('parses the default local profile', () => {
    expect(
      PetProfileSchema.parse({
        version: 1,
        petId: 'star-isle',
        displayName: '星屿',
        reducedMotion: false,
        dnd: false,
        bubbleEnabled: true,
      }).petId,
    ).toBe('star-isle');
  });

  it('rejects non-finite, out-of-range and extra drag values', () => {
    expect(() => PetDragPointSchema.parse({ x: Number.NaN, y: 0 })).toThrow();
    expect(() => PetDragPointSchema.parse({ x: 100_001, y: 0 })).toThrow();
    expect(() => PetDragPointSchema.parse({ x: 0, y: 0, code: 'x' })).toThrow();
  });

  it('parses runtime and visual discriminated unions', () => {
    expect(
      PetRuntimeSnapshotSchema.parse({ state: 'IDLE', online: true, dnd: false, hidden: false })
        .state,
    ).toBe('IDLE');
    expect(
      PetVisualCommandSchema.parse({ type: 'motion', motion: 'touch', intensity: 2 }).type,
    ).toBe('motion');
  });
});
```

- [ ] **Step 2: Run the test and verify missing exports fail**

```bash
pnpm exec vitest run packages/protocol/src/desktop/index.test.ts
```

Expected: FAIL because the desktop schemas are not exported.

- [ ] **Step 3: Implement the shared schemas**

```ts
import { z } from 'zod';

import { ActionIntentSchema, EmotionSchema, ModelOutputSchema } from '../ai/index.js';
import { PetStateSchema } from '../domain/index.js';

export const ActionSourceSchema = z.enum(['local_interaction', 'local_chat', 'cloud_ai', 'system']);
export type ActionSource = z.infer<typeof ActionSourceSchema>;

export const PetMotionSchema = z.enum([
  'idle',
  'walk',
  'sit',
  'sleep',
  'happy',
  'sad',
  'surprised',
  'wave',
  'touch',
  'talk',
]);
export type PetMotion = z.infer<typeof PetMotionSchema>;

export const PetExpressionSchema = z.enum(['neutral', 'warm', 'happy', 'sad', 'surprised', 'shy']);
export type PetExpression = z.infer<typeof PetExpressionSchema>;

export const PetProfileSchema = z
  .object({
    version: z.literal(1),
    petId: z.literal('star-isle'),
    displayName: z.string().trim().min(1).max(24),
    reducedMotion: z.boolean(),
    dnd: z.boolean(),
    bubbleEnabled: z.boolean(),
  })
  .strict();
export type PetProfile = z.infer<typeof PetProfileSchema>;

export const PetDragPointSchema = z
  .object({
    x: z.number().finite().min(-100_000).max(100_000),
    y: z.number().finite().min(-100_000).max(100_000),
  })
  .strict();

export const PetInteractionSchema = z
  .object({
    kind: z.enum(['head_touch', 'body_touch', 'tail_touch', 'double_click', 'context_menu']),
  })
  .strict();

export const PetActionRequestSchema = z
  .object({
    intent: ActionIntentSchema,
    source: ActionSourceSchema,
    reason: z.string().max(80).optional(),
  })
  .strict();

export const SessionLoginPayloadSchema = z
  .object({
    email: z.string().email().max(254),
    password: z.string().min(8).max(128),
    deviceId: z.string().uuid(),
  })
  .strict();

export const SessionRegisterPayloadSchema = SessionLoginPayloadSchema.extend({
  nickname: z.string().trim().min(1).max(40),
}).strict();

export const PetActionDecisionSchema = z
  .object({
    approved: z.boolean(),
    intent: ActionIntentSchema,
    reason: z.enum(['dnd', 'cooldown', 'not_allowed', 'offline']).optional(),
  })
  .strict();

export const PetChatSourceSchema = z.enum(['local_chat', 'cloud_ai']);
export const PetChatEventSchema = z.discriminatedUnion('phase', [
  z
    .object({ phase: z.literal('start'), source: PetChatSourceSchema, text: z.string().max(2_000) })
    .strict(),
  z
    .object({ phase: z.literal('update'), source: PetChatSourceSchema, text: z.string().max(600) })
    .strict(),
  z
    .object({ phase: z.literal('done'), source: PetChatSourceSchema, output: ModelOutputSchema })
    .strict(),
  z
    .object({
      phase: z.literal('error'),
      source: PetChatSourceSchema,
      message: z.string().max(200),
    })
    .strict(),
]);

export const PanelOpenSchema = z.object({ view: z.enum(['login', 'chat', 'friends']) }).strict();
export const BooleanSettingSchema = z.object({ enabled: z.boolean() }).strict();

export const PetRuntimeSnapshotSchema = z
  .object({
    state: PetStateSchema,
    online: z.boolean(),
    dnd: z.boolean(),
    hidden: z.boolean(),
  })
  .strict();

export const PetVisualCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('motion'),
      motion: PetMotionSchema,
      intensity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    })
    .strict(),
  z.object({ type: z.literal('expression'), expression: PetExpressionSchema }).strict(),
  z.object({ type: z.literal('speaking'), active: z.boolean() }).strict(),
  z.object({ type: z.literal('bubble'), text: z.string().max(600).nullable() }).strict(),
]);

export type PetInteraction = z.infer<typeof PetInteractionSchema>;
export type PetActionRequest = z.infer<typeof PetActionRequestSchema>;
export type PetActionDecision = z.infer<typeof PetActionDecisionSchema>;
export type PetChatEvent = z.infer<typeof PetChatEventSchema>;
export type PetRuntimeSnapshot = z.infer<typeof PetRuntimeSnapshotSchema>;
export type PetVisualCommand = z.infer<typeof PetVisualCommandSchema>;
export type PetDragPoint = z.infer<typeof PetDragPointSchema>;
export type PanelOpen = z.infer<typeof PanelOpenSchema>;
```

Export it only from the protocol root:

```ts
export * from './desktop/index.js';
```

- [ ] **Step 4: Run protocol tests and typecheck**

```bash
pnpm exec vitest run packages/protocol/src/desktop/index.test.ts
pnpm --filter @pet/protocol typecheck
```

Expected: PASS and exit 0.

- [ ] **Step 5: Commit the desktop protocol**

```bash
git add packages/protocol/src/desktop packages/protocol/src/index.ts
git commit -m "feat(protocol): add desktop pet runtime contracts"
```

---

### Task 3: Make Offline Action Approval Source-Aware

**Files:**

- Modify: `packages/pet-state/src/index.ts`
- Modify: `packages/pet-state/src/index.test.ts`
- Create: `packages/pet-state/src/visual-mapping.ts`
- Create: `packages/pet-state/src/visual-mapping.test.ts`
- Modify: `apps/desktop/src/pet/motion-mapping.ts`
- Modify: `apps/desktop/src/pet/motion-mapping.test.ts`
- Create: `apps/desktop/src/pet/pet-renderer.ts`

- [ ] **Step 1: Write offline source tests**

```ts
it('allows local interaction while offline but rejects cloud AI', () => {
  const sm = new PetStateMachine();
  sm.transition('OFFLINE', 'network_down');

  expect(sm.requestAction({ intent: 'touch', source: 'local_interaction' })).toMatchObject({
    approved: true,
  });
  expect(sm.requestAction({ intent: 'nod', source: 'local_chat' })).toMatchObject({
    approved: true,
  });
  expect(sm.requestAction({ intent: 'wave', source: 'cloud_ai' })).toEqual({
    approved: false,
    intent: 'wave',
    reason: 'offline',
  });
});

it('still rejects every active action while quiet or hidden', () => {
  const sm = new PetStateMachine();
  sm.transition('IDLE', 'boot');
  sm.transition('QUIET', 'dnd');
  expect(sm.requestAction({ intent: 'touch', source: 'local_interaction' }).approved).toBe(false);
});
```

- [ ] **Step 2: Verify the old signature fails**

```bash
pnpm exec vitest run packages/pet-state/src/index.test.ts
```

Expected: FAIL because `source` is not in `ActionRequest` and offline rejects local actions.

- [ ] **Step 3: Implement source-aware approval**

```ts
import type { ActionIntent, ActionSource, PetActionDecision, PetState } from '@pet/protocol';

export interface ActionRequest {
  intent: ActionIntent;
  source: ActionSource;
  reason?: string;
}

export type ActionDecision = PetActionDecision;

requestAction(req: ActionRequest): ActionDecision {
  if (this.state === 'QUIET' || this.state === 'HIDDEN') {
    return { approved: false, intent: req.intent, reason: 'dnd' };
  }
  if (this.state === 'OFFLINE' && req.source === 'cloud_ai') {
    return { approved: false, intent: req.intent, reason: 'offline' };
  }
  const allowedState = this.state === 'OFFLINE' ? 'IDLE' : this.state;
  if (!ACTION_WHITELIST[allowedState].has(req.intent)) {
    return { approved: false, intent: req.intent, reason: 'not_allowed' };
  }
  const cooldown = this.cooldown[req.intent];
  const last = this.lastActionAt.get(req.intent);
  if (cooldown > 0 && last !== undefined && this.now() - last < cooldown) {
    return { approved: false, intent: req.intent, reason: 'cooldown' };
  }
  this.lastActionAt.set(req.intent, this.now());
  return { approved: true, intent: req.intent };
}
```

Update all existing tests and call sites to pass `source`, using `cloud_ai` for model requests and `system` for existing pure state-machine tests.

- [ ] **Step 4: Write exhaustive process-neutral mapping tests**

Place the exhaustive table in `packages/pet-state/src/visual-mapping.test.ts` so both Electron Main and renderer consume the same implementation:

```ts
it.each([
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
] as const)('maps %s intent to %s motion', (intent, motion) => {
  expect(actionIntentToMotion(intent)).toBe(motion);
});

it.each([
  ['neutral', 'neutral'],
  ['warm', 'warm'],
  ['happy', 'happy'],
  ['sad', 'sad'],
  ['surprised', 'surprised'],
  ['shy', 'shy'],
  ['apologetic', 'sad'],
  ['concerned', 'warm'],
] as const)('maps %s emotion to %s expression', (emotion, expression) => {
  expect(emotionToExpression(emotion)).toBe(expression);
});

expect(normalizeIntensity(1)).toBe(1);
expect(normalizeIntensity(3)).toBe(2);
expect(normalizeIntensity(5)).toBe(3);
```

- [ ] **Step 5: Implement mappings in `@pet/pet-state` and preserve renderer imports**

Create `packages/pet-state/src/visual-mapping.ts` and export it from the package root. Move the existing `MOTIONS`, `EXPRESSIONS`, `stateToMotion`, `stateToExpression` and `shouldInterrupt` pure values/functions into this file, then add:

```ts
export type MotionName = PetMotion;
export type ExpressionName = PetExpression;

export function actionIntentToMotion(intent: ActionIntent): PetMotion {
  return {
    idle: 'idle',
    wave: 'wave',
    nod: 'talk',
    shake_head: 'surprised',
    touch: 'touch',
    sit: 'sit',
    sleep: 'sleep',
    walk: 'walk',
    cheer: 'happy',
    comfort: 'touch',
  }[intent];
}

export function emotionToExpression(emotion: Emotion): PetExpression {
  return {
    neutral: 'neutral',
    warm: 'warm',
    happy: 'happy',
    sad: 'sad',
    surprised: 'surprised',
    shy: 'shy',
    apologetic: 'sad',
    concerned: 'warm',
  }[emotion];
}

export function normalizeIntensity(value: number): 1 | 2 | 3 {
  const bounded = Math.max(1, Math.min(5, Math.round(value)));
  return bounded <= 2 ? 1 : bounded <= 4 ? 2 : 3;
}
```

Make `apps/desktop/src/pet/motion-mapping.ts` a compatibility re-export only:

```ts
export {
  EXPRESSIONS,
  MOTIONS,
  actionIntentToMotion,
  emotionToExpression,
  normalizeIntensity,
  shouldInterrupt,
  stateToExpression,
  stateToMotion,
} from '@pet/pet-state';
export type { ExpressionName, MotionName } from '@pet/pet-state';
```

Keep `apps/desktop/src/pet/motion-mapping.test.ts` as a small compatibility test asserting its exports equal the package exports.

Create `pet-renderer.ts`:

```ts
import type { PetExpression, PetMotion } from '@pet/protocol';

export interface PetRenderer {
  playMotion(motion: PetMotion, intensity: 1 | 2 | 3): Promise<void>;
  setExpression(expression: PetExpression): void;
  setSpeaking(active: boolean): void;
  setReducedMotion(active: boolean): void;
  dispose(): void;
}
```

- [ ] **Step 6: Run state and mapping tests**

```bash
pnpm exec vitest run packages/pet-state/src/index.test.ts packages/pet-state/src/visual-mapping.test.ts apps/desktop/src/pet/motion-mapping.test.ts
pnpm --filter @pet/desktop typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit state and mapping behavior**

```bash
git add packages/pet-state/src apps/desktop/src/pet/motion-mapping.ts apps/desktop/src/pet/motion-mapping.test.ts apps/desktop/src/pet/pet-renderer.ts
git commit -m "feat(pet): approve offline local actions and map visual intent"
```

---

### Task 4: Add Atomic Local Profile and Position Stores

**Files:**

- Create: `apps/desktop/electron/main/atomic-json-store.ts`
- Create: `apps/desktop/electron/main/atomic-json-store.test.ts`
- Create: `apps/desktop/electron/main/pet-profile-store.ts`
- Create: `apps/desktop/electron/main/pet-profile-store.test.ts`
- Create: `apps/desktop/electron/main/position-store.ts`
- Create: `apps/desktop/electron/main/position-store.test.ts`
- Modify: `apps/desktop/electron/main/display-controller.ts`

- [ ] **Step 1: Write tests using a temporary directory**

```ts
const dir = mkdtempSync(join(tmpdir(), 'pet-profile-'));
const store = new PetProfileStore(dir);
expect(store.load()).toEqual(DEFAULT_PET_PROFILE);
store.save({ ...DEFAULT_PET_PROFILE, displayName: '小星' });
expect(new PetProfileStore(dir).load().displayName).toBe('小星');
writeFileSync(join(dir, 'pet-profile.json'), '{bad');
expect(new PetProfileStore(dir).load()).toEqual(DEFAULT_PET_PROFILE);
```

For position:

```ts
const position = { displayId: '2', anchorX: 0.8, anchorY: 0.7, scale: 1, savedAt: 10 };
store.save(position);
expect(store.load()).toEqual(position);
```

Also assert no `.tmp` file remains after a successful save.

- [ ] **Step 2: Run and verify missing classes fail**

```bash
pnpm exec vitest run apps/desktop/electron/main/atomic-json-store.test.ts apps/desktop/electron/main/pet-profile-store.test.ts apps/desktop/electron/main/position-store.test.ts
```

Expected: FAIL because stores do not exist.

- [ ] **Step 3: Implement a schema-validated atomic JSON store**

```ts
export class AtomicJsonStore<T> {
  constructor(
    private readonly file: string,
    private readonly schema: ZodType<T>,
    private readonly fallback: T,
  ) {}

  load(): T {
    try {
      if (!existsSync(this.file)) return this.fallback;
      return this.schema.parse(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      return this.fallback;
    }
  }

  save(value: T): void {
    const parsed = this.schema.parse(value);
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(parsed), { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.file);
  }
}
```

- [ ] **Step 4: Implement typed wrappers**

```ts
export const DEFAULT_PET_PROFILE: PetProfile = {
  version: 1,
  petId: 'star-isle',
  displayName: '星屿',
  reducedMotion: false,
  dnd: false,
  bubbleEnabled: true,
};

export class PetProfileStore {
  private readonly store: AtomicJsonStore<PetProfile>;
  constructor(dir: string) {
    this.store = new AtomicJsonStore(
      join(dir, 'pet-profile.json'),
      PetProfileSchema,
      DEFAULT_PET_PROFILE,
    );
  }
  load(): PetProfile {
    return this.store.load();
  }
  save(profile: PetProfile): void {
    this.store.save(profile);
  }
}
```

Define `PetPositionSchema` in `display-controller.ts` with `anchorX/anchorY` in `[0,1]`, `scale` in `[0.5,2]`, and finite `savedAt`, then wrap it in `PositionStore` using `pet-position.json`.

- [ ] **Step 5: Run store tests and typecheck**

```bash
pnpm exec vitest run apps/desktop/electron/main/atomic-json-store.test.ts apps/desktop/electron/main/pet-profile-store.test.ts apps/desktop/electron/main/position-store.test.ts
pnpm --filter @pet/desktop typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit local persistence**

```bash
git add apps/desktop/electron/main/atomic-json-store* apps/desktop/electron/main/pet-profile-store* apps/desktop/electron/main/position-store* apps/desktop/electron/main/display-controller.ts
git commit -m "feat(desktop): persist pet profile and position atomically"
```

---

### Task 5: Introduce the Main-Owned Pet Runtime

**Files:**

- Create: `apps/desktop/electron/main/pet-runtime-controller.ts`
- Create: `apps/desktop/electron/main/pet-runtime-controller.test.ts`

- [ ] **Step 1: Write lifecycle and approval tests with fake timers**

Test these exact cases:

```ts
it('boots once, broadcasts IDLE and enters sitting after three minutes', () => {
  vi.useFakeTimers();
  const snapshots: PetRuntimeSnapshot[] = [];
  const runtime = new PetRuntimeController({
    emitSnapshot: (s) => snapshots.push(s),
    emitVisual: vi.fn(),
  });
  runtime.start();
  expect(snapshots.at(-1)?.state).toBe('IDLE');
  vi.advanceTimersByTime(180_000);
  expect(snapshots.at(-1)?.state).toBe('SITTING');
  runtime.stop();
});

it('plays local touch offline and rejects cloud action offline', () => {
  runtime.setOnline(false);
  expect(runtime.requestAction({ intent: 'touch', source: 'local_interaction' }).approved).toBe(
    true,
  );
  expect(runtime.requestAction({ intent: 'wave', source: 'cloud_ai' }).reason).toBe('offline');
});

it('stops timers while hidden', () => {
  runtime.setHidden(true);
  expect(runtime.snapshot.hidden).toBe(true);
  runtime.stop();
  expect(vi.getTimerCount()).toBe(0);
});
```

- [ ] **Step 2: Verify tests fail before implementation**

```bash
pnpm exec vitest run apps/desktop/electron/main/pet-runtime-controller.test.ts
```

Expected: FAIL because the controller is missing.

- [ ] **Step 3: Implement the controller with injected broadcasts**

Import `actionIntentToMotion`, `emotionToExpression`, `normalizeIntensity` and `stateToMotion` from `@pet/pet-state`; Main must never import renderer `src/**` files.

Use this public API:

```ts
export interface PetRuntimeOptions {
  emitSnapshot: (snapshot: PetRuntimeSnapshot) => void;
  emitVisual: (command: PetVisualCommand) => void;
  now?: () => number;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
}

export class PetRuntimeController {
  readonly machine: PetStateMachine;
  private interval: ReturnType<typeof setInterval> | null = null;
  private bootTimeout: ReturnType<typeof setTimeout> | null = null;
  private online = true;
  private dnd = false;
  private hidden = false;

  start(): void;
  stop(): void;
  get snapshot(): PetRuntimeSnapshot;
  setOnline(online: boolean): void;
  setDnd(enabled: boolean): void;
  setHidden(hidden: boolean): void;
  handleInteraction(interaction: PetInteraction): void;
  handleChat(event: PetChatEvent): void;
  requestAction(request: PetActionRequest): PetActionDecision;
}
```

Implementation rules:

- `start()` transitions STARTING → IDLE, emits `happy` intensity 1 as the stretch animation, schedules `idle` exactly 1,200 ms later, and starts one 5-second tick. `stop()` clears both interval and boot timeout.
- `handleInteraction(head_touch)` requests `touch/local_interaction`; body touch requests `idle/local_interaction`; tail touch requests `shake_head/local_interaction`, which maps to the surprised visual motion.
- Runtime mode precedence is `HIDDEN > QUIET > OFFLINE > activity`. Implement one `reconcileMode()` helper: derive the target from `hidden/dnd/online`; if a direct transition fails, transition through IDLE, then enter the target. Changing online/DND while hidden updates flags but leaves the machine in HIDDEN until unhidden.
- `handleChat(start)` transitions to CHATTING when online and emits speaking true; offline keeps OFFLINE but emits talk for `local_chat`; QUIET/HIDDEN reject speaking and bubble commands.
- `handleChat(update)` emits a bubble with at most the last 160 characters.
- `handleChat(done)` emits speaking false, expression, approved motion and final bubble; cloud actions use `cloud_ai`, fallback replies use `local_chat`.
- `setDnd`, `setHidden` and `setOnline` update their flag, call `reconcileMode()`, emit the resulting `stateToMotion`, and ensure exactly one tick timer exists only while visible.
- Each 5-second tick compares the state before/after `machine.tick()` and emits the new `stateToMotion` only when the state changed.
- `stop()` clears timers and never emits after stopping.

- [ ] **Step 4: Run runtime and state tests**

```bash
pnpm exec vitest run apps/desktop/electron/main/pet-runtime-controller.test.ts packages/pet-state/src/index.test.ts
```

Expected: PASS with no leaked fake timers.

- [ ] **Step 5: Commit the runtime controller**

```bash
git add apps/desktop/electron/main/pet-runtime-controller.ts apps/desktop/electron/main/pet-runtime-controller.test.ts
git commit -m "feat(desktop): own pet lifecycle in main process"
```

---

### Task 6: Split Pet and Panel Windows and Add Safe Dragging

**Files:**

- Modify: `apps/desktop/electron/main/window-controller.ts`
- Create: `apps/desktop/electron/main/window-controller.test.ts`
- Modify: `apps/desktop/electron/main/display-controller.ts`
- Modify: `apps/desktop/electron/main/display-controller.test.ts`
- Create: `apps/desktop/electron/main/pet-drag-controller.ts`
- Create: `apps/desktop/electron/main/pet-drag-controller.test.ts`

- [ ] **Step 1: Write pure display and drag tests**

Add tests that assert:

```ts
expect(
  clampPetWindowToDisplays({ x: -5000, y: 20 }, displays, { width: 280, height: 320 }),
).toEqual({ x: -1280, y: 20 });

expect(
  anchorPanelToPet(
    { x: 1500, y: 400, width: 280, height: 320 },
    { width: 360, height: 480 },
    { x: 0, y: 0, width: 1920, height: 1080 },
  ),
).toEqual({ x: 1132, y: 400 });
```

Drag tests must cover start offset, one move, out-of-display clamping, move without start, and end cleanup.

- [ ] **Step 2: Run focused tests and verify missing functions fail**

```bash
pnpm exec vitest run apps/desktop/electron/main/display-controller.test.ts apps/desktop/electron/main/pet-drag-controller.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement window geometry helpers and drag controller**

`PetDragController` receives a small window port instead of importing BrowserWindow in tests:

```ts
interface DraggableWindow {
  getBounds(): Rectangle;
  setPosition(x: number, y: number, animate?: boolean): void;
}

export class PetDragController {
  private session: { offsetX: number; offsetY: number } | null = null;
  start(win: DraggableWindow, pointer: Point): void;
  move(win: DraggableWindow, pointer: Point, displays: DisplayLike[]): void;
  end(): void;
  cancel(): void;
}
```

Compute offset from initial bounds, clamp with `clampPetWindowToDisplays`, round final coordinates, and ignore move calls without a session.

- [ ] **Step 4: Split the window factories**

Replace the single size with exact constants:

```ts
export const PET_WINDOW_SIZE = { width: 280, height: 320 } as const;
export const PANEL_WINDOW_SIZE = { width: 360, height: 480 } as const;
export type RendererSurface = 'pet' | 'panel';
```

Use one loader:

```ts
export async function loadRendererSurface(
  win: BrowserWindow,
  surface: RendererSurface,
  extra = new URLSearchParams(),
): Promise<void> {
  extra.set('surface', surface);
  if (process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL']);
    extra.forEach((value, key) => url.searchParams.set(key, value));
    await win.loadURL(url.toString());
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'), { search: extra.toString() });
  }
}
```

`createPetWindow` uses fixed size, `resizable:false`, `alwaysOnTop:true`, `skipTaskbar:true`. `createPanelWindow` uses 360×480, `show:false`, and prevents close:

```ts
win.on('close', (event) => {
  if (!app.isQuitting) {
    event.preventDefault();
    win.hide();
  }
});
```

Expose the quit flag through options instead of mutating Electron `app` with an undeclared property.

- [ ] **Step 5: Run window, drag and type tests**

```bash
pnpm exec vitest run apps/desktop/electron/main/display-controller.test.ts apps/desktop/electron/main/window-controller.test.ts apps/desktop/electron/main/pet-drag-controller.test.ts
pnpm --filter @pet/desktop typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit window architecture**

```bash
git add apps/desktop/electron/main/window-controller* apps/desktop/electron/main/display-controller* apps/desktop/electron/main/pet-drag-controller*
git commit -m "feat(desktop): split pet and panel windows"
```

---

### Task 7: Add Sender-Bound IPC and Typed Preload API

**Files:**

- Modify: `apps/desktop/electron/main/ipc/register.ts`
- Create: `apps/desktop/electron/main/ipc/register.test.ts`
- Modify: `apps/desktop/electron/main/security.ts`
- Modify: `apps/desktop/electron/preload/index.ts`
- Verify generated type: `apps/desktop/src/types/pet-api.d.ts`

- [ ] **Step 1: Write IPC guard tests**

Test a pure `validateIpcSender` helper and handler wrappers:

```ts
expect(() => validateIpcSender(validMainFrameEvent, petWindow, 'pet')).not.toThrow();
expect(() => validateIpcSender(subframeEvent, petWindow, 'pet')).toThrow('主 frame');
expect(() => validateIpcSender(panelEvent, petWindow, 'pet')).toThrow('窗口');
expect(() => parseIpcPayload(PetDragPointSchema, { x: Infinity, y: 0 })).toThrow();
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm exec vitest run apps/desktop/electron/main/ipc/register.test.ts
```

Expected: FAIL because guards are absent.

- [ ] **Step 3: Add every new channel to the allowlist**

Add these exact channel names:

```ts
'pet:runtime:get', 'pet:runtime:snapshot', 'pet:visual-command',
'pet:drag-start', 'pet:drag-move', 'pet:drag-end',
'pet:interaction', 'pet:request-action', 'pet:chat-event',
'pet:set-dnd', 'pet:set-pass-through', 'pet:show-context-menu',
'panel:open', 'panel:close', 'panel:navigate',
'pet-profile:get', 'pet-profile:set',
```

Remove unused `storage:get` and `storage:set` entries instead of exposing generic storage.

- [ ] **Step 4: Implement guarded registration**

```ts
function validateIpcSender(
  event: IpcMainEvent | IpcMainInvokeEvent,
  expected: BrowserWindow | null,
  surface: RendererSurface,
): BrowserWindow {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame)
    throw new Error('[IPC] 仅允许主 frame');
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !expected || win.id !== expected.id)
    throw new Error(`[IPC] 通道仅允许 ${surface} 窗口`);
  const url = new URL(event.senderFrame.url);
  const devOrigin = process.env['ELECTRON_RENDERER_URL']
    ? new URL(process.env['ELECTRON_RENDERER_URL']).origin
    : null;
  const packagedRenderer =
    url.protocol === 'file:' && url.pathname.endsWith('/renderer/index.html');
  const developmentRenderer = devOrigin !== null && url.origin === devOrigin;
  if (!packagedRenderer && !developmentRenderer) throw new Error('[IPC] sender URL 非法');
  return win;
}

function parseIpcPayload<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new TypeError(parsed.error.message);
  return parsed.data;
}
```

Pass a concrete dependency object:

```ts
export interface PetIpcDependencies {
  getPetWindow: () => BrowserWindow | null;
  getPanelWindow: () => BrowserWindow | null;
  runtime: PetRuntimeController;
  drag: PetDragController;
  profile: PetProfileStore;
  getDisplays: () => DisplayLike[];
  openPanel: (view: PanelOpen['view']) => void;
  closePanel: () => void;
  showContextMenu: () => void;
  setPassThrough: (enabled: boolean) => void;
  session?: SessionServiceHandlers;
}
```

Register each channel with its exact protocol schema and required surface. `pet-profile:set`, session and panel navigation are panel-only; drag/interaction/context menu are pet-only; runtime snapshot is available to both. Parse session login/register with `SessionLoginPayloadSchema` and `SessionRegisterPayloadSchema` instead of casts.

- [ ] **Step 5: Expose a narrow typed API**

Add a `petRuntime` namespace in preload:

```ts
petRuntime: {
  getSnapshot: () => ipcRenderer.invoke('pet:runtime:get') as Promise<PetRuntimeSnapshot>,
  onSnapshot: (cb: (snapshot: PetRuntimeSnapshot) => void) => subscribe('pet:runtime:snapshot', cb),
  onVisualCommand: (cb: (command: PetVisualCommand) => void) => subscribe('pet:visual-command', cb),
  interaction: (payload: PetInteraction) => ipcRenderer.send('pet:interaction', payload),
  requestAction: (payload: PetActionRequest) => ipcRenderer.invoke('pet:request-action', payload) as Promise<PetActionDecision>,
  chatEvent: (payload: PetChatEvent) => ipcRenderer.send('pet:chat-event', payload),
  dragStart: (point: Point) => ipcRenderer.send('pet:drag-start', point),
  dragMove: (point: Point) => ipcRenderer.send('pet:drag-move', point),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  setDnd: (enabled: boolean) => ipcRenderer.send('pet:set-dnd', { enabled }),
  setPassThrough: (enabled: boolean) => ipcRenderer.send('pet:set-pass-through', { enabled }),
  showContextMenu: () => ipcRenderer.send('pet:show-context-menu'),
},
panel: {
  open: (view: PanelOpen['view']) => ipcRenderer.send('panel:open', { view }),
  close: () => ipcRenderer.send('panel:close'),
  onNavigate: (cb: (view: PanelOpen['view']) => void) => subscribe('panel:navigate', cb),
},
petProfile: {
  get: () => ipcRenderer.invoke('pet-profile:get') as Promise<PetProfile>,
  set: (profile: PetProfile) => ipcRenderer.invoke('pet-profile:set', profile) as Promise<PetProfile>,
},
```

Use one generic `subscribe` whose cleanup body returns `void`.

- [ ] **Step 6: Run IPC tests and desktop typecheck**

```bash
pnpm exec vitest run apps/desktop/electron/main/ipc/register.test.ts
pnpm --filter @pet/desktop typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the IPC boundary**

```bash
git add apps/desktop/electron/main/ipc/register* apps/desktop/electron/main/security.ts apps/desktop/electron/preload/index.ts apps/desktop/src/types/pet-api.d.ts
git commit -m "feat(desktop): validate pet IPC and bind window senders"
```

---

### Task 8: Render the Original Layered Star Isle SVG

**Files:**

- Modify: `vitest.config.ts`
- Create: `apps/desktop/src/pet/star-isle-visual.tsx`
- Create: `apps/desktop/src/pet/star-isle-visual.test.tsx`
- Create: `apps/desktop/src/pet/svg-pet-renderer.ts`
- Create: `apps/desktop/src/pet/svg-pet-renderer.test.ts`
- Create: `apps/desktop/src/pet/pet-fallback.tsx`
- Modify: `apps/desktop/src/styles.css`

- [ ] **Step 1: Enable desktop TSX discovery and write static-markup tests**

Add the missing glob to `vitest.config.ts` before creating tests:

```ts
'apps/desktop/src/**/*.test.tsx',
```

Use `react-dom/server` so these first visual tests remain in the Node environment:

```tsx
const markup = renderToStaticMarkup(<StarIsleVisual state={DEFAULT_VISUAL_STATE} />);
for (const part of [
  'body',
  'head',
  'ear-left',
  'ear-right',
  'eye-left',
  'eye-right',
  'mouth',
  'tail',
  'tail-star',
  'crown',
]) {
  expect(markup).toContain(`data-part="${part}"`);
}
expect(markup).toContain('viewBox="0 0 280 320"');
```

Renderer test:

```ts
const updates: StarIsleVisualState[] = [];
const renderer = createSvgPetRenderer((state) => updates.push(state));
await renderer.playMotion('touch', 2);
renderer.setExpression('happy');
renderer.setSpeaking(true);
expect(updates.at(-1)).toMatchObject({
  motion: 'touch',
  intensity: 2,
  expression: 'happy',
  speaking: true,
});
renderer.dispose();
```

- [ ] **Step 2: Run and verify tests fail**

```bash
pnpm exec vitest run apps/desktop/src/pet/star-isle-visual.test.tsx apps/desktop/src/pet/svg-pet-renderer.test.ts
```

Expected: FAIL because visual modules do not exist.

- [ ] **Step 3: Implement renderer state and adapter**

```ts
export interface StarIsleVisualState {
  motion: PetMotion;
  expression: PetExpression;
  intensity: 1 | 2 | 3;
  speaking: boolean;
  reducedMotion: boolean;
}

export const DEFAULT_VISUAL_STATE: StarIsleVisualState = {
  motion: 'idle',
  expression: 'warm',
  intensity: 1,
  speaking: false,
  reducedMotion: false,
};

export function createSvgPetRenderer(update: (state: StarIsleVisualState) => void): PetRenderer {
  let disposed = false;
  let state = DEFAULT_VISUAL_STATE;
  const set = (patch: Partial<StarIsleVisualState>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    update(state);
  };
  return {
    playMotion: async (motion, intensity) => set({ motion, intensity }),
    setExpression: (expression) => set({ expression }),
    setSpeaking: (speaking) => set({ speaking }),
    setReducedMotion: (reducedMotion) => set({ reducedMotion }),
    dispose: () => {
      disposed = true;
    },
  };
}
```

- [ ] **Step 4: Implement the original SVG character**

Use a fixed `viewBox="0 0 280 320"`, `role="img"`, `aria-label="星尾狐猫星屿"`, and these groups:

```tsx
<svg
  className="star-isle"
  viewBox="0 0 280 320"
  role="img"
  aria-label="星尾狐猫星屿"
  data-motion={state.motion}
  data-expression={state.expression}
  data-speaking={state.speaking}
  data-reduced-motion={state.reducedMotion}
>
  <defs>
    <radialGradient id="star-glow">
      <stop offset="0" stopColor="#fff8cf" />
      <stop offset="1" stopColor="#ffe094" stopOpacity="0" />
    </radialGradient>
  </defs>
  <g data-part="tail" className="star-isle__tail">
    <path
      d="M190 238 C244 190 263 225 242 266 C228 289 202 278 191 261"
      fill="none"
      stroke="#91a9df"
      strokeWidth="28"
      strokeLinecap="round"
    />
  </g>
  <g data-part="tail-star" className="star-isle__tail-star">
    <circle cx="245" cy="213" r="30" fill="url(#star-glow)" />
    <path
      d="M245 185 253 202 272 204 258 217 262 236 245 227 228 236 232 217 218 204 237 202Z"
      fill="#ffe094"
    />
  </g>
  <g data-part="body" className="star-isle__body">
    <ellipse cx="140" cy="232" rx="72" ry="57" fill="#cbdaf5" />
    <ellipse cx="92" cy="278" rx="31" ry="18" fill="#b6c9ee" />
    <ellipse cx="188" cy="278" rx="31" ry="18" fill="#b6c9ee" />
  </g>
  <g data-part="head" className="star-isle__head">
    <path data-part="ear-left" d="M77 107 C48 24 105 77 116 91Z" fill="#7188c8" />
    <path data-part="ear-right" d="M203 107 C232 24 175 77 164 91Z" fill="#7188c8" />
    <ellipse cx="140" cy="150" rx="78" ry="72" fill="#cbdaf5" />
    <path d="M78 126 C96 88 140 86 202 126 C167 105 140 116 78 126Z" fill="#8199d5" />
    <g data-part="eye-left">
      <ellipse cx="108" cy="148" rx="11" ry="16" fill="#415277" />
      <circle cx="104" cy="142" r="4" fill="#fff" />
    </g>
    <g data-part="eye-right">
      <ellipse cx="172" cy="148" rx="11" ry="16" fill="#415277" />
      <circle cx="168" cy="142" r="4" fill="#fff" />
    </g>
    <path
      data-part="mouth"
      className="star-isle__mouth"
      d="M130 174 Q140 184 150 174"
      fill="none"
      stroke="#795b77"
      strokeWidth="5"
      strokeLinecap="round"
    />
    <ellipse className="star-isle__cheek" cx="91" cy="181" rx="15" ry="8" fill="#f2aabd" />
    <ellipse className="star-isle__cheek" cx="189" cy="181" rx="15" ry="8" fill="#f2aabd" />
    <path
      data-part="crown"
      className="star-isle__crown"
      d="M140 82 147 58 158 80 178 70 170 95Z"
      fill="#ffe094"
    />
  </g>
  <g data-part="paw-left">
    <ellipse cx="92" cy="236" rx="22" ry="30" fill="#cbdaf5" />
  </g>
  <g data-part="paw-right" className="star-isle__paw-right">
    <ellipse cx="188" cy="236" rx="22" ry="30" fill="#cbdaf5" />
  </g>
</svg>
```

Keep each `data-part` unique. Add hit-area paths with transparent fill and `pointer-events:all` only for head, body and tail.

- [ ] **Step 5: Add bounded animations and reduced-motion rules**

Define classes selected through `data-motion`, `data-expression`, `data-speaking` and `data-reduced-motion`. Include these exact keyframe families:

```css
@keyframes star-isle-breathe {
  0%,
  100% {
    transform: translateY(0) scaleY(1);
  }
  50% {
    transform: translateY(-2px) scaleY(1.015);
  }
}
@keyframes star-isle-blink {
  0%,
  44%,
  52%,
  100% {
    transform: scaleY(1);
  }
  48% {
    transform: scaleY(0.08);
  }
}
@keyframes star-isle-tail {
  0%,
  100% {
    transform: rotate(-3deg);
  }
  50% {
    transform: rotate(7deg);
  }
}
@keyframes star-isle-talk {
  0%,
  100% {
    transform: scaleY(0.4);
  }
  50% {
    transform: scaleY(1.2);
  }
}
@keyframes star-isle-touch {
  50% {
    transform: translateY(6px) scaleY(0.96);
  }
}
```

Use only transform/opacity. Under reduced motion, disable all infinite animations and retain a 120 ms opacity transition.

- [ ] **Step 6: Add a static fallback**

`PetFallback` renders the same outer silhouette without animation and with `data-testid="star-isle-fallback"`. It must preserve head/body/tail hit targets through caller-provided handlers.

- [ ] **Step 7: Run visual tests and typecheck**

```bash
pnpm exec vitest run apps/desktop/src/pet/star-isle-visual.test.tsx apps/desktop/src/pet/svg-pet-renderer.test.ts
pnpm --filter @pet/desktop typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the original visual**

```bash
git add vitest.config.ts apps/desktop/src/pet/star-isle-visual* apps/desktop/src/pet/svg-pet-renderer* apps/desktop/src/pet/pet-fallback.tsx apps/desktop/src/styles.css
git commit -m "feat(pet): render original Star Isle SVG character"
```

---

### Task 9: Add Pointer Interaction, Bubble and Pet Surface

**Files:**

- Create: `apps/desktop/src/pet/pointer-interaction.ts`
- Create: `apps/desktop/src/pet/pointer-interaction.test.ts`
- Create: `apps/desktop/src/pet/pet-bubble.tsx`
- Create: `apps/desktop/src/pet/pet-bubble.test.tsx`
- Create: `apps/desktop/src/pet/use-pet-runtime.ts`
- Create: `apps/desktop/src/pet/pet-experience.tsx`
- Create: `apps/desktop/src/pet/pet-experience.test.tsx`
- Modify: `apps/desktop/src/main.tsx`
- Modify: `apps/desktop/src/styles.css`

- [ ] **Step 1: Write pointer classifier and component tests**

Keep the pure classifier test in Node. Start `pet-bubble.test.tsx` and `pet-experience.test.tsx` with the explicit environment directive because the root Vitest config defaults to Node:

```ts
// @vitest-environment jsdom
```

Mock `window.pet` before rendering `PetExperience` and restore it after each test. Assert listener cleanups are called on unmount and the fallback appears when the visual child throws.

Classifier cases:

```ts
expect(
  classifyPointer({
    start: { x: 10, y: 10, at: 0 },
    end: { x: 14, y: 12, at: 120 },
    previousClickAt: null,
  }),
).toBe('click');
expect(
  classifyPointer({
    start: { x: 10, y: 10, at: 0 },
    end: { x: 17, y: 10, at: 80 },
    previousClickAt: null,
  }),
).toBe('drag');
expect(
  classifyPointer({
    start: { x: 10, y: 10, at: 200 },
    end: { x: 10, y: 10, at: 260 },
    previousClickAt: 0,
  }),
).toBe('double_click');
```

Use Euclidean distance, a 6 CSS px drag threshold and a 320 ms double-click window.

- [ ] **Step 2: Verify tests fail**

```bash
pnpm exec vitest run apps/desktop/src/pet/pointer-interaction.test.ts
```

Expected: FAIL because classifier is missing.

- [ ] **Step 3: Implement pointer capture and one-move-per-frame throttling**

Export pure `classifyPointer` plus `createDragMoveScheduler(send)`:

```ts
export function createDragMoveScheduler(send: (point: Point) => void) {
  let frame: number | null = null;
  let latest: Point | null = null;
  return {
    push(point: Point) {
      latest = point;
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        if (latest) send(latest);
      });
    },
    cancel() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      latest = null;
    },
  };
}
```

`PetExperience` maps SVG hit targets to `head_touch`, `body_touch`, and `tail_touch`, uses `screenX/screenY` for drag IPC, opens chat on double click, and requests native context menu on right click.

- [ ] **Step 4: Implement fixed bubble rendering**

```tsx
export function PetBubble({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="pet-speech" role="status" aria-live="polite">
      {text}
    </div>
  );
}
```

CSS must use a fixed width, maximum three lines, `overflow:hidden`, and must not change the 280×320 root dimensions.

- [ ] **Step 5: Implement runtime subscription hook and surface routing**

`usePetRuntime` loads one snapshot, subscribes to snapshots and commands, and always cleans up listeners. It also loads `PetProfile`; when `bubbleEnabled=false`, it ignores bubble commands, and it forwards `reducedMotion` to the renderer.

Create an explicit error boundary in `pet-experience.tsx`:

```tsx
interface PetVisualBoundaryProps extends React.PropsWithChildren {
  fallback: React.ReactNode;
}
class PetVisualBoundary extends React.Component<PetVisualBoundaryProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
```

`PetExperience` creates one SVG renderer, applies commands, and wraps `StarIsleVisual` with this boundary. The fallback prop is `PetFallback` wired to the same head/body/tail pointer handlers, so dragging and double-click chat still work after an animation failure. For tests, accept an optional `VisualComponent` prop defaulting to `StarIsleVisual`, so the failure path can inject a throwing component without production globals.

Update `main.tsx`:

```tsx
const params = new URLSearchParams(window.location.search);
const root = params.has('poc') ? (
  <PocApp />
) : params.get('surface') === 'pet' ? (
  <PetExperience />
) : (
  <AppPanel />
);
createRoot(el).render(<React.StrictMode>{root}</React.StrictMode>);
```

- [ ] **Step 6: Run pet surface tests**

```bash
pnpm exec vitest run apps/desktop/src/pet/pointer-interaction.test.ts apps/desktop/src/pet/pet-bubble.test.tsx apps/desktop/src/pet/pet-experience.test.tsx
pnpm --filter @pet/desktop typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit direct interaction**

```bash
git add apps/desktop/src/pet/pointer-interaction* apps/desktop/src/pet/pet-bubble* apps/desktop/src/pet/use-pet-runtime.ts apps/desktop/src/pet/pet-experience* apps/desktop/src/main.tsx apps/desktop/src/styles.css
git commit -m "feat(pet): add touch drag and bubble interaction"
```

---

### Task 10: Wire Main Lifecycle, Tray and Recovery

**Files:**

- Modify: `apps/desktop/electron/main/index.ts`
- Modify: `apps/desktop/electron/main/tray-controller.ts`
- Create: `apps/desktop/electron/main/tray-controller.test.ts`
- Create: `tools/generate-tray-icon.mjs`
- Create: `apps/desktop/resources/tray.png`
- Modify: `apps/desktop/electron-builder.yml`
- Modify: root `package.json`

- [ ] **Step 1: Add pngjs and generate a deterministic original tray icon**

```bash
pnpm add -Dw pngjs @types/pngjs
```

Create `tools/generate-tray-icon.mjs`; do not download or embed external assets:

```js
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'apps/desktop/resources/tray.png');
const png = new PNG({ width: 32, height: 32, colorType: 6 });
const set = (x, y, [r, g, b, a = 255]) => {
  if (x < 0 || x >= 32 || y < 0 || y >= 32) return;
  const i = (y * 32 + x) * 4;
  [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]] = [r, g, b, a];
};
const fillEllipse = (cx, cy, rx, ry, color) => {
  for (let y = cy - ry; y <= cy + ry; y += 1) {
    for (let x = cx - rx; x <= cx + rx; x += 1) {
      if ((x - cx) ** 2 / rx ** 2 + (y - cy) ** 2 / ry ** 2 <= 1) set(x, y, color);
    }
  }
};
const blue = [113, 136, 200, 255];
const light = [203, 218, 245, 255];
const dark = [65, 82, 119, 255];
const gold = [255, 224, 148, 255];
fillEllipse(15, 18, 11, 10, light);
for (let y = 3; y <= 13; y += 1) {
  for (let x = 4; x <= 12; x += 1) if (x - 4 <= 12 - y) set(x, y, blue);
  for (let x = 18; x <= 26; x += 1) if (26 - x <= 12 - y) set(x, y, blue);
}
fillEllipse(11, 17, 2, 3, dark);
fillEllipse(19, 17, 2, 3, dark);
for (const [x, y] of [
  [27, 18],
  [26, 19],
  [28, 19],
  [25, 20],
  [26, 20],
  [27, 20],
  [28, 20],
  [29, 20],
  [26, 21],
  [28, 21],
  [27, 22],
])
  set(x, y, gold);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, PNG.sync.write(png));
```

Expose:

```json
"assets:tray": "node tools/generate-tray-icon.mjs"
```

Run it and assert the file is non-empty:

```bash
pnpm assets:tray
node -e "const fs=require('fs'); if(fs.statSync('apps/desktop/resources/tray.png').size < 100) process.exit(1)"
```

- [ ] **Step 2: Write tray behavior tests**

Make native creation injectable through `TrayControllerOptions.createTray`, `loadIcon` and `buildMenu` defaults. The controller owns the two tray states and exposes `dispatch()` plus a read-only snapshot. Test it directly:

```ts
const handlers: TrayHandlers = {
  onOpenPanel: vi.fn(),
  onSetDnd: vi.fn(),
  onSetPassThrough: vi.fn(),
  onHide: vi.fn(),
  onShow: vi.fn(),
  onQuit: vi.fn(),
};
const tray = new TrayController(() => fakeWindow, handlers, fakeNativeOptions);
tray.create();
tray.dispatch('open-chat');
expect(handlers.onOpenPanel).toHaveBeenCalledWith('chat');
tray.dispatch('toggle-dnd');
expect(tray.snapshot.dnd).toBe(true);
expect(handlers.onSetDnd).toHaveBeenCalledWith(true);
tray.dispatch('toggle-pass-through');
expect(tray.snapshot.passThrough).toBe(true);
expect(handlers.onSetPassThrough).toHaveBeenCalledWith(true);
tray.dispatch('show');
expect(tray.snapshot.passThrough).toBe(false);
expect(handlers.onShow).toHaveBeenCalledOnce();
expect(handlers.onSetPassThrough).toHaveBeenLastCalledWith(false);
```

Create a second controller with `loadIcon: () => ({ isEmpty: () => true })`; after `create()`, assert `dispatch('toggle-pass-through')` throws `托盘图标不可用，不能开启穿透`. Assert fake menu callbacks call `dispatch`, rebuild checked states, and fake double-click follows the same `show` path.

- [ ] **Step 3: Wire explicit pet and panel references**

Refactor `main.ts` to hold:

```ts
let petWindow: BrowserWindow | null = null;
let panelWindow: BrowserWindow | null = null;
let quitting = false;
```

Before `app.whenReady()`, isolate automated runs without weakening production behavior:

```ts
const e2eUserDataDir = process.env['PET_E2E_USER_DATA_DIR'];
if (process.env['PET_E2E'] === '1' && e2eUserDataDir) app.setPath('userData', e2eUserDataDir);
```

Create petWindow immediately. Create panelWindow lazily in `openPanel(view)`, anchor it beside the pet, send `panel:navigate`, show and focus it. Deep links call `openPanel('login')` or `openPanel('friends')`; they never send payloads to petWindow.

Instantiate `PositionStore`, `PetProfileStore`, `PetRuntimeController`, `PetDragController` and IPC dependencies before renderer ready. Start runtime once `petWindow` finishes loading.

- [ ] **Step 4: Add renderer recovery and lifecycle cleanup**

For `petWindow.webContents`:

```ts
let petRecoveryAttempts = 0;
let petStableTimer: ReturnType<typeof setTimeout> | null = null;
webContents.on('render-process-gone', (_event, details) => {
  if (quitting || petRecoveryAttempts >= 1) return;
  petRecoveryAttempts += 1;
  if (petStableTimer) clearTimeout(petStableTimer);
  console.warn(`[pet-window] renderer gone: ${details.reason}`);
  petWindow?.destroy();
  petWindow = createAndWirePetWindow();
});
webContents.on('did-finish-load', () => {
  if (petStableTimer) clearTimeout(petStableTimer);
  petStableTimer = setTimeout(() => {
    petRecoveryAttempts = 0;
  }, 30_000);
});
```

On `before-quit`, set `quitting=true`, clear `petStableTimer`, stop runtime, cancel drag, destroy tray and allow panel close. Panel load or renderer failures log a stable code and leave petWindow untouched.

- [ ] **Step 5: Wire tray state and resource path**

Use `process.resourcesPath/tray.png` when packaged and source resources in development. The controller owns tray toggles; Main/runtime do not keep duplicate pass-through or DND booleans:

```ts
export interface TrayHandlers {
  onOpenPanel: (view: 'chat' | 'friends') => void;
  onSetDnd: (enabled: boolean) => void;
  onSetPassThrough: (enabled: boolean) => void;
  onHide: () => void;
  onShow: () => void;
  onQuit: () => void;
}
export type TrayAction = 'open-chat' | 'open-friends' | 'toggle-dnd' | 'toggle-pass-through' | 'hide' | 'show' | 'quit';

get snapshot() { return { dnd: this.dnd, passThrough: this.passThrough }; }
dispatch(action: TrayAction): void {
  switch (action) {
    case 'open-chat': this.handlers.onOpenPanel('chat'); return;
    case 'open-friends': this.handlers.onOpenPanel('friends'); return;
    case 'toggle-dnd': this.dnd = !this.dnd; this.handlers.onSetDnd(this.dnd); this.refresh(); return;
    case 'toggle-pass-through':
      if (!this.iconReady && !this.passThrough) throw new Error('托盘图标不可用，不能开启穿透');
      this.passThrough = !this.passThrough;
      this.handlers.onSetPassThrough(this.passThrough);
      this.refresh();
      return;
    case 'hide': this.handlers.onHide(); return;
    case 'show':
      this.passThrough = false;
      this.handlers.onSetPassThrough(false);
      this.handlers.onShow();
      this.refresh();
      return;
    case 'quit': this.handlers.onQuit(); return;
  }
}
```

Every menu callback and double-click handler calls `dispatch`; no menu callback mutates state directly.

Only when `PET_E2E=1`, expose a non-IPC Main-process test hook for Playwright `electronApp.evaluate`:

```ts
if (process.env['PET_E2E'] === '1') {
  Object.defineProperty(globalThis, '__petE2E', {
    configurable: true,
    value: {
      invokeTrayAction: (action: TrayAction) => tray?.dispatch(action),
      getTrayState: () => tray?.snapshot ?? { dnd: false, passThrough: false },
    },
  });
}
```

The production path must not define the hook. E2E uses it to verify the exact show/disable-pass-through handler without relying on flaky system-tray screen coordinates.

Add builder asset:

```yaml
extraResources:
  - from: resources/tray.png
    to: tray.png
```

- [ ] **Step 6: Run Main tests and build**

```bash
pnpm exec vitest run apps/desktop/electron/main/pet-runtime-controller.test.ts apps/desktop/electron/main/pet-drag-controller.test.ts apps/desktop/electron/main/tray-controller.test.ts
pnpm --filter @pet/desktop typecheck
pnpm --filter @pet/desktop build
```

Expected: PASS and successful electron-vite build.

- [ ] **Step 7: Commit Main lifecycle**

```bash
git add package.json pnpm-lock.yaml tools/generate-tray-icon.mjs apps/desktop/resources/tray.png apps/desktop/electron-builder.yml apps/desktop/electron/main/index.ts apps/desktop/electron/main/tray-controller*
git commit -m "feat(desktop): wire Star Isle windows tray and recovery"
```

---

### Task 11: Connect Panel Chat to the Pet Runtime

**Files:**

- Modify: `apps/desktop/src/app/app.tsx`
- Modify: `apps/desktop/src/app/chat-panel.tsx`
- Modify: `apps/desktop/src/app/local-chat.tsx`
- Delete: `apps/desktop/src/pet/use-pet-state-machine.ts`
- Modify: `apps/desktop/src/lib/api/client.ts`
- Modify: `apps/desktop/src/lib/api/client.test.ts`
- Modify: `apps/desktop/src/lib/api/sse.test.ts`
- Verify: `apps/server/src/routes/chat.ts`

- [ ] **Step 1: Write complete done-frame parsing tests**

```ts
const done = {
  dialogue: '今天也一起努力。',
  emotion: 'warm',
  actionIntent: 'nod',
  intensity: 3,
};
expect(onDone).toHaveBeenCalledWith(done);
```

Add a negative test where `intensity: 9` or an extra `code` property causes `onError` and never calls `onDone`.

- [ ] **Step 2: Run and verify current client loses fields**

```bash
pnpm exec vitest run apps/desktop/src/lib/api/client.test.ts apps/desktop/src/lib/api/sse.test.ts
```

Expected: FAIL because `chatStream.onDone` only exposes dialogue.

- [ ] **Step 3: Parse SSE done payload with the shared schema**

Change the handler type to `onDone: (output: ModelOutput) => void` and use:

```ts
if (frame.event === 'done') {
  const parsed = ModelOutputSchema.safeParse(data);
  if (!parsed.success) {
    handlers.onError?.('模型回复格式无效');
    continue;
  }
  handlers.onDone(parsed.data);
}
```

Do not change the server route in this task. Verify the existing SSE frame contains all four keys with:

```bash
rg -n "dialogue:|emotion:|actionIntent:|intensity:" apps/server/src/routes/chat.ts
```

Expected: the `done` frame in `apps/server/src/routes/chat.ts` contains each key exactly once.

- [ ] **Step 4: Remove the renderer-owned state machine from panel**

Rename the existing declaration `export function App()` to `export function AppPanel()` without changing its session/tab body, then add `export const App = AppPanel;` after the function so current imports remain source-compatible.

Remove all imports and props for `usePetStateMachine`; after `rg "usePetStateMachine|PetStateController" apps/desktop/src` returns no matches, delete `apps/desktop/src/pet/use-pet-state-machine.ts`. Chat components call `window.pet.petRuntime.chatEvent(...)` instead.

Subscribe to `panel:navigate` and switch `phase/tab` only after the panel surface mounts.

- [ ] **Step 5: Send cloud and local chat lifecycle events**

Cloud flow:

```ts
window.pet.petRuntime.chatEvent({ phase: 'start', source: 'cloud_ai', text });
// Throttle cumulative bubble text to at most once per 100 ms.
window.pet.petRuntime.chatEvent({ phase: 'update', source: 'cloud_ai', text: reply.slice(-160) });
window.pet.petRuntime.chatEvent({ phase: 'done', source: 'cloud_ai', output });
```

On cloud network/provider failure, generate one local reply with the existing `localReply`, append it to the current conversation, and send a `done` event with:

```ts
{ phase: 'done', source: 'local_chat', output: { dialogue: localReplyText, emotion: 'warm', actionIntent: 'nod', intensity: 1 } }
```

Display a non-blocking notice “云端暂不可用，已切换本地回应”. Do not recursively retry the cloud request.

LocalChat sends the same start/done events using `source=local_chat` behavior in Main.

- [ ] **Step 6: Run chat tests, typecheck and one focused E2E**

```bash
pnpm exec vitest run apps/desktop/src/lib/api/client.test.ts apps/desktop/src/lib/api/sse.test.ts
pnpm --filter @pet/desktop typecheck
pnpm --filter @pet/desktop build
npx playwright test --config e2e/playwright.config.ts chat.spec.ts
```

Expected: unit tests PASS; chat E2E passes when the local backend is running and reports its existing skip only when explicitly run without that prerequisite.

- [ ] **Step 7: Commit chat integration**

```bash
git add apps/desktop/src/app/app.tsx apps/desktop/src/app/chat-panel.tsx apps/desktop/src/app/local-chat.tsx apps/desktop/src/pet/use-pet-state-machine.ts apps/desktop/src/lib/api/client.ts apps/desktop/src/lib/api/client.test.ts apps/desktop/src/lib/api/sse.test.ts
git commit -m "feat(pet): drive Star Isle from local and cloud chat"
```

---

### Task 12: Add Isolated Electron E2E and Pixel Assertions

**Files:**

- Create: `e2e/helpers/electron-app.ts`
- Create: `e2e/helpers/pixel-assertions.ts`
- Create: `e2e/star-isle.spec.ts`
- Modify: `e2e/desktop.smoke.spec.ts`
- Modify: `e2e/login.spec.ts`
- Modify: `e2e/chat.spec.ts`
- Modify: `e2e/deep-link.spec.ts`
- Modify: `e2e/ws-realtime.spec.ts`
- Modify: root `package.json`

- [ ] **Step 1: Add an isolated Electron launcher**

```ts
async function findWindow(app: ElectronApplication, surface: 'pet' | 'panel'): Promise<Page> {
  await expect
    .poll(async () => {
      for (const page of app.windows()) {
        if (new URL(page.url()).searchParams.get('surface') === surface) return true;
      }
      return false;
    })
    .toBe(true);
  return app.windows().find((page) => new URL(page.url()).searchParams.get('surface') === surface)!;
}

export async function launchPetApp(extraArgs: string[] = []) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'star-isle-e2e-'));
  const start = () =>
    electron.launch({
      cwd: APP_DIR,
      args: ['.', ...extraArgs],
      env: { ...process.env, PET_E2E: '1', PET_E2E_USER_DATA_DIR: userDataDir },
    });
  let application = await start();
  return {
    get app() {
      return application;
    },
    userDataDir,
    petWindow: () => findWindow(application, 'pet'),
    panelWindow: () => findWindow(application, 'panel'),
    async windowState(surface: 'pet' | 'panel') {
      return application.evaluate(({ BrowserWindow }, requested) => {
        const win = BrowserWindow.getAllWindows().find(
          (candidate) =>
            new URL(candidate.webContents.getURL()).searchParams.get('surface') === requested,
        );
        return win ? { bounds: win.getBounds(), visible: win.isVisible() } : null;
      }, surface);
    },
    async invokeTrayAction(action: TrayAction) {
      await application.evaluate((_electron, requested) => {
        const hook = (
          globalThis as typeof globalThis & {
            __petE2E?: { invokeTrayAction: (value: TrayAction) => void };
          }
        ).__petE2E;
        if (!hook) throw new Error('PET_E2E hook unavailable');
        hook.invokeTrayAction(requested);
      }, action);
    },
    async trayState() {
      return application.evaluate(() => {
        const hook = (
          globalThis as typeof globalThis & {
            __petE2E?: { getTrayState: () => { dnd: boolean; passThrough: boolean } };
          }
        ).__petE2E;
        if (!hook) throw new Error('PET_E2E hook unavailable');
        return hook.getTrayState();
      });
    },
    async restart() {
      await application.close();
      application = await start();
    },
    async close() {
      await application.close();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}
```

Import `ElectronApplication`, `Page`, `expect`, and `TrayAction` as types where applicable. Never use `firstWindow()`.

- [ ] **Step 2: Add PNG alpha/body checks**

```ts
export function countVisiblePixels(
  buffer: Buffer,
  region?: { x: number; y: number; width: number; height: number },
): number {
  const png = PNG.sync.read(buffer);
  const area = region ?? { x: 0, y: 0, width: png.width, height: png.height };
  let visible = 0;
  for (let y = area.y; y < area.y + area.height; y += 1) {
    for (let x = area.x; x < area.x + area.width; x += 1) {
      if (png.data[(y * png.width + x) * 4 + 3]! > 16) visible += 1;
    }
  }
  return visible;
}
```

- [ ] **Step 3: Write Star Isle E2E cases**

Cover these in one serial spec:

```ts
test('cold start shows nonblank Star Isle without login', async () => {
  const page = await fixture.petWindow();
  await expect(page.getByRole('img', { name: '星尾狐猫星屿' })).toBeVisible();
  const shot = await page.screenshot({ omitBackground: true });
  expect(countVisiblePixels(shot, { x: 35, y: 45, width: 210, height: 250 })).toBeGreaterThan(
    8_000,
  );
});

test('head touch animates and double click opens the panel', async () => {
  const pet = await fixture.petWindow();
  await pet.locator('[data-hit="head"]').click();
  await expect(pet.locator('[data-motion="touch"]')).toBeVisible();
  await pet.locator('[data-hit="body"]').dblclick();
  await expect((await fixture.panelWindow()).locator('.login-page')).toBeVisible();
});

test('drag persists across restart', async () => {
  const pet = await fixture.petWindow();
  const before = (await fixture.windowState('pet'))!.bounds;
  const box = await pet.locator('[data-hit="body"]').boundingBox();
  expect(box).not.toBeNull();
  await pet.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await pet.mouse.down();
  await pet.mouse.move(box!.x + box!.width / 2 + 48, box!.y + box!.height / 2 + 32, { steps: 4 });
  await pet.mouse.up();
  await expect.poll(async () => (await fixture.windowState('pet'))!.bounds.x).not.toBe(before.x);
  const moved = (await fixture.windowState('pet'))!.bounds;
  await fixture.restart();
  await fixture.petWindow();
  expect((await fixture.windowState('pet'))!.bounds).toMatchObject({ x: moved.x, y: moved.y });
});

test('tray action recovers hidden and pass-through pet', async () => {
  await fixture.invokeTrayAction('toggle-pass-through');
  await fixture.invokeTrayAction('hide');
  expect((await fixture.windowState('pet'))!.visible).toBe(false);
  await fixture.invokeTrayAction('show');
  expect((await fixture.windowState('pet'))!.visible).toBe(true);
  expect(await fixture.trayState()).toMatchObject({ passThrough: false });
});

test('local chat works without authentication and drives the bubble', async () => {
  const pet = await fixture.petWindow();
  await pet.locator('[data-hit="body"]').dblclick();
  const panel = await fixture.panelWindow();
  await panel.getByRole('button', { name: '先逛逛（本地模式）' }).click();
  await panel.locator('.local-chat input').fill('你好');
  await panel.locator('.local-chat').getByRole('button', { name: '发送' }).click();
  await expect(pet.locator('.pet-speech')).toContainText(/你好|嗨|哈喽/);
});
```

Also add a panel-close test (`window.close()` hides panel and leaves pet visible), a DND test (runtime snapshot is `QUIET` and active motions do not start), and a reduced-motion test (set profile through panel preload and assert `data-reduced-motion="true"`). For tray actions, use the `PET_E2E=1` Main hook; unit tests separately verify that real menu items call the same `handleTrayAction` function.

- [ ] **Step 4: Migrate existing specs to the helper**

Every existing test must request `panelWindow()` after opening the panel. Keep existing selectors `.login-page`, `.friends-page`, `.chat-panel` and deep-link assertions. Use one fixture per spec file and always call its cleanup.

- [ ] **Step 5: Add the focused script and run Star Isle E2E**

```json
"test:e2e:star-isle": "pnpm --filter @pet/desktop build && playwright test --config e2e/playwright.config.ts star-isle.spec.ts"
```

Run:

```bash
pnpm test:e2e:star-isle
```

Expected: all Star Isle tests pass; cold-start screenshot has more than 8,000 visible pixels in the body region.

- [ ] **Step 6: Run the complete E2E suite**

With the local Postgres and server running:

```bash
pnpm test:e2e
```

Expected: all previous 10 tests plus Star Isle tests pass; none of the backend-required tests are skipped in this local verification run.

- [ ] **Step 7: Commit E2E isolation**

```bash
git add package.json pnpm-lock.yaml e2e
git commit -m "test(e2e): verify visible Star Isle desktop pet"
```

---

### Task 13: Add CI, Packaging and Manual Windows Gates

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/status-2026-08-02.md`
- Modify: `docs/poc-window-capabilities.md`

- [ ] **Step 1: Add a Windows Star Isle CI job**

```yaml
star-isle-windows:
  runs-on: windows-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
      with:
        version: 9
    - uses: actions/setup-node@v4
      with:
        node-version: 20
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter @pet/desktop typecheck
    - run: pnpm --filter @pet/desktop build
    - run: pnpm exec playwright test --config e2e/playwright.config.ts star-isle.spec.ts
```

Keep the existing Linux smoke job; do not mark backend tests successful when skipped.

- [ ] **Step 2: Run the complete local quality gate**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @pet/desktop typecheck
pnpm test
pnpm test:e2e
pnpm --filter @pet/desktop package:win
```

Expected: every command exits 0. Record exact unit/E2E counts in the status document after this run, not before.

- [ ] **Step 3: Perform Windows manual checks and record evidence**

In `docs/poc-window-capabilities.md`, add a dated table with:

- Windows version and machine model;
- display count and 100%/150%/200% DPI result;
- negative-coordinate monitor result;
- drag persistence result;
- DND, hide and pass-through tray recovery result;
- offline launch and local chat result;
- 30-minute visible runtime result;
- installer path, sha256 and clean-user-profile launch result.

Do not check an item without direct evidence. Capture screenshots for default and high DPI and reference their local artifact names without committing screenshots containing personal desktop content.

- [ ] **Step 4: Update project documentation to the implemented state**

Add this README section verbatim:

```md
## 首只真实桌宠：星屿

Windows 10/11 首版使用项目原创的 React SVG 星尾狐猫「星屿」。启动无需登录即可显示、拖动、摸头和使用本地聊天；双击星屿打开登录/聊天/好友面板。首版使用手动整窗穿透，必须从托盘恢复，不使用 PetDex 或 Live2D 样本资产。
```

Add these AGENTS landing rows:

```md
| 改星屿外观/动作/直接交互 | `apps/desktop/src/pet/*` | 星屿设计稿 |
| 改桌宠状态审批/动作映射 | `packages/pet-state/src/*` | 7.1 / 星屿设计稿 |
| 改双窗口/拖动/托盘恢复 | `apps/desktop/electron/main/*` | 8.2–8.5 / 星屿设计稿 |
```

In `docs/status-2026-08-02.md`, replace the old ModelLoader-only renderer description with the verified `petWindow + StarIsleVisual + PetRuntimeController` architecture and append the exact unit/E2E counts from Step 2. State explicitly that Live2D remains deferred and is not required by this SVG milestone.

In `docs/poc-window-capabilities.md`, retain the limitation: “Electron 首版仅支持手动整窗穿透，不承诺透明像素穿透”. Add the dated evidence table from Step 3. Remove no unrelated unfinished warnings.

- [ ] **Step 5: Request code review before final commit**

Invoke `requesting-code-review` with base SHA equal to the commit before Task 1 and head SHA equal to current HEAD. Fix every Critical and Important finding, rerun the affected focused tests, then rerun the complete quality gate.

- [ ] **Step 6: Commit CI and evidence**

```bash
git add .github/workflows/ci.yml README.md AGENTS.md docs/status-2026-08-02.md docs/poc-window-capabilities.md
git commit -m "docs: record Star Isle desktop pet verification"
```

- [ ] **Step 7: Verify clean completion state**

```bash
git status --short
git log --oneline -13
```

Expected: clean working tree and one focused commit per task group. Do not push until the user explicitly authorizes publishing this implementation branch.
