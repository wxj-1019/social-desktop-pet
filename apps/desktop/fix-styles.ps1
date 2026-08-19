$ErrorActionPreference = 'Stop'
$filePath = Join-Path $PSScriptRoot 'src\styles.css'
$content = [System.IO.File]::ReadAllText($filePath)

# Normalize line endings to LF
$content = $content -replace "`r`n", "`n"

# Step 1: Remove .image-pet__stage block (including its comment)
$patternStage = '(?s)/\* [^*]*stage[^*]*\*/\s*\.image-pet__stage\s*\{[^}]*\}\s*'
if ([regex]::IsMatch($content, $patternStage)) {
  $content = [regex]::Replace($content, $patternStage, '')
  Write-Output 'Removed stage block OK'
} else {
  Write-Output 'WARN: stage block not matched by regex 1, trying alternative'
}

# Alternative stage pattern: just match class selector block
$altStage = '(?s)\.image-pet__stage\s*\{[^}]*\}\s*'
if ([regex]::IsMatch($content, $altStage)) {
  $content = [regex]::Replace($content, $altStage, '')
  Write-Output 'Removed stage block OK (alt)'
}

# Step 2: Remove layer-a/layer-b cross-fade block
$patternLayer = '(?s)/\* [^*]*cross-fade[^*]*\*/\s*\.image-pet__img--layer-a,\s*\.image-pet__img--layer-b\s*\{[^}]*\}\s*'
if ([regex]::IsMatch($content, $patternLayer)) {
  $content = [regex]::Replace($content, $patternLayer, '')
  Write-Output 'Removed layer cross-fade block OK'
} else {
  Write-Output 'WARN: layer block not matched by regex 1'
  # Try simpler approach - find any .image-pet__img--layer and remove transition
}

# Step 3: Update .image-pet__img block - remove old "基础图像样式" one and replace with correct
$imgBasicPattern = '(?s)\.image-pet__img\s*\{\s*object-fit:\s*contain;[^}]*\}'
$replacementImg = @'
.image-pet__img {
  object-fit: contain;
  user-select: none;
  pointer-events: none;
  filter: drop-shadow(0 6px 10px rgba(60, 50, 40, 0.18));
  height: 100%;
  max-width: 100%;
  transform-origin: 50% 100%;
}
'@
if ([regex]::IsMatch($content, $imgBasicPattern)) {
  $content = [regex]::Replace($content, $imgBasicPattern, $replacementImg)
  Write-Output 'Replaced .image-pet__img block OK'
} else {
  Write-Output 'WARN: image-pet__img basic block not matched'
}

# Also remove any leftover "position: absolute; ... transition: opacity 0.18s" from img
# If any --layer styles remained, also drop them
$leftoverLayerPattern = '(?s)\.image-pet__img--layer[^\{]*\{[^}]*\}\s*'
$content = [regex]::Replace($content, $leftoverLayerPattern, '')

# Remove any "transition: opacity 0.18s ease;" anywhere in image-pet img block area
$content = $content -replace 'transition:\s*opacity\s+0\.18s\s*ease;\s*', ''

# Step 4: Replace ALL .image-pet__stage references in selectors with .image-pet__img
$beforeCount = ([regex]::Matches($content, '\.image-pet__stage')).Count
$content = $content -replace '\.image-pet__stage', '.image-pet__img'
$afterCount = ([regex]::Matches($content, '\.image-pet__stage')).Count
Write-Output "Replaced .image-pet__stage -> .image-pet__img ($beforeCount occurrences removed, $afterCount remain)"

# Clean up excessive blank lines (more than 2 in a row)
$content = [regex]::Replace($content, "(`n){3,}", "`n`n")

# Convert back to CRLF and write
$content = $content -replace "`n", "`r`n"
[System.IO.File]::WriteAllText($filePath, $content)
Write-Output 'DONE: styles.css written successfully'
