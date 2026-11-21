#!/usr/bin/env bash
set -euo pipefail

case "${1:-ui}" in
  ui)
    shift
    exec node /app/server.js "$@"
    ;;
  sd|sd-cli)
    shift
    exec /sd.cpp/bin/sd-cli "$@"
    ;;
  *)
    exec "$@"
    ;;
esac
