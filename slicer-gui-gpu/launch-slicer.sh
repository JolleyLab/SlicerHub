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

ensure_required_extensions() {
  local sandbox_marker="/home/slicer/.config/slicer-web-sandbox-installed"
  local heart_marker="/home/slicer/.config/slicer-web-slicerheart-installed"
  local need=()

  local userstats_hint
  userstats_hint="$(find /opt/Slicer/slicer.org /home/slicer -maxdepth 8 -type f -iname 'UserStatistics.py' 2>/dev/null | head -n 1 || true)"
  if [ -n "$userstats_hint" ]; then
    mkdir -p /home/slicer/.config
    touch "$sandbox_marker"
  else
    rm -f "$sandbox_marker"
    need+=(Sandbox)
  fi

  local heart_hint
  heart_hint="$(find /opt/Slicer/slicer.org /home/slicer -maxdepth 10 -type f \( -iname 'ValveAnnulusAnalysis.py' -o -iname 'HeartValves.py' \) 2>/dev/null | head -n 1 || true)"
  if [ -n "$heart_hint" ]; then
    mkdir -p /home/slicer/.config
    touch "$heart_marker"
  else
    rm -f "$heart_marker"
    need+=(SlicerHeart)
  fi

  if [ "${#need[@]}" -eq 0 ]; then
    return 0
  fi

  echo "[launch-slicer] Ensuring extensions: ${need[*]}"
  if DISPLAY="${DISPLAY:-:1}" /opt/Slicer/Slicer \
      --no-splash \
      --no-main-window \
      --exit-after-startup \
      --python-script /usr/local/bin/install-slicer-extensions.py "${need[@]}"; then
    userstats_hint="$(find /opt/Slicer/slicer.org /home/slicer -maxdepth 8 -type f -iname 'UserStatistics.py' 2>/dev/null | head -n 1 || true)"
    if [ -n "$userstats_hint" ]; then
      mkdir -p /home/slicer/.config
      touch "$sandbox_marker"
    elif printf '%s\n' "${need[@]}" | grep -qx Sandbox; then
      echo "[launch-slicer] WARNING: Sandbox install exited 0 but UserStatistics.py not found"
    fi
    heart_hint="$(find /opt/Slicer/slicer.org /home/slicer -maxdepth 10 -type f \( -iname 'ValveAnnulusAnalysis.py' -o -iname 'HeartValves.py' \) 2>/dev/null | head -n 1 || true)"
    if [ -n "$heart_hint" ]; then
      mkdir -p /home/slicer/.config
      touch "$heart_marker"
    elif printf '%s\n' "${need[@]}" | grep -qx SlicerHeart; then
      echo "[launch-slicer] WARNING: SlicerHeart install exited 0 but Heart modules not found"
    fi
  else
    echo "[launch-slicer] WARNING: extension install failed (${need[*]}); some scenes may lack custom layouts"
  fi
}

ensure_required_extensions

ensure_developer_mode() {
  # ScriptedLoadableModuleWidget reads Developer/DeveloperMode at widget init.
  # Set it in Slicer.ini before Slicer starts so SimplifiedViewer picks it up.
  local ini="/home/slicer/.config/slicer.org/Slicer.ini"
  mkdir -p "$(dirname "$ini")"
  if [ -f "$ini" ]; then
    if grep -q '^\[Developer\]' "$ini"; then
      if grep -q '^DeveloperMode=' "$ini"; then
        sed -i 's/^DeveloperMode=.*/DeveloperMode=true/' "$ini"
      else
        sed -i '/^\[Developer\]/a DeveloperMode=true' "$ini"
      fi
    else
      printf '\n[Developer]\nDeveloperMode=true\n' >> "$ini"
    fi
  else
    printf '[Developer]\nDeveloperMode=true\n' > "$ini"
  fi
}

ensure_developer_mode

launch_cmd=(/opt/Slicer/Slicer --no-splash)

SIMPLIFIED_VIEWER_PATH="${SLICER_SIMPLIFIED_VIEWER_PATH:-/opt/slicer-modules/SimplifiedViewer}"
if [ ! -d "$SIMPLIFIED_VIEWER_PATH" ] && [ -d "/home/slicer/data/SimplifiedViewer" ]; then
  SIMPLIFIED_VIEWER_PATH="/home/slicer/data/SimplifiedViewer"
fi
if [ -d "$SIMPLIFIED_VIEWER_PATH" ] && [ -f "${SIMPLIFIED_VIEWER_PATH}/SimplifiedViewer.py" ]; then
  # --additional-module-paths must point at the folder that CONTAINS SimplifiedViewer.py
  # (same pattern as Slicer's qt-scripted-modules directories).
  launch_cmd+=(--additional-module-paths "$SIMPLIFIED_VIEWER_PATH")
else
  echo "[launch-slicer] WARNING: SimplifiedViewer path not found: ${SIMPLIFIED_VIEWER_PATH}"
fi

launch_cmd+=(--python-script /usr/local/bin/slicer_session.py)

nvidia_egl_available() {
  # Need /dev/nvidia* + EGL ICD; nvidia-smi alone is not enough.
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
