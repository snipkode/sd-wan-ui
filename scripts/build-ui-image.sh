#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker build -t "${SD_UI_IMAGE:-sd-wan-ui:local}" -f "$ROOT/Dockerfile.ui" "$ROOT"
