#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker build -t "${SD_ALL_IMAGE:-sd-wan:local}" -f "$ROOT/Dockerfile.bundle" "$ROOT"
