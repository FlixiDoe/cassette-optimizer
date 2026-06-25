$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot
python -m http.server 8787 --bind 127.0.0.1
