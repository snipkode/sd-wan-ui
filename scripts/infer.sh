#!/usr/bin/env bash
set -euo pipefail

PROMPT="${1:-a lovely cat walking in neon rain, cinematic lighting}"
NEGATIVE="${NEGATIVE:-blurry, low quality, watermark, text}"
FRAMES="${FRAMES:-1}"
STEPS="${STEPS:-10}"
WIDTH="${WIDTH:-512}"
HEIGHT="${HEIGHT:-320}"
CFG="${CFG:-6.0}"
NAME="${NAME:-wan-$(date +%s)}"

MODEL_DIR="${MODEL_DIR:-/root/models/wan}"
OUT_DIR="${OUT_DIR:-/root/out}"
SD_IMAGE="${SD_IMAGE:-sd-cpu:local}"

mkdir -p "$OUT_DIR"

docker run --rm \
    -v "$MODEL_DIR:/models:ro" \
    -v "$OUT_DIR:/output" \
    "$SD_IMAGE" \
    -M vid_gen \
    --diffusion-model /models/wan2.1_t2v_1.3b-q4_k_m.gguf \
    --t5xxl /models/umt5-xxl-encoder-Q3_K_S.gguf \
    --taesd /models/taew2_1.safetensors \
    -p "$PROMPT" \
    -n "$NEGATIVE" \
    --cfg-scale "$CFG" \
    --sampling-method euler \
    --flow-shift 3.0 \
    --steps "$STEPS" \
    -W "$WIDTH" \
    -H "$HEIGHT" \
    --video-frames "$FRAMES" \
    -o "/output/${NAME}" \
    -v
