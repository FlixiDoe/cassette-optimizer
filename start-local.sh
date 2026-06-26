#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"
exec node ./server.js --host 127.0.0.1 --port "${PORT:-8787}"
