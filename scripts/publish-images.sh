#!/usr/bin/env bash
set -euo pipefail

USER_NAME="${DOCKERHUB_USER:-snipkode}"
VERSION="${VERSION:-latest}"
SOURCE_UI="${SOURCE_UI:-sd-wan-ui:local}"
SOURCE_INFER="${SOURCE_INFER:-sd-cpu:local}"
UI_IMAGE="${PUBLISH_UI_IMAGE:-$USER_NAME/sd-wan-ui:$VERSION}"
INFER_IMAGE="${PUBLISH_INFER_IMAGE:-$USER_NAME/sd-wan-infer:$VERSION}"

docker tag "$SOURCE_INFER" "$INFER_IMAGE"
docker tag "$SOURCE_UI" "$UI_IMAGE"
docker push "$INFER_IMAGE"
docker push "$UI_IMAGE"
