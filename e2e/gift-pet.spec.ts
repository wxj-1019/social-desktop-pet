/**
 * 9.4 送礼闭环 e2e：alice 送礼 → bob 的桌宠（星屿）开心反应（happy 动作 + 送礼气泡）。
 *
 * 链路：node 侧 alice POST /gift → 后端给 bob 的 inbox 投递 gift.snack_sent
 *   → bob 面板（friends 页）WS inbox.delivered → pullSync → friends.tsx 消费事件
 *   → window.pet.petRuntime.socialEvent → Main runtime.handleSocialEvent
 *   → pet 窗口 expression happy + motion happy + 气泡「…送来了小饼干！」
 *
 * 前置：后端已启动 + alice/bob 为好友（测试库）；后端不可达时整组跳过。
 * Task 12：登录面在面板窗（surface=panel）经 helper.openPanel 进入，禁 firstWindow。
 */
import { expect, test } from '@playwright/test';

import { launchPetApp } from './helpers/electron-app.js';
import type { PetApp } from './helpers/electron-app.js';

const API_BASE = process.env['PET_API_BASE'] ?? 'http://127.0.0.1:8787';

let app: PetApp;

test.beforeAll(async () => {
  try {
    const res = await fetch(`${API_BASE}/healthz`);
    if (!res.ok) test.skip(1, `后端不可达（${API_BASE}）`);
  } catch {
    test.skip(1, `后端不可达（${API_BASE}）`);
  }
  // 自愈：清空配额计数（gift 每日 3 次会被反复 e2e 耗尽；端点仅本地 PET_DEV_RESET 开启）
  await fetch(`${API_BASE}/__dev/reset-test-data`, { method: 'POST' }).catch(() => {});
  app = await launchPetApp();
});

test.afterAll(async () => {
  await app?.close();
});

/** node 侧登录拿 token（与 ws-realtime.spec.ts 同款模式） */
async function loginToken(email: string): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'password123',
      deviceId: crypto.randomUUID(),
      platform: 'windows',
    }),
  });
  const body = (await res.json()) as { accessToken: string; userId: string };
  return { token: body.accessToken, userId: body.userId };
}

test('好友送礼 → 星屿开心（happy 动作 + 气泡文案）', async () => {
  const pet = await app.petWindow();
  const isle = pet.getByRole('img', { name: '星尾狐猫星屿' });
  // 等启动动画结束（happy → idle），避免与送礼动画混淆
  await expect(isle).toHaveAttribute('data-motion', 'idle', { timeout: 15_000 });

  // bob 登录（friends 页挂载 → WS 连接 + sync 事件消费）
  const panel = await app.openPanel('chat');
  await panel.waitForLoadState('domcontentloaded');
  await app.loginAs(panel, 'bob@test.local');

  // 历史送礼事件（此前 e2e 运行残留于 bob inbox）会在挂载时被消费，
  // 立即送礼会命中 cheer/wave 的 10s 冷却（补偿 wave 或干脆无动作）——
  // 等冷却过期，保证本次送礼触发 happy 动作。
  await panel.waitForTimeout(11_000);

  // node 侧：alice 登录 → 给 bob 送小饼干（幂等键唯一）。
  // 注意：不登录 bob——登录会激活新设备并把 active_display_device_id 切走，
  // 挤掉 bob 面板设备（9.8 单活跃设备 → 面板后续请求 403 device_revoked）。
  // bob 的 userId 从 alice 的好友列表取。
  const alice = await loginToken('alice@test.local');
  const friendsRes = await fetch(`${API_BASE}/friends`, {
    headers: { authorization: `Bearer ${alice.token}` },
  });
  const { friends } = (await friendsRes.json()) as {
    friends: Array<{ userId: string; nickname: string }>;
  };
  const bob = friends.find((friend) => friend.nickname === 'bob');
  expect(bob).toBeDefined();
  const giftRes = await fetch(`${API_BASE}/gift`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({
      toUserId: bob!.userId,
      snackId: 'snack_cookie',
      clientEventId: crypto.randomUUID(),
    }),
  });
  expect(giftRes.ok).toBe(true);

  // 星屿开心：happy 动作（cheer 审批通过后播放，动画期间 data-motion 保持）
  // 窗口放宽到 45s：全量套件跑时 WS 可能重连（事件经 30s 轮询兜底迟到）
  await expect(isle).toHaveAttribute('data-motion', 'happy', { timeout: 45_000 });

  // 开心表情（情绪不经动作审批，稳定出现且不随冷却消退）
  await expect(isle).toHaveAttribute('data-expression', 'happy', { timeout: 45_000 });

  // 送礼气泡：含点心名（小饼干）；气泡可能被后续指令顶掉，用 poll 容错
  await expect
    .poll(
      async () =>
        (await pet
          .locator('.pet-speech')
          .textContent()
          .catch(() => null)) ?? '',
      { timeout: 45_000, message: '送礼后星屿未出现送礼气泡' },
    )
    .toContain('小饼干');
});
