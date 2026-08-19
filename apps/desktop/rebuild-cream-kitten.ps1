$ErrorActionPreference = 'Stop'
$cssPath = Join-Path $PSScriptRoot 'src\styles.css'
$lines = [System.IO.File]::ReadAllLines($cssPath)
Write-Output "Total lines: $($lines.Count)"

# STEP 1: FIND BOUNDARIES
$creamBannerIdx = -1
for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match 'image-pet') { $creamBannerIdx = $i - 1; break } }
Write-Output "Cream kitten banner start: $($creamBannerIdx+1)"

# Find index of @keyframes ck-breathe (the first keyframe in cream-kitten section)
$ckBreatheIdx = -1
for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '@keyframes\s+ck-breathe') { $ckBreatheIdx = $i; break } }
Write-Output "@keyframes ck-breathe at line: $($ckBreatheIdx+1)"

# Find index of closing brace of @keyframes ck-waking
$ckWakingEndIdx = -1
$inWaking = $false
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '@keyframes\s+ck-waking') { $inWaking = $true }
  if ($inWaking -and $lines[$i].Trim() -eq '}') { $ckWakingEndIdx = $i; break }
}
Write-Output "End of ck-waking (last keyframe): line $($ckWakingEndIdx+1)"

if ($creamBannerIdx -lt 0 -or $ckBreatheIdx -lt 0 -or $ckWakingEndIdx -lt 0) {
  Write-Output "ERROR: markers not found"
  exit 1
}

# STEP 2: EXISTING KEYFRAMES (lines from ckBreatheIdx to ckWakingEndIdx inclusive) -> keep these verbatim
$keyframesBlock = @()
for ($i = $ckBreatheIdx; $i -le $ckWakingEndIdx; $i++) { $keyframesBlock += $lines[$i] }
Write-Output "Keyframes block captured: $($keyframesBlock.Count) lines (ck-breathe ... ck-waking)"

# STEP 3: BUILD NEW HEADER SECTION (containers + selectors, no keyframes)
# Use arrays of lines to avoid encoding issues
$sectionHeader = @(
  '/* ============================================================',
  '   Cream Kitten (cream-kitten) image-pet skin',
  '   ============================================================ */',
  '',
  '/* outer container: fills .pet-stage, horizontally centered + bottom-anchored */',
  '.image-pet {',
  '  position: relative;',
  '  width: 100%;',
  '  height: 100%;',
  '  display: flex;',
  '  align-items: flex-end;',
  '  justify-content: center;',
  '  background-color: transparent;',
  '  --amp-bounce-y: -8px;',
  '  --amp-bounce-happy: -12px;',
  '  --amp-walk-y: -3px;',
  '}',
  '',
  '/* horizontal flip container: scaleX(-1) when facing=left */',
  '.image-pet__flip {',
  '  width: 100%;',
  '  height: 100%;',
  '  display: flex;',
  '  align-items: flex-end;',
  '  justify-content: center;',
  '}',
  '',
  '.image-pet[data-facing=''left''] .image-pet__flip {',
  '  transform: scaleX(-1);',
  '}',
  '',
  '/* image styles: animations applied directly on img; transform-origin at bottom-center */',
  '.image-pet__img {',
  '  object-fit: contain;',
  '  user-select: none;',
  '  pointer-events: none;',
  '  filter: drop-shadow(0 6px 10px rgba(60, 50, 40, 0.18));',
  '  height: 100%;',
  '  max-width: 100%;',
  '  transform-origin: 50% 100%;',
  '}',
  '',
  '/* ---- motion animations (target .image-pet__img directly) ---- */',
  '',
  '.image-pet[data-motion=''idle''] .image-pet__img {',
  '  animation: ck-breathe 3.2s ease-in-out infinite;',
  '}',
  '',
  '.image-pet[data-motion=''happy''] .image-pet__img,',
  '.image-pet[data-animation=''expression:happy''] .image-pet__img {',
  '  animation: ck-bounce 0.7s ease-in-out infinite;',
  '}',
  '',
  '.image-pet[data-motion=''sad''] .image-pet__img,',
  '.image-pet[data-animation=''expression:sad''] .image-pet__img {',
  '  animation: ck-sad 2.4s ease-in-out infinite;',
  '}',
  '',
  '.image-pet[data-motion=''sleep''] .image-pet__img {',
  '  animation: ck-sleep 5.5s ease-in-out infinite;',
  '}',
  '',
  '.image-pet[data-motion=''surprised''] .image-pet__img,',
  '.image-pet[data-animation=''expression:surprised''] .image-pet__img {',
  '  animation: ck-surprised 1.1s ease-in-out infinite;',
  '}',
  '',
  '.image-pet[data-motion=''touch''] .image-pet__img {',
  '  animation: ck-touch 1.3s ease-in-out infinite;',
  '}',
  '',
  '.image-pet[data-motion=''walk''] .image-pet__img {',
  '  animation: ck-run 0.7s ease-in-out infinite;',
  '}',
  '',
  '.image-pet[data-motion=''talk''] .image-pet__img,',
  '.image-pet[data-speaking=''true''] .image-pet__img {',
  '  animation: ck-talk 0.45s ease-in-out infinite;',
  '}',
  '',
  '.image-pet[data-motion=''dragged''] .image-pet__img {',
  '  animation: none;',
  '}',
  '',
  '.image-pet[data-animation=''expression:shy''] .image-pet__img {',
  '  animation: ck-bounce 0.7s ease-in-out infinite;',
  '}',
  '',
  '.image-pet[data-waking=''true''] .image-pet__img {',
  '  animation: ck-waking 1.2s ease-in-out 1;',
  '}',
  '',
  '/* ---- Cream Kitten keyframes ---- */',
  ''
)

# STEP 4: ASSEMBLE RESULT
$result = New-Object System.Collections.Generic.List[string]
# Prefix: everything before the cream-kitten banner
for ($i = 0; $i -lt $creamBannerIdx; $i++) { $result.Add($lines[$i]) }
# New header section
foreach ($l in $sectionHeader) { $result.Add($l) }
# Existing keyframes
foreach ($l in $keyframesBlock) { $result.Add($l) }
# Suffix: everything after the last keyframe
for ($i = $ckWakingEndIdx + 1; $i -lt $lines.Count; $i++) { $result.Add($lines[$i]) }

# Write back
$content = $result -join "`r`n"
[System.IO.File]::WriteAllText($cssPath, $content + "`r`n")
Write-Output "SUCCESS. Replaced lines $($creamBannerIdx+1)..$($ckWakingEndIdx+1) with new section header + existing keyframes. Final line count: $($result.Count)."
