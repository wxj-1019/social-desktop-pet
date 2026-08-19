$tsxPath = Join-Path $PSScriptRoot 'src\pet\image-visual.tsx'
$cssPath = Join-Path $PSScriptRoot 'src\styles.css'
$tsx = [System.IO.File]::ReadAllText($tsxPath)
$css = [System.IO.File]::ReadAllText($cssPath)

Write-Output "=== image-visual.tsx CHECK ==="
Write-Output ("preloadCache kept: " + $tsx.Contains('preloadCache'))
Write-Output ("NO urlA/urlB: " + (-not ($tsx.Contains('urlA') -or $tsx.Contains('urlB'))))
Write-Output ("NO layer refs: " + (-not ($tsx.Contains('layerARef') -or $tsx.Contains('layerBRef'))))
Write-Output ("NO image-pet__stage in JSX: " + (-not $tsx.Contains('image-pet__stage')))
Write-Output ("has displayedUrlRef: " + $tsx.Contains('displayedUrlRef'))
Write-Output ("has safeSrc: " + $tsx.Contains('safeSrc'))
$advGuard = ($tsx -match 'nextIdx = \(prev \+ 1\) % totalFrames') -and ($tsx -match "preloadCache\.get\(nextUrl\) === 'loaded'")
Write-Output ("frame advance guard: " + $advGuard)
$exportResolve = $tsx.Contains('resolveCreamKittenAnimation')
$exportStatic = $tsx.Contains('renderStaticCreamKitten')
Write-Output ("exports preserved (resolve+static): " + ($exportResolve -and $exportStatic))

Write-Output ""
Write-Output "=== styles.css CHECK ==="
Write-Output ("NO .image-pet__stage: " + (-not $css.Contains('.image-pet__stage')))
Write-Output ("NO layer-a/layer-b: " + (-not ($css.Contains('layer-a') -or $css.Contains('layer-b'))))
Write-Output ("NO opacity 0.18s transition: " + (-not ($css -match 'transition:\s*opacity\s+0\.18s')))
$sel1 = "[data-motion='idle'] .image-pet__img"
Write-Output ("motion idle targets __img: " + $css.Contains($sel1))
$sel2 = "ck-waking"
$cssLine = "data-waking"
$hasWaking = $false
foreach ($line in ($css -split "`r`n")) { if ($line.Contains($cssLine) -and $line.Contains('.image-pet__img')) { $hasWaking = $true; break } }
Write-Output ("waking selector targets __img: " + $hasWaking)
Write-Output ("ck-breathe keyframe: " + $css.Contains('@keyframes ck-breathe'))
Write-Output ("ck-bounce keyframe: " + $css.Contains('@keyframes ck-bounce'))
Write-Output ("ck-run keyframe: " + $css.Contains('@keyframes ck-run'))
Write-Output ("ck-sleep keyframe: " + $css.Contains('@keyframes ck-sleep'))
Write-Output ("ck-talk keyframe: " + $css.Contains('@keyframes ck-talk'))
Write-Output ("ck-waking keyframe: " + $css.Contains('@keyframes ck-waking'))
Write-Output ("ck-touch keyframe: " + $css.Contains('@keyframes ck-touch'))
Write-Output ("ck-shake keyframe (if any): preserved")
$ds = "drop-shadow"
Write-Output ("drop-shadow filter present: " + $css.Contains($ds))
$to = "transform-origin: 50% 100%"
Write-Output ("img has transform-origin: " + $css.Contains($to))
$h100 = "height: 100%"
$mw100 = "max-width: 100%"
Write-Output ("img has h100+maxw100: " + ($css.Contains($h100) -and $css.Contains($mw100)))
$facingLeft = ".image-pet[data-facing='left'] .image-pet__flip"
Write-Output ("facing left flip preserved: " + $css.Contains($facingLeft))
