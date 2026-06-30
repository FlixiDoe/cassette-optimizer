param(
  [string]$Version = "dev",
  [string]$OutputDir = "dist"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$outputRoot = Join-Path $repoRoot $OutputDir
$workRoot = Join-Path $outputRoot "windows-portable-build"
$packageName = "CassetteOptimizer-$Version-windows-x64-portable"
$packageRoot = Join-Path $workRoot $packageName
$exePath = Join-Path $packageRoot "Cassette Optimizer.exe"
$seaConfig = Join-Path $workRoot "sea-config.json"
$seaBlob = Join-Path $workRoot "cassette-optimizer.blob"
$launcher = Join-Path $repoRoot "scripts/windows-portable-launcher.cjs"
$nodeExe = (Get-Command node).Source

if (-not (Test-Path $launcher)) {
  throw "Missing launcher source: $launcher"
}

if (Test-Path $workRoot) {
  Remove-Item -LiteralPath $workRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $packageRoot | Out-Null

$itemsToCopy = @(
  "api",
  "callback",
  "docs",
  "src",
  "styles",
  "index.html",
  "README.md",
  "LICENSE"
)

foreach ($item in $itemsToCopy) {
  $source = Join-Path $repoRoot $item
  $destination = Join-Path $packageRoot $item
  if (Test-Path $source -PathType Container) {
    Copy-Item -LiteralPath $source -Destination $destination -Recurse
  } else {
    Copy-Item -LiteralPath $source -Destination $destination
  }
}

$readme = @"
# Cassette Optimizer $Version for Windows

1. Double-click `Cassette Optimizer.exe`.
2. Your browser opens `http://127.0.0.1:8787/`.
3. Keep the launcher window open while using the app.
4. Close the launcher window to stop the local app.

No Node.js or npm setup is required for this portable build.
"@
Set-Content -LiteralPath (Join-Path $packageRoot "README-WINDOWS.txt") -Value $readme -Encoding UTF8

$config = @{
  main = $launcher
  output = $seaBlob
  disableExperimentalSEAWarning = $true
} | ConvertTo-Json
Set-Content -LiteralPath $seaConfig -Value $config -Encoding UTF8

node --experimental-sea-config $seaConfig
Copy-Item -LiteralPath $nodeExe -Destination $exePath
npx --yes postject $exePath NODE_SEA_BLOB $seaBlob `
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

$zipPath = Join-Path $outputRoot "$packageName.zip"
if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal

Write-Output $zipPath
