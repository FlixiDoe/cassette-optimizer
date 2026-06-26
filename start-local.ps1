$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot
$port = if ($env:PORT) { $env:PORT } else { "8787" }
node .\server.js --host 127.0.0.1 --port $port
