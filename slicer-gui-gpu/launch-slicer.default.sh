#!/bin/bash
# Default / upstream-shaped launcher (no My Projects open-request poller).
# The adapter image replaces this with launch-slicer.sh + slicer_session.py.
set -u

PID_FILE="/tmp/slicer.pid"
export DISPLAY="${DISPLAY:-:1}"

if [ -f "$PID_FILE" ]; then
  old_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
    kill "$old_pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

launch_cmd=(/opt/Slicer/Slicer --no-splash)
echo "[launch-slicer] Starting Slicer (base image default launcher)"

export VGL_SPOILLAST="${VGL_SPOILLAST:-0}"
export VGL_SPOIL="${VGL_SPOIL:-0}"

if command -v vglrun &>/dev/null; then
  vglrun -d egl "${launch_cmd[@]}" &
else
  "${launch_cmd[@]}" &
fi

echo "$!" > "$PID_FILE"
echo "[launch-slicer] Slicer pid $(cat "$PID_FILE")"
