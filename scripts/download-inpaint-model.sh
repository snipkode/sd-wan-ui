#!/usr/bin/env bash
set -euo pipefail

MODEL_DIR="${MODEL_DIR:-/root/models/inpaint}"
MODEL_NAME="${MODEL_NAME:-stable-diffusion-v1-5-inpainting-Q4_0.gguf}"
MODEL_PATH="$MODEL_DIR/$MODEL_NAME"
URL="https://huggingface.co/gpustack/stable-diffusion-v1-5-inpainting-GGUF/resolve/main/$MODEL_NAME"

mkdir -p "$MODEL_DIR"
if [ -s "$MODEL_PATH" ]; then
  echo "model inpaint sudah ada: $MODEL_PATH"
  exit 0
fi

curl -L --fail --retry 3 -C - -o "$MODEL_PATH" "$URL"
echo "model inpaint tersimpan: $MODEL_PATH"
