/* eslint-disable no-console -- CLI 压测工具 */
/**
 * V-10：Supabase Presence 计费量实测（第 1–2 周门禁）
 *
 * 背景（第二轮调研 §4.2）：Presence 心跳本质是 Broadcast 同步，官方文档未明说
 * 是否计入消息配额；500 常驻用户每 10s 心跳，理论月消息量可达亿级 → $3000+/月。
 * 本脚本在本地 Supabase 栈上实测真实消息速率，回填 12.6 成本区间。
 *
 * 前置：
 *   1. Docker Desktop 已启动
 *   2. cd packages/supabase && supabase start   （输出 URL/anon key）
 *   3. 运行：node tools/bench/measure-presence.mjs --clients 20 --duration 60
 *
 * 输出：
 *   - 每秒消息量（服务端视角：每次 presence track 广播给通道内其他成员）
 *   - 推算 1000 MAU 常驻场景的月消息量
 *   - 对照 Supabase 计费：Pro 含 5M 消息/月，超额 $2.50/1M
 */
import { RealtimeClient } from '@supabase/realtime-js';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const anonKey = process.env.SUPABASE_ANON_KEY ?? '';
const params = { clients: 20, duration: 60, heartbeatMs: 10_000 };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--clients') params.clients = Number(process.argv[i + 1]);
  if (process.argv[i] === '--duration') params.duration = Number(process.argv[i + 1]);
  if (process.argv[i] === '--heartbeat-ms') params.heartbeatMs = Number(process.argv[i + 1]);
}

if (!anonKey) {
  console.error('未设置 SUPABASE_ANON_KEY —— 请先 supabase start 并设置环境变量');
  process.exit(1);
}

/** 服务端视角消息量估算：每次 track 广播给通道内其他 N-1 个成员 */
function estimateMessagesPerSecond(clientCount, heartbeatMs) {
  return (clientCount * (clientCount - 1)) / (heartbeatMs / 1000);
}

function monthlyMessages(perSecond) {
  return perSecond * 60 * 60 * 24 * 30;
}

async function main() {
  console.log(
    `[presence] 连接 ${params.clients} 客户端 × ${params.duration}s，心跳 ${params.heartbeatMs}ms`,
  );
  console.log(`[presence] 目标: ${url}`);

  const clients = [];
  const errors = [];
  let receivedBroadcasts = 0;
  let receivedPresence = 0;

  for (let i = 0; i < params.clients; i++) {
    const client = new RealtimeClient(url, {
      params: { apikey: anonKey },
      heartbeatIntervalMs: 25_000,
      timeout: 20_000,
    });
    clients.push(client);

    const channel = client.channel(`room:bench:${i % 4}`, {
      config: { presence: { key: `user-${i}` } },
    });

    channel
      .on('broadcast', { event: 'heartbeat' }, () => receivedBroadcasts++)
      .on('presence', { event: 'sync' }, () => receivedPresence++)
      .on('system', { event: 'error' }, (e) => errors.push(String(e)));

    await channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return;
      // 进入 presence + 初始 track
      void channel.track({ online_at: new Date().toISOString() });
      // 周期性心跳（模拟常驻桌宠 presence 更新）
      const timer = setInterval(() => {
        void channel.track({ online_at: new Date().toISOString(), beat: Date.now() });
      }, params.heartbeatMs);
      // @ts-expect-error 挂到 channel 上便于清理
      channel._benchTimer = timer;
    });

    client.connect();
  }

  // 等所有连接就绪
  await new Promise((r) => setTimeout(r, 5_000));
  const t0 = Date.now();

  await new Promise((r) => setTimeout(r, params.duration * 1000));

  const elapsedSec = (Date.now() - t0) / 1000;
  const presencePerSec = receivedPresence / elapsedSec;

  // 清理
  for (const c of clients) {
    try {
      for (const ch of c.getChannels()) {
        // @ts-expect-error 清理定时器
        clearInterval(ch._benchTimer);
        await ch.unsubscribe();
      }
      c.disconnect();
    } catch {
      /* ignore */
    }
  }

  // 服务端消息量估算（每次 track → 广播给其他成员）
  const serverMsgPerSec = estimateMessagesPerSecond(params.clients, params.heartbeatMs);
  const monthServer = monthlyMessages(serverMsgPerSec);
  // 1000 MAU 常驻场景（40% 并发 = 400 连接，10s 心跳）
  const scaleMsgPerSec = estimateMessagesPerSecond(400, 10_000);
  const scaleMonth = monthlyMessages(scaleMsgPerSec);

  const report = {
    measuredAt: new Date().toISOString(),
    url,
    params,
    results: {
      connectedClients: clients.length,
      errors: errors.length,
      clientSidePresenceEventsPerSec: +presencePerSec.toFixed(1),
      serverSideEstimatedMessagesPerSec: serverMsgPerSec,
      serverSideEstimatedMonthlyMessages: Math.round(monthServer),
    },
    projection: {
      scenario: '1000 MAU、40% 并发（400 连接）、10s 心跳',
      serverSideMonthlyMessages: Math.round(scaleMonth),
      proPlanIncluded: 5_000_000,
      overshootMessages: Math.max(0, Math.round(scaleMonth - 5_000_000)),
      overshootCostUSD: +((Math.max(0, scaleMonth - 5_000_000) / 1_000_000) * 2.5).toFixed(2),
    },
  };

  console.log('\n[presence] 报告:');
  console.log(JSON.stringify(report, null, 2));

  // 追加到 V-10 记录
  const fs = await import('node:fs');
  const recordFile = new URL('../docs/poc-window-capabilities.md', import.meta.url);
  fs.appendFileSync(
    recordFile,
    `\n### V-10 Presence 计费实测（${new Date().toISOString()}）\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`,
  );
  console.log('[presence] 已追加到 docs/poc-window-capabilities.md');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
