#!/usr/bin/env bash
# Daily / on-demand host sync for Slicer addons (no new image push).
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd .. && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
exec python3 "$PWD/sync-slicer-addons.py" "$@"
