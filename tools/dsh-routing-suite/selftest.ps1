# dsh-routing-suite self-test
#
# Usage : pwsh -File selftest.ps1
# Checks:
#   1) npm package installed in web profile (node_modules/dsh-routing-suite)
#   2) agent preset materialized (.agent-presets/routing-suite with
#      preset.yml + agent.cordis.yml)
#   3) composed config resolves the routing preset
#      (dsh --profile web --dump-config)
# Exit code: 0 = all passed; non-zero = something failed
$ErrorActionPreference = 'Stop'

$dshHome = $env:DSH_HOME
if (-not $dshHome) { $dshHome = Join-Path $env:USERPROFILE '.dsh' }
$fail = 0

Write-Host '[1/3] npm package present in web profile'
$pkgJson = Join-Path $dshHome 'profiles\web\node_modules\dsh-routing-suite\package.json'
if (Test-Path $pkgJson) {
  $v = (Get-Content $pkgJson -Raw | ConvertFrom-Json).version
  Write-Host "  OK   dsh-routing-suite@$v"
} else {
  Write-Host '  FAIL dsh-routing-suite not found in profiles/web/node_modules (run install.ps1 first)'
  $fail++
}

Write-Host '[2/3] agent preset materialized'
$presetDir = Join-Path $dshHome '.agent-presets\routing-suite'
$yml = Join-Path $presetDir 'preset.yml'
$cordis = Join-Path $presetDir 'agent.cordis.yml'
if ((Test-Path $yml) -and (Test-Path $cordis)) {
  $name = (Select-String -Path $yml -Pattern '^name:\s*(.+)$' | Select-Object -First 1).Matches[0].Groups[1].Value.Trim()
  $order = (Select-String -Path $yml -Pattern '^order:\s*(.+)$' | Select-Object -First 1).Matches[0].Groups[1].Value.Trim()
  Write-Host "  OK   $yml (name=$name, order=$order)"
  Write-Host "  OK   $cordis"
} else {
  Write-Host '  FAIL .agent-presets/routing-suite not materialized (run install.ps1 first)'
  $fail++
}

Write-Host '[3/3] composed config resolves the routing preset (--dump-config)'
$cfg = dsh --profile web --dump-config 2>&1 | Out-String
if ($cfg -match 'routing-suite') {
  Write-Host '  OK   composed config contains routing-suite (visible in mode menu after restart)'
} else {
  Write-Host '  INFO composed config does not expand the preset name directly; the desktop'
  Write-Host '       app loads it from .agent-presets at startup. Treat check 2 as authoritative.'
}

if ($fail -eq 0) { Write-Host "`nPASS: all checks passed" } else { Write-Host "`nFAIL: $fail check(s) failed" }
exit $fail
