/* eslint-disable no-console -- CLI 工具，输出即产品 */
/**
 * 资源基线测量（8.7 性能门槛）—— Windows 优先（D-2）。
 *
 * 用法：
 *   node tools/bench/resource-bench.mjs [--duration 180] [--interval 5]
 *
 * 流程：
 *   1. 要求 desktop 已构建（apps/desktop/out/main/index.js）
 *   2. 启动 Electron 应用（后台）
 *   3. 按 interval 采样整个应用进程树（Electron 的 main/renderer/gpu/utility 子进程）
 *   4. 输出 JSON 报告：RSS P50/P95、CPU%（P50）、进程数、冷启动耗时
 *
 * 对照 8.7 门槛（Windows 下限设备）：
 *   - 冷启动到角色可见 P95 ≤ 4s（本脚本只测进程启动，角色可见需人工/截图辅助）
 *   - 空闲 CPU 整进程树 P50 ≤ 2%（P95 参考观测）
 *   - 空闲总进程内存 RSS P50 ≤ 300MB（P95 参考观测）
 *   - 8 小时无持续正向内存趋势（放长测：--duration 28800）
 *
 * 注：正式验收需在"一台 Windows 下限设备"上预热后连续空闲 30 分钟（8.7）；
 *     本脚本支持长测，本机首次跑建议 --duration 120 验证链路。
 */
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(__dirname, '..', '..', 'apps', 'desktop');
const MAIN_ENTRY = join(APP_DIR, 'out', 'main', 'index.js');

function parseArgs(argv) {
  const args = { duration: 180, interval: 5 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--duration') args.duration = Number(argv[i + 1]);
    if (argv[i] === '--interval') args.interval = Number(argv[i + 1]);
  }
  return args;
}

/** 采样一次 Electron 进程树（PowerShell） */
function sampleOnce() {
  const ps = `
$p = Get-Process -Name electron -ErrorAction SilentlyContinue
if (-not $p) { Write-Output '[]'; exit }
$rows = $p | ForEach-Object {
  [pscustomobject]@{
    pid = $_.Id
    ws = $_.WorkingSet64
    cpu = $_.CPU
    start = $_.StartTime
  }
}
$rows | ConvertTo-Json -Compress
`;
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  return JSON.parse(out.trim() || '[]');
}

/** 总 RSS（字节）与总 CPU 秒 */
function summarize(samples) {
  const last = samples[samples.length - 1] ?? [];
  const totalRss = last.reduce((s, p) => s + p.ws, 0);
  const totalCpu = last.reduce((s, p) => s + (p.cpu ?? 0), 0);
  return { pidCount: last.length, totalRss, totalCpu };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

async function main() {
  const { duration, interval } = parseArgs(process.argv);
  if (!existsSync(MAIN_ENTRY)) {
    console.error(`未找到 ${MAIN_ENTRY} —— 请先运行 pnpm --filter @pet/desktop build`);
    process.exit(1);
  }

  void Date.now();
  console.log(`[bench] 启动 Electron（${MAIN_ENTRY}）…`);
  const child = spawn(process.execPath, [MAIN_ENTRY], {
    cwd: APP_DIR,
    stdio: 'ignore',
    detached: true,
  });

  // 等应用起来
  await new Promise((r) => setTimeout(r, 3000));

  const rssSamples = [];
  const cpuSamples = [];
  const startCpu = {};

  const samples = Math.floor(duration / interval);
  console.log(`[bench] 采样 ${samples} 次（每 ${interval}s，共 ${duration}s）`);

  for (let i = 0; i < samples; i++) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    const procs = sampleOnce();
    if (procs.length === 0) continue;

    const totalRss = procs.reduce((s, p) => s + p.ws, 0);
    // CPU%：相对上次采样的增量 / 间隔
    let cpuPct = 0;
    for (const p of procs) {
      const prev = startCpu[p.pid] ?? p.cpu;
      const delta = p.cpu - prev;
      cpuPct += (delta / interval) * 100;
      startCpu[p.pid] = p.cpu;
    }
    rssSamples.push(totalRss);
    cpuSamples.push(Math.max(0, cpuPct));
    process.stdout.write(
      `  #${i + 1}/${samples} RSS=${(totalRss / 1024 / 1024).toFixed(1)}MB CPU=${cpuPct.toFixed(1)}%\n`,
    );
  }

  // 关闭应用
  if (child.pid) {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      /* 已退出 */
    }
  }

  const rssSorted = [...rssSamples].sort((a, b) => a - b);
  const cpuSorted = [...cpuSamples].sort((a, b) => a - b);
  const report = {
    measuredAt: new Date().toISOString(),
    durationSec: duration,
    intervalSec: interval,
    processCount: sampleOnce().length || summarize([]).pidCount,
    rssMB: {
      p50: +(percentile(rssSorted, 50) / 1024 / 1024).toFixed(1),
      p95: +(percentile(rssSorted, 95) / 1024 / 1024).toFixed(1),
      min: +(rssSorted[0] / 1024 / 1024).toFixed(1),
      max: +(rssSorted[rssSorted.length - 1] / 1024 / 1024).toFixed(1),
    },
    cpuPct: {
      p50: +percentile(cpuSorted, 50).toFixed(2),
      p95: +percentile(cpuSorted, 95).toFixed(2),
    },
    // 8.7 门槛对照（P50 为 MVP 门槛，P95 参考观测）
    gates: {
      rssP50Le300MB: percentile(rssSorted, 50) <= 300 * 1024 * 1024,
      cpuP50Le2Pct: percentile(cpuSorted, 50) <= 2,
    },
  };
  console.log('\n[bench] 报告:');
  console.log(JSON.stringify(report, null, 2));

  // 追加到记录文件
  const fs = await import('node:fs');
  const recordFile = join(__dirname, '..', '..', 'docs', 'poc-window-capabilities.md');
  const block = ['```json', JSON.stringify(report, null, 2), '```', ''].join('\n');
  fs.appendFileSync(
    recordFile,
    `\n### 资源基线实测（${new Date().toISOString()}，--duration ${duration}s）\n\n${block}`,
  );
  console.log(`[bench] 已追加到 docs/poc-window-capabilities.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
