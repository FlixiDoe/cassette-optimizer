$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot
$env:HOST = "0.0.0.0"
$env:PORT = "8787"
node .\server.js
