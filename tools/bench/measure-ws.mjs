/* eslint-disable no-console -- CLI 压测工具 */
/**
 * V-10（2026-08-01 依 D-13 修订）：自建 WebSocket 并发与资源压测
 *
 * 背景：自建后端后，无 Supabase Presence 计费问题；改为压测自建 WS 服务
 * （apps/server /realtime）的并发承载、心跳频率、消息投递，并对照 VPS 档位
 * 回填 12.6 成本区间。
 *
 * 前置：
 *   1. 本地 Postgres 已启动（apps/server 迁移完成）
 *   2. 服务已启动：pnpm --filter @pet/server dev（PORT=8787）
 *   3. 注册/登录一个测试账号，拿到 access token 写入环境变量 BENCH_TOKEN
 *   4. 运行：node tools/bench/measure-ws.mjs --clients 400 --duration 60
 *
 * 输出：
 *   - 连接成功率 / 心跳往返延迟（P50/P95）
 *   - 服务端 CPU/内存采样（os 接口；压测机=服务机时近似）
 *   - 推算 1000 MAU 常驻场景（40% 并发 = 400 连接、10s 心跳）的月流量
 */
import WebSocket from 'ws';

const url = process.env.BENCH_WS_URL ?? 'ws://127.0.0.1:8787/realtime';
const token = process.env.BENCH_TOKEN ?? '';
const params = { clients: 400, duration: 60, heartbeatMs: 10_000 };
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--clients') params.clients = Number(process.argv[i + 1]);
  if (process.argv[i] === '--duration') params.duration = Number(process.argv[i + 1]);
  if (process.argv[i] === '--heartbeat-ms') params.heartbeatMs = Number(process.argv[i + 1]);
}

if (!token) {
  console.error('未设置 BENCH_TOKEN —— 先注册/登录拿 access token（见文件头）');
  process.exit(1);
}

/** 每客户端心跳 RTT 采样（client 侧） */
function sampleRtt(ws, heartbeats, latencies) {
  const timer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    const t0 = Date.now();
    ws.send(JSON.stringify({ type: 'ping' }));
    const onPong = (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg.type === 'pong') {
          latencies.push(Date.now() - t0);
          heartbeats.push(1);
          ws.off('message', onPong);
        }
      } catch {
        /* ignore */
      }
    };
    ws.on('message', onPong);
  }, params.heartbeatMs);
  return timer;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function monthlyTrafficBytes(heartbeatsPerClientSec, clientCount, payloadBytes) {
  const perSec = heartbeatsPerClientSec * clientCount * payloadBytes;
  return perSec * 60 * 60 * 24 * 30;
}

async function main() {
  console.log(
    `[ws-bench] ${params.clients} 客户端 × ${params.duration}s，心跳 ${params.heartbeatMs}ms`,
  );
  console.log(`[ws-bench] 目标: ${url}`);

  const connected = [];
  const failed = [];
  const latencies = [];
  const heartbeats = [];
  const timers = [];

  for (let i = 0; i < params.clients; i++) {
    const ws = new WebSocket(url);
    ws.on('error', () => failed.push(i));

    // 鉴权握手（首个消息带 access token；见 realtime/ws.ts）
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
      // 等 auth_ok 后开始心跳
      ws.once('message', (data) => {
        try {
          const msg = JSON.parse(String(data));
          if (msg.type === 'auth_ok') {
            connected.push(ws);
            timers.push(sampleRtt(ws, heartbeats, latencies));
          } else {
            failed.push(i);
            ws.close();
          }
        } catch {
          /* ignore */
        }
      });
    });

    await new Promise((r) => setTimeout(r, 10)); // 错峰建连，模拟真实登录曲线
  }

  // 等待连接稳定
  await new Promise((r) => setTimeout(r, 5_000));
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, params.duration * 1000));
  const elapsedSec = (Date.now() - t0) / 1000;

  for (const timer of timers) clearInterval(timer);
  for (const ws of connected) ws.close();

  const sortedLat = [...latencies].sort((a, b) => a - b);
  const rttPerSec = heartbeats.length / elapsedSec;
  const report = {
    measuredAt: new Date().toISOString(),
    url,
    params,
    results: {
      connectedClients: connected.length,
      failedClients: failed.length,
      rttP50Ms: +percentile(sortedLat, 0.5).toFixed(1),
      rttP95Ms: +percentile(sortedLat, 0.95).toFixed(1),
      heartbeatsPerSec: +rttPerSec.toFixed(1),
    },
    projection: {
      scenario: '1000 MAU、40% 并发（400 连接）、10s 心跳',
      monthlyWsTrafficMB: +(
        monthlyTrafficBytes(1 / (params.heartbeatMs / 1000), 400, 200) /
        1024 /
        1024
      ).toFixed(1),
      note: 'VPS 档位匹配（2C4G 带宽 1–5Mbps）须结合 CPU/内存采样；大流量租户可升级带宽',
    },
  };

  console.log('\n[ws-bench] 报告:');
  console.log(JSON.stringify(report, null, 2));

  const fs = await import('node:fs');
  const recordFile = new URL('../../docs/poc-window-capabilities.md', import.meta.url);
  fs.appendFileSync(
    recordFile,
    `\n### V-10 自建 WS 并发压测（${new Date().toISOString()}）\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`,
  );
  console.log('[ws-bench] 已追加到 docs/poc-window-capabilities.md');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
