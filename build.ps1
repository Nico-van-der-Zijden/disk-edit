# Build script: create a single self-contained index.html
# Inlines all JS, CSS, and fonts as base64 data URIs
# Usage: powershell -ExecutionPolicy Bypass -File build.ps1

$srcDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$srcFile = Join-Path $srcDir "index.html"
$distDir = Join-Path $srcDir "dist"
$outFile = Join-Path $distDir "index.html"

if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }

# Helper: convert file to base64 data URI
function FileToDataUri($path, $mime) {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $b64 = [Convert]::ToBase64String($bytes)
    return "data:$mime;base64,$b64"
}

$html = Get-Content $srcFile -Raw -Encoding UTF8

# 1. Inline FontAwesome CSS with embedded font files
$faCssPath = Join-Path $srcDir "assets/fontawesome/all.min.css"
if (Test-Path $faCssPath) {
    $faCss = Get-Content $faCssPath -Raw -Encoding UTF8

    # Replace font URLs with base64 data URIs
    $faCss = [regex]::Replace($faCss, 'url\(\.\./webfonts/([^)]+)\)', {
        param($m)
        $fontFile = Join-Path $srcDir "assets/webfonts/$($m.Groups[1].Value)"
        if (Test-Path $fontFile) {
            $ext = [System.IO.Path]::GetExtension($fontFile).ToLower()
            $mime = if ($ext -eq '.woff2') { 'font/woff2' } else { 'font/ttf' }
            $uri = FileToDataUri $fontFile $mime
            return "url($uri)"
        }
        return $m.Value
    })

    # Replace <link> tag with inline <style>
    $html = $html -replace '<link rel="stylesheet" href="assets/fontawesome/all\.min\.css">', "<style>`n$faCss`n</style>"
    Write-Host "  Inlined FontAwesome CSS + fonts" -ForegroundColor DarkGray
}

# 2. Inline C64 Pro Mono font (woff2 and ttf) in the existing @font-face
$html = [regex]::Replace($html, "url\('assets/webfonts/([^']+)'\)", {
    param($m)
    $fontFile = Join-Path $srcDir "assets/webfonts/$($m.Groups[1].Value)"
    if (Test-Path $fontFile) {
        $ext = [System.IO.Path]::GetExtension($fontFile).ToLower()
        $mime = if ($ext -eq '.woff2') { 'font/woff2' } else { 'font/ttf' }
        $uri = FileToDataUri $fontFile $mime
        return "url('$uri')"
    }
    return $m.Value
})
Write-Host "  Inlined C64 Pro Mono fonts" -ForegroundColor DarkGray

# 3. Inline JS files (skip matomo.js for dist builds)
$html = [regex]::Replace($html, '(?:<!-- Matomo[^>]*-->\s*)?<script src="([^"]+)"></script>', {
    param($match)
    $jsFile = $match.Groups[1].Value
    if ($jsFile -match 'matomo') {
        Write-Host "  Skipped $jsFile (analytics)" -ForegroundColor DarkYellow
        return "<!-- Matomo excluded from dist build -->"
    }
    $jsPath = Join-Path $srcDir $jsFile
    if (Test-Path $jsPath) {
        $js = Get-Content $jsPath -Raw -Encoding UTF8
        Write-Host "  Inlined $jsFile" -ForegroundColor DarkGray
        return "<script>`n$js`n</script>"
    } else {
        Write-Warning "File not found: $jsPath"
        return $match.Value
    }
})

# Write output
[System.IO.File]::WriteAllText($outFile, $html, [System.Text.UTF8Encoding]::new($false))

$size = (Get-Item $outFile).Length
$sizeKB = [math]::Round($size / 1024)
$sizeMB = [math]::Round($size / 1048576, 1)
Write-Host "Built dist/index.html ($sizeKB KB / $sizeMB MB) - single file, no dependencies" -ForegroundColor Green
