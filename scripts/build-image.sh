#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker build -t "${SD_IMAGE:-sd-cpu:local}" -f "$ROOT/Dockerfile" "$ROOT"
