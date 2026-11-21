#!/usr/bin/env bash
set -euo pipefail

MODEL_DIR="${MODEL_DIR:-/root/models/wan}"
mkdir -p "$MODEL_DIR"

curl -L --fail --retry 3 -o "$MODEL_DIR/wan2.1_t2v_1.3b-q4_k_m.gguf" \
    "https://huggingface.co/calcuis/wan-1.3b-gguf/resolve/main/wan2.1_t2v_1.3b-q4_k_m.gguf"

curl -L --fail --retry 3 -o "$MODEL_DIR/umt5-xxl-encoder-Q3_K_S.gguf" \
    "https://huggingface.co/city96/umt5-xxl-encoder-gguf/resolve/main/umt5-xxl-encoder-Q3_K_S.gguf"

curl -L --fail --retry 3 -o "$MODEL_DIR/taew2_1.safetensors" \
    "https://github.com/madebyollin/taehv/raw/refs/heads/main/safetensors/taew2_1.safetensors"
