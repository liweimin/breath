$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$inputPath = Join-Path $root "assets\\audio\\exhale-light-short.mp3"
$outputPath = Join-Path $root "audio-data.js"

if (-not (Test-Path $inputPath)) {
  throw "Missing input audio: $inputPath"
}

$bytes = [IO.File]::ReadAllBytes($inputPath)
$b64 = [Convert]::ToBase64String($bytes)
$content = "window.EXHALE_EMBEDDED_DATA_URL = 'data:audio/ogg;base64,$b64';"

Set-Content -Path $outputPath -Value $content -Encoding ascii
Write-Host "Wrote $outputPath"
