/**
 * Presence 闭环 e2e（9.2）：bob 的 WS 上线/下线 → alice 好友卡片在线标识实时变化。
 *
 * 链路：node 侧 bob WebSocket 连 /realtime（auth）→ 服务端 onPresenceChanged
 *   → presence.changed（B 类）投递 alice → alice 面板 pullSync → 好友卡片绿点亮起；
 *   bob 断开 → 下线事件 → 绿点熄灭（下线不弹桌宠气泡，只静默更新标识）。
 *
 * 前置：后端已启动 + alice/bob 为好友（global-setup 预置）；后端不可达时整组跳过。
 */
import { expect, test } from '@playwright/test';

import { launchPetApp } from './helpers/electron-app.js';
import type { PetApp } from './helpers/electron-app.js';

const API_BASE = process.env['PET_API_BASE'] ?? 'http://127.0.0.1:8787';
const WS_BASE = API_BASE.replace(/^http/, 'ws');

let app: PetApp;

test.beforeAll(async () => {
  try {
    const res = await fetch(`${API_BASE}/healthz`);
    if (!res.ok) test.skip(1, `后端不可达（${API_BASE}）`);
  } catch {
    test.skip(1, `后端不可达（${API_BASE}）`);
  }
  app = await launchPetApp();
});

test.afterAll(async () => {
  await app?.close();
});

/** node 侧登录拿 token */
async function loginToken(email: string): Promise<{ token: string }> {
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
  const body = (await res.json()) as { accessToken: string };
  return { token: body.accessToken };
}

/** 建立已鉴权 WS 连接（等 auth_ok） */
async function connectAuthedWs(token: string): Promise<WebSocket> {
  const ws = new WebSocket(`${WS_BASE}/realtime`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ws connect timeout')), 10_000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('ws error'));
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (String(ev.data).includes('auth_ok')) {
        clearTimeout(timer);
        resolve();
      }
    };
  });
  return ws;
}

test('bob WS 上线/下线 → alice 好友卡片在线标识实时变化', async () => {
  // alice 登录面板（好友页挂载 → WS + presence 事件消费）
  const page = await app.openPanel('chat');
  await page.waitForLoadState('domcontentloaded');
  await app.loginAs(page, 'alice@test.local');

  // 前置断言：bob 离线（灰点；alice 面板刚登录，bob 尚未连接）
  await expect(page.locator('.friend-presence')).not.toHaveClass(/friend-presence--online/, {
    timeout: 10_000,
  });

  // bob 上线（node 侧 WS）
  const bob = await loginToken('bob@test.local');
  const ws = await connectAuthedWs(bob.token);

  // presence.changed → alice 好友卡片绿点亮起（20s：全量套件下事件链路有抖动）
  await expect(page.locator('.friend-presence')).toHaveClass(/friend-presence--online/, {
    timeout: 20_000,
  });

  // bob 下线（WS 关闭）→ 绿点熄灭
  ws.close();
  await expect(page.locator('.friend-presence')).not.toHaveClass(/friend-presence--online/, {
    timeout: 20_000,
  });
});
