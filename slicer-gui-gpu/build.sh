#!/usr/bin/env bash
# Build base (heavy) then adapter (thin). Skip base rebuild when using a Hub tag.
set -euo pipefail
cd "$(dirname "$0")"

BASE_IMAGE="${SLICER_GUI_BASE_IMAGE:-slicer-web-slicer-gui-base:local}"
RUNTIME_IMAGE="${SLICER_GUI_IMAGE:-slicer-web-slicer-gui:local}"
BUILD_BASE="${SLICER_GUI_BUILD_BASE:-auto}"

should_build_base() {
  case "$BUILD_BASE" in
    1|true|yes) return 0 ;;
    0|false|no) return 1 ;;
  esac
  # auto: build local-looking tags; skip when BASE looks like a registry path
  if [[ "$BASE_IMAGE" == */* ]] || [[ "$BASE_IMAGE" == *.*/* ]]; then
    return 1
  fi
  return 0
}

if should_build_base; then
  echo "Building base image: $BASE_IMAGE"
  docker build -f Dockerfile.base -t "$BASE_IMAGE" .
else
  echo "Skipping base build; using published/prebuilt: $BASE_IMAGE"
  docker pull "$BASE_IMAGE" || true
fi

echo "Building adapter image: $RUNTIME_IMAGE (FROM $BASE_IMAGE)"
docker build -f Dockerfile \
  --build-arg "SLICER_GUI_BASE_IMAGE=$BASE_IMAGE" \
  --build-arg "SLICER_HEART_VIEWER_REPO=${SLICER_HEART_VIEWER_REPO:-}" \
  --build-arg "SLICER_HEART_VIEWER_REF=${SLICER_HEART_VIEWER_REF:-}" \
  --build-arg "SLICER_EXTENSIONS=${SLICER_EXTENSIONS:-}" \
  -t "$RUNTIME_IMAGE" .

echo "Done. Runtime image: $RUNTIME_IMAGE"
