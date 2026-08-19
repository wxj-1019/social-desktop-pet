# finish-compare.ps1 — 只做对比 leg [3/3]：等待 compare/routed.txt 出现后打印对比结果。
# 用于 web 实例已由用户/外部启动、只需补齐路由 leg 回复的场景。
#
# Usage: pwsh -File finish-compare.ps1 [-WaitSec 1200]
param(
  [int]$WaitSec = 1200
)
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$baselineFile = Join-Path $scriptDir 'compare\baseline.txt'
$routedFile = Join-Path $scriptDir 'compare\routed.txt'

if (-not (Test-Path $baselineFile)) { throw "baseline missing: $baselineFile (run compare-routing.ps1 first)" }
if (-not (Test-Path $routedFile)) {
  Write-Host "Waiting for $routedFile (up to $WaitSec s)..."
  $deadline = (Get-Date).AddSeconds($WaitSec)
  while (-not (Test-Path $routedFile) -or (Get-Item $routedFile -ErrorAction SilentlyContinue).Length -eq 0) {
    if ((Get-Date) -gt $deadline) { throw "timeout waiting for $routedFile" }
    Start-Sleep -Seconds 10
  }
}

$b = Get-Content $baselineFile -Raw
$r = Get-Content $routedFile -Raw
Write-Host '[3/3] Comparison'
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
@(
  'opened/inspected files before editing',
  'produced a diagnosis / root-cause before proposing changes',
  'referenced existing tests or config before acting',
  'explicit plan or ordering before implementation',
  'fewer blind edits / lower rework indicators'
) | ForEach-Object { Write-Host "    [ ] $_" }
Write-Host ''
Write-Host 'DONE. Judge the two transcripts above.'
