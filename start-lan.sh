#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"
exec node ./server.js --host "${HOST:-0.0.0.0}" --port "${PORT:-8787}"
