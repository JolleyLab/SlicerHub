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

launch_cmd=(/opt/Slicer/Slicer --no-splash --python-script /usr/local/bin/slicer_session.py)
echo "[launch-slicer] Starting Slicer with in-process open poller"

if command -v vglrun &>/dev/null; then
  vglrun -d egl "${launch_cmd[@]}" &
else
  "${launch_cmd[@]}" &
fi

echo "$!" > "$PID_FILE"
echo "[launch-slicer] Slicer pid $(cat "$PID_FILE")"
