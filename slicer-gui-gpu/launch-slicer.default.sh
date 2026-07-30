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

nvidia_egl_available() {
  ls /dev/nvidia* >/dev/null 2>&1 || return 1
  if ls /usr/lib/x86_64-linux-gnu/libEGL_nvidia* >/dev/null 2>&1; then
    return 0
  fi
  ls /usr/share/glvnd/egl_vendor.d/*nvidia* >/dev/null 2>&1
}

if command -v vglrun &>/dev/null && nvidia_egl_available; then
  vglrun -d egl "${launch_cmd[@]}" &
else
  echo "[launch-slicer] No NVIDIA EGL — using software OpenGL (llvmpipe)"
  "${launch_cmd[@]}" &
fi

echo "$!" > "$PID_FILE"
