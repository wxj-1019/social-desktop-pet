# compare-routing.ps1 — A/B: dsh-routing-suite ON vs OFF on one real task
#
# Usage:
#   pwsh -File compare-routing.ps1
#   pwsh -File compare-routing.ps1 -Task "..." -ProjectDir "E:\A_Project\ai-social-desktop-pet"
#
# Legs:
#   [1/3] Baseline (routing OFF): dsh --profile headless "<task>"  -- fully automated.
#         Headless carries no routing-suite bundle, so this is a clean "no routing" run.
#   [2/3] Routed  (routing ON):   boots `dsh --profile web`, you pick 智能路由模式
#         (strategy is pinned to inspect-first by the web profile patch), run the SAME
#         task in the browser, then save the final reply to compare\routed.txt.
#   [3/3] Compare: prints both transcripts + an inspect-first grading checklist.
#
# SAFETY: the default task is READ-ONLY (review only, no file edits). For edit/refactor
#         tasks, run against a COPY of the project (see -ProjectDir) so the agent's
#         changes cannot touch your real working tree.
#
# Depends on: dsh CLI (DeepSeek Harness), an OpenWebUI-style web profile, and the
#             routing-suite preset installed (see install.ps1).

param(
  [string]$Task = "Only READ-ONLY analysis. Review apps/server/src/lib/memory-store.ts recallMemories: list 1) potential bugs 2) RLS/permission risks 3) optimization suggestions. Do NOT modify any file.",
  [string]$ProjectDir = "E:\A_Project\ai-social-desktop-pet",
  [int]$WebPort = 6510,
  [int]$WaitForRoutedSec = 300
)
$ErrorActionPreference = 'Stop'
$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = Join-Path $scriptDir 'compare'
$baselineFile = Join-Path $outDir 'baseline.txt'
$routedFile = Join-Path $outDir 'routed.txt'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
if (-not (Test-Path $ProjectDir)) { throw "project dir not found: $ProjectDir" }

Write-Host '===================================================================='
Write-Host ' dsh-routing-suite A/B comparison'
Write-Host " Task      : $($Task.Substring(0, [Math]::Min(80, $Task.Length)))..."
Write-Host " Project   : $ProjectDir"
Write-Host '===================================================================='

# ---------------------------------------------------------------- baseline leg
Write-Host ''
Write-Host '[1/3] Baseline (routing OFF) via dsh --profile headless ...'
Push-Location $ProjectDir
try {
  $baseline = @(dsh --profile headless $Task 2>&1)
} finally {
  Pop-Location
}
$baseline | Set-Content -Encoding utf8 $baselineFile
Write-Host "  -> saved $baselineFile ($($baseline.Count) lines)"

# ---------------------------------------------------------------- routed leg
Write-Host ''
Write-Host '[2/3] Routed (routing ON) via the web profile ...'
# 优先复用已在运行的 web 实例（如用户手动 dsh --profile web 起的实例）
$status = $null
try { $status = Invoke-RestMethod -Uri "http://127.0.0.1:$WebPort/routing-suite/api/status" -TimeoutSec 5 } catch { $status = $null }
$web = $null
if ($status -and $status.ok) {
  Write-Host "  reusing running web instance on :$WebPort"
} else {
  # dsh 是 node 的 .ps1 包装；Start-Process 直接跑 .ps1 不可靠，直接启动 node bin.js。
  # 注意 bin.js 路径含空格（Program Files），ArgumentList 的值必须手动加引号。
  $dshDir = Split-Path -Parent (Get-Command dsh).Source
  $nodeExe = Join-Path $dshDir 'node.exe'
  $dshCli = Join-Path $dshDir 'node_modules\@deepseek-ai\dsh\lib\bin.js'
  $web = Start-Process -FilePath $nodeExe -ArgumentList @("`"$dshCli`"", '--profile', 'web', '--port', "$WebPort") -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 6
  try { $status = Invoke-RestMethod -Uri "http://127.0.0.1:$WebPort/routing-suite/api/status" -TimeoutSec 8 } catch { $status = $null }
}
if ($status -and $status.ok) {
  Write-Host "  routing-suite active: enabled=$($status.enabled) strategy=$($status.strategy) preset=$($status.preset)"
  if ($status.strategy -ne 'inspect-first') {
    Write-Host '  WARN: strategy is not inspect-first; the web profile patch may not be applied.'
  }
} else {
  Write-Host '  WARN: /routing-suite/api/status unreachable — is the routing-suite bundle loaded? (run install.ps1)'
}

try {
  Start-Process "http://127.0.0.1:$WebPort"
  Write-Host ''
  Write-Host '  >>> In the browser:'
  Write-Host '      1) pick mode 「智能路由模式」 in the mode menu'
  Write-Host "      2) open a new session with cwd = $ProjectDir"
  Write-Host "      3) run EXACTLY the same task as the baseline:"
  Write-Host "         $Task"
  Write-Host "      4) wait for the final reply, then save it to:"
  Write-Host "         $routedFile   (plain text; overwrite ok)"
  Write-Host ''
  Write-Host "  Waiting for $routedFile (up to $WaitForRoutedSec s)..."
  $deadline = (Get-Date).AddSeconds($WaitForRoutedSec)
  while (-not (Test-Path $routedFile) -or (Get-Item $routedFile -ErrorAction SilentlyContinue).Length -eq 0) {
    if ((Get-Date) -gt $deadline) { throw "timeout waiting for $routedFile" }
    Start-Sleep -Seconds 5
  }
  Write-Host "  -> saved $routedFile"
} finally {
  if ($web -and -not $web.HasExited) { Stop-Process -Id $web.Id -Force -ErrorAction SilentlyContinue }
}

# ---------------------------------------------------------------- compare
Write-Host ''
Write-Host '[3/3] Comparison'
$b = Get-Content $baselineFile -Raw
$r = Get-Content $routedFile -Raw
Write-Host "  baseline : $($b.Length) chars"
Write-Host "  routed   : $($r.Length) chars"
Write-Host ''
Write-Host '  ----- baseline (routing OFF) -----'
$b
Write-Host ''
Write-Host '  ----- routed (routing ON, inspect-first) -----'
$r
Write-Host ''
Write-Host '  ----- inspect-first grading checklist (for the routed run) -----'
$checks = @(
  'opened/inspected files before editing',
  'produced a diagnosis / root-cause before proposing changes',
  'referenced existing tests or config before acting',
  'explicit plan or ordering before implementation',
  'fewer blind edits / lower rework indicators'
)
foreach ($c in $checks) { Write-Host "    [ ] $c" }
Write-Host ''
Write-Host 'DONE. Judge the two transcripts above; a reproducible gain means routing'
Write-Host 'is worth keeping as your default mode.'
