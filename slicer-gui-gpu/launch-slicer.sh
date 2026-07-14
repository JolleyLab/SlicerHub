#!/bin/bash
# Start Slicer once on DISPLAY :1 with an in-process file open poller.
set -u

PID_FILE="/tmp/slicer.pid"
export DISPLAY="${DISPLAY:-:1}"

stop_running_slicer() {
  if [ ! -f "$PID_FILE" ]; then
    return 0
  fi
  local old_pid
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
    echo "[launch-slicer] Stopping Slicer pid ${old_pid}"
    kill "$old_pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$old_pid" 2>/dev/null || break
      sleep 0.25
    done
    kill -9 "$old_pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
}

stop_running_slicer

# Drop stale ready marker so the backend cannot reuse a previous session's claim.
rm -f /home/slicer/data/.slicer-ready 2>/dev/null || true

ensure_sandbox_extension() {
  # SimplifiedViewer depends on UserStatistics from Sandbox.
  # Extensions install under /opt/Slicer/slicer.org (shared) and require a restart to load.
  local marker="/home/slicer/.config/slicer-web-sandbox-installed"
  local userstats_hint
  userstats_hint="$(find /opt/Slicer/slicer.org /home/slicer -maxdepth 8 -type f -iname 'UserStatistics.py' 2>/dev/null | head -n 1 || true)"

  if [ -n "$userstats_hint" ]; then
    mkdir -p /home/slicer/.config
    touch "$marker"
    echo "[launch-slicer] Sandbox/UserStatistics present at ${userstats_hint}"
    return 0
  fi

  # Old marker may have been written after a false-positive install success.
  rm -f "$marker"

  echo "[launch-slicer] Ensuring Sandbox extension is installed..."
  if DISPLAY="${DISPLAY:-:1}" /opt/Slicer/Slicer \
      --no-splash \
      --no-main-window \
      --exit-after-startup \
      --python-script /usr/local/bin/install-slicer-extensions.py Sandbox; then
    userstats_hint="$(find /opt/Slicer/slicer.org /home/slicer -maxdepth 8 -type f -iname 'UserStatistics.py' 2>/dev/null | head -n 1 || true)"
    if [ -n "$userstats_hint" ]; then
      mkdir -p /home/slicer/.config
      touch "$marker"
      echo "[launch-slicer] Sandbox installed (${userstats_hint})"
    else
      echo "[launch-slicer] WARNING: Sandbox install exited 0 but UserStatistics.py not found"
    fi
  else
    echo "[launch-slicer] WARNING: Sandbox install failed; SimplifiedViewer may not register"
  fi
}

ensure_sandbox_extension

launch_cmd=(/opt/Slicer/Slicer --no-splash)

SIMPLIFIED_VIEWER_PATH="${SLICER_SIMPLIFIED_VIEWER_PATH:-/opt/slicer-modules/SimplifiedViewer}"
if [ ! -d "$SIMPLIFIED_VIEWER_PATH" ] && [ -d "/home/slicer/data/SimplifiedViewer" ]; then
  SIMPLIFIED_VIEWER_PATH="/home/slicer/data/SimplifiedViewer"
fi
if [ -d "$SIMPLIFIED_VIEWER_PATH" ] && [ -f "${SIMPLIFIED_VIEWER_PATH}/SimplifiedViewer.py" ]; then
  # --additional-module-paths must point at the folder that CONTAINS SimplifiedViewer.py
  # (same pattern as Slicer's qt-scripted-modules directories).
  echo "[launch-slicer] Loading scripted modules from ${SIMPLIFIED_VIEWER_PATH}"
  launch_cmd+=(--additional-module-paths "$SIMPLIFIED_VIEWER_PATH")
else
  echo "[launch-slicer] SimplifiedViewer path not found: ${SIMPLIFIED_VIEWER_PATH}"
fi

launch_cmd+=(--python-script /usr/local/bin/slicer_session.py)
echo "[launch-slicer] Starting Slicer with in-process open poller"

if command -v vglrun &>/dev/null; then
  vglrun -d egl "${launch_cmd[@]}" &
else
  "${launch_cmd[@]}" &
fi

echo "$!" > "$PID_FILE"
echo "[launch-slicer] Slicer pid $(cat "$PID_FILE")"
