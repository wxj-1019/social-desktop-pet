# dsh-routing-suite installer for DeepSeek Harness (web profile)
#
# Usage : pwsh -File install.ps1
# Steps :
#   1) dsh plugin --profile web add dsh-routing-suite
#      (installs the npm package into the web profile so its client
#       runtime / settings page injection takes effect)
#   2) copy preset/routing-suite -> $DSH_HOME/.agent-presets/routing-suite
#      (DSH plugin command does NOT materialize package-declared user
#       presets, so the copy must be done manually)
# Idempotent; safe to re-run.
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dshHome = $env:DSH_HOME
if (-not $dshHome) { $dshHome = Join-Path $env:USERPROFILE '.dsh' }

Write-Host '[1/3] Checking DSH environment...'
$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if (-not $dsh) { throw 'dsh CLI not found. Install DeepSeek Harness first.' }
if (-not (Test-Path (Join-Path $dshHome 'profiles\web'))) {
  throw "web profile missing: $dshHome\profiles\web (boot `dsh --profile web` once first)"
}
Write-Host "  dsh       = $($dsh.Source)"
Write-Host "  DSH_HOME  = $dshHome"

Write-Host '[2/3] Installing dsh-routing-suite into web profile (pnpm add via npm registry)...'
dsh plugin --profile web add dsh-routing-suite
if ($LASTEXITCODE -ne 0) { throw "dsh plugin add failed (exit $LASTEXITCODE)" }

Write-Host '[3/3] Materializing agent preset -> .agent-presets\routing-suite ...'
$src = Join-Path $here 'preset\routing-suite'
$dst = Join-Path $dshHome '.agent-presets\routing-suite'
if (-not (Test-Path (Join-Path $src 'preset.yml'))) {
  throw "source preset missing: $src\preset.yml (run this script from the repo root)"
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
Copy-Item $src $dst -Recurse
if (-not (Test-Path (Join-Path $dst 'preset.yml'))) { throw 'preset copy failed' }

Write-Host ''
Write-Host 'DONE. Next steps:'
Write-Host '  1) Restart DeepSeek Harness (web profile)'
Write-Host '  2) Pick the "Smart routing" mode in the mode menu (order 5)'
Write-Host '  3) Run selftest.ps1 to verify the installation'
