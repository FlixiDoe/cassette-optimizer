$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot
Set-Location -LiteralPath (Join-Path $PSScriptRoot "..")
$port = if ($env:PORT) { $env:PORT } else { "8787" }
node .\server\server.js --host 127.0.0.1 --port $port
