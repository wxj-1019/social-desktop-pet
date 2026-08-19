$cssPath = Join-Path $PSScriptRoot 'src\styles.css'
$lines = [System.IO.File]::ReadAllLines($cssPath)
Write-Output "Total lines: $($lines.Count)"
Write-Output "Last 20 lines:"
for ($i=[Math]::Max(0, $lines.Count-21); $i -lt $lines.Count; $i++) {
  Write-Output ("{0,5}: {1}" -f ($i+1), $lines[$i])
}
Write-Output ""
Write-Output "Lines around 1880-1889:"
for ($i=1879; $i -lt [Math]::Min(1889, $lines.Count); $i++) {
  Write-Output ("{0,5}: {1}" -f ($i+1), $lines[$i])
}
