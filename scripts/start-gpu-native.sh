#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SD_CLI_BIN="${SD_CLI_BIN:-$ROOT/sd-vulkan/sd-cli.exe}"
SD_BACKEND="${SD_BACKEND:-auto}"

if [[ ! -x "$SD_CLI_BIN" && ! -f "$SD_CLI_BIN" ]]; then
    echo "sd-cli tidak ditemukan: $SD_CLI_BIN" >&2
    echo "Unduh build GPU lalu set SD_CLI_BIN, contoh:" >&2
    echo "  gh release download master-1106-532d2c1 --repo leejet/stable-diffusion.cpp \\" >&2
    echo "    --pattern 'sd-master-532d2c1-bin-win-vulkan-x64.zip'" >&2
    echo "  unzip sd-master-532d2c1-bin-win-vulkan-x64.zip -d sd-vulkan" >&2
    exit 1
fi

if [[ -z "${FFMPEG_BIN:-}" ]]; then
    if command -v ffmpeg >/dev/null 2>&1; then
        FFMPEG_BIN="$(command -v ffmpeg)"
    elif [[ -f "$ROOT/tools/ffmpeg/bin/ffmpeg.exe" ]]; then
        FFMPEG_BIN="$ROOT/tools/ffmpeg/bin/ffmpeg.exe"
    else
        echo "ffmpeg tidak ditemukan: job video akan gagal saat konversi AVI ke MP4." >&2
        echo "Set FFMPEG_BIN ke binary ffmpeg, atau taruh di $ROOT/tools/ffmpeg/bin/." >&2
        FFMPEG_BIN="ffmpeg"
    fi
fi

echo "runner=local backend=$SD_BACKEND cli=$SD_CLI_BIN ffmpeg=$FFMPEG_BIN"

SD_RUNNER=local \
SD_CLI_BIN="$SD_CLI_BIN" \
SD_BACKEND="$SD_BACKEND" \
FFMPEG_BIN="$FFMPEG_BIN" \
MODEL_DIR="${MODEL_DIR:-$ROOT/models}" \
OUT_DIR="${OUT_DIR:-$ROOT/out}" \
INPUT_DIR="${INPUT_DIR:-$ROOT/input}" \
INPAINT_MODEL_DIR="${INPAINT_MODEL_DIR:-$ROOT/models/inpaint}" \
STATE_FILE="${STATE_FILE:-$ROOT/runtime/state.json}" \
HOST="${HOST:-0.0.0.0}" \
PORT="${PORT:-3001}" \
exec node "$ROOT/server.js"
