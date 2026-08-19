$cssPath = Join-Path $PSScriptRoot 'src\styles.css'
$lines = [System.IO.File]::ReadAllLines($cssPath)
Write-Output "Lines 1640-1760 of styles.css:"
for ($i=1639; $i -lt [Math]::Min(1760, $lines.Count); $i++) {
  Write-Output ("{0,5}: {1}" -f ($i+1), $lines[$i])
}
