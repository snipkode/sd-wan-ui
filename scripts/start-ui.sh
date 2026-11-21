#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

set -a
if [[ -f "$ROOT/.env" ]]; then
    . "$ROOT/.env"
fi
set +a

cd "$ROOT"
exec node server.js
