# fast-ab.ps1 — 快速 A/B：验证 routing-suite 的"引导注入"是否改变模型行为
#
# 原理：routing-suite 对模型唯一的实质影响 = 向组装后的系统提示注入一段
# GUIDANCE 文本（见 src/router.mjs）。门控（preset= routing-suite 才生效）已由
# /routing-suite/api/status 验证。本脚本跳过 GUI，用 headless 跑两次相同任务：
#   1) baseline : 不加引导
#   2) injected : 任务前注入与插件完全一致的 GUIDANCE（等效于 applyRoutingToAssembly）
# 比较两次输出的行为差异，即可在 ~2-3 分钟内判断"路由引导在你环境是否有效"。
#
# Usage: pwsh -File fast-ab.ps1 [-Task "..."] [-ProjectDir "..."]
param(
  [string]$Task = "READ-ONLY. apps/server/src/lib/memory-store.ts, recallMemories: report the exact line range of the function, then answer: is the embedding HTTP call inside the DB transaction? Give the minimal fix in one sentence. Do not edit any file.",
  [string]$ProjectDir = "E:\A_Project\ai-social-desktop-pet"
)
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $scriptDir 'compare'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
if (-not (Test-Path $ProjectDir)) { throw "project dir not found: $ProjectDir" }

# 与 src/router.mjs GUIDANCE['inspect-first'] 逐字一致
$GUIDANCE = 'Routing guidance: this is a maintenance or investigation task. Inspect the relevant facts first, identify the root cause, then make the smallest justified change and verify it.'

Write-Host '==== fast A/B: routing guidance effect ===='
Write-Host "Project : $ProjectDir"
Write-Host ''

# baseline: task alone
Write-Host '[1/2] baseline (no guidance) ...'
Push-Location $ProjectDir
try { $b = @(dsh --profile headless $Task 2>&1) } finally { Pop-Location }
$b | Set-Content -Encoding utf8 (Join-Path $outDir 'fast-baseline.txt')
Write-Host "  -> fast-baseline.txt ($($b.Count) lines)"

# injected: guidance + task
Write-Host '[2/2] injected (routing guidance) ...'
$routedPrompt = "$GUIDANCE`n`n$Task"
Push-Location $ProjectDir
try { $r = @(dsh --profile headless $routedPrompt 2>&1) } finally { Pop-Location }
$r | Set-Content -Encoding utf8 (Join-Path $outDir 'fast-routed.txt')
Write-Host "  -> fast-routed.txt ($($r.Count) lines)"

Write-Host ''
Write-Host '==== results ===='
Write-Host ''
Write-Host '----- baseline (no guidance) -----'
$b
Write-Host ''
Write-Host '----- injected (routing guidance: inspect-first) -----'
$r
Write-Host ''
Write-Host '==== quick behavioral heuristics ===='
$bb = $b -join "`n"
$rr = $r -join "`n"
foreach ($pair in @(
  @('mentions file path / line numbers', [regex]::Matches($bb, '\.ts:\d+|lines?\s*\d+').Count, [regex]::Matches($rr, '\.ts:\d+|lines?\s*\d+').Count),
  @('inspect verbs (inspect/检查/read/查看/root cause)', [regex]::Matches($bb, 'inspect|root cause|检查|查看|阅读').Count, [regex]::Matches($rr, 'inspect|root cause|检查|查看|阅读').Count),
  @('fix/edit verbs (fix/edit/修改/修复/改成)', [regex]::Matches($bb, '\bfix\b|edit|修改|修复|改成').Count, [regex]::Matches($rr, '\bfix\b|edit|修改|修复|改成').Count)
)) {
  Write-Host ("  {0,-42} baseline={1} injected={2}" -f $pair[0], $pair[1], $pair[2])
}
Write-Host ''
Write-Host 'Judge whether the injected run inspects facts/root-cause more before concluding.'
