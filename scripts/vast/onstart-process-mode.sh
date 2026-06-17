#!/usr/bin/env bash
# Vast on-start: process-mode trame-service + optional nginx.
set -euo pipefail

WORKSPACE_ROOT="${WORKSPACE_ROOT:-/workspace/slicer-web}"
TRAME_SERVICE_DIR="${TRAME_SERVICE_DIR:-${WORKSPACE_ROOT}/trame-service}"
TRAME_IMAGE="${TRAME_IMAGE:-slicer-web-trame:local}"
USE_NGINX="${USE_NGINX:-1}"

export TRAME_SESSION_RUNTIME=process
export WORKSPACE_ROOT
export TRAME_VIEWER_BIN="${TRAME_VIEWER_BIN:-python3}"
export TRAME_VIEWER_SCRIPT="${TRAME_VIEWER_SCRIPT:-/app/viewer.py}"
export PYTHONPATH="${PYTHONPATH:-/app}"
export USE_GPU="${USE_GPU:-true}"
export VTK_DEFAULT_OPENGL_WINDOW="${VTK_DEFAULT_OPENGL_WINDOW:-vtkEGLRenderWindow}"
export VTK_USE_X="${VTK_USE_X:-0}"

log() { echo "[vast-onstart] $*"; }

if [[ ! -d "$TRAME_SERVICE_DIR" ]]; then
  log "ERROR: trame-service not found at $TRAME_SERVICE_DIR"
  exit 1
fi

if [[ ! -f /app/viewer.py ]]; then
  log "ERROR: /app/viewer.py missing (use Dockerfile.vast-gpu image)."
  exit 1
fi

log "Installing trame-service Python deps..."
python3 -m pip install -q -r "$TRAME_SERVICE_DIR/requirements.txt"

log "Starting trame-service (process runtime) on :8090..."
cd "$TRAME_SERVICE_DIR"
nohup python3 -m uvicorn server:app --host 0.0.0.0 --port 8090 \
  > /var/log/trame-service.log 2>&1 &
echo $! > /var/run/trame-service.pid

if [[ "$USE_NGINX" == "1" ]]; then
  if command -v nginx >/dev/null 2>&1; then
    log "Starting nginx for /trame-session-port/ routes on :80..."
    NGINX_CONF="${NGINX_CONF:-${WORKSPACE_ROOT}/scripts/vast/nginx-gpu-node.conf}"
    if [[ -f "$NGINX_CONF" ]]; then
      nginx -c "$NGINX_CONF" 2>/dev/null || nginx
    else
      log "WARN: $NGINX_CONF not found; expose viewer ports 9000-9009 manually"
    fi
  else
    log "WARN: nginx not installed; set TRAME_VIEWER_PUBLIC_BASE_URL to a host that proxies viewer ports"
  fi
fi

log "Waiting for health..."
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:8090/health" | grep -q '"runtime":"process"'; then
    curl -s "http://127.0.0.1:8090/health"
    log "Ready."
    TRAME_PID="$(cat /var/run/trame-service.pid)"
    log "Keeping container alive (trame-service pid $TRAME_PID)..."
    wait "$TRAME_PID"
    log "trame-service exited."
    exit 1
  fi
  sleep 2
done

log "ERROR: trame-service did not become healthy; see /var/log/trame-service.log"
tail -50 /var/log/trame-service.log || true
exit 1
