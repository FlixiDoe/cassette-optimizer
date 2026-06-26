$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot
$hostName = if ($env:HOST) { $env:HOST } else { "0.0.0.0" }
$port = if ($env:PORT) { $env:PORT } else { "8787" }
node .\server.js --host $hostName --port $port
