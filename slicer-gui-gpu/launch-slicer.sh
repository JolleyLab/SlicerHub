#!/bin/bash
# Start Slicer once on DISPLAY :1 with an in-process file open poller.
set -u

PID_FILE="/tmp/slicer.pid"
export DISPLAY="${DISPLAY:-:1}"
ADDONS_FILE="${SLICER_ADDONS_FILE:-/usr/local/share/slicer-web/slicer-addons.json}"
export SLICER_ADDONS_FILE="$ADDONS_FILE"

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

read_extensions_list() {
  python3 - <<'PY'
import sys
sys.path.insert(0, "/usr/local/bin")
from slicer_addons import list_extensions
for name in list_extensions():
    print(name)
PY
}

ensure_required_extensions() {
  # Host daily sync mounts shared slicer.org — do not hit Extension Index on seat start.
  if [ "${SLICER_ADDONS_SYNC:-}" = "1" ] || [ "${SLICER_ADDONS_SYNC:-}" = "true" ]; then
    echo "[launch-slicer] Using host-synced addons (skip per-seat extension install)"
    return 0
  fi

  local need=()
  local name
  local marker_dir="/home/slicer/.config"
  mkdir -p "$marker_dir"

  while IFS= read -r name; do
    [ -n "$name" ] || continue
    local marker="${marker_dir}/slicer-web-ext-${name}"
    if [ -f "$marker" ]; then
      continue
    fi
    if find /opt/Slicer/slicer.org /home/slicer/slicer.org /home/slicer/.config/slicer.org \
        -maxdepth 8 -type d -iname "*${name}*" 2>/dev/null | head -n 1 | grep -q .; then
      touch "$marker"
      continue
    fi
    need+=("$name")
  done < <(read_extensions_list)

  if [ "${#need[@]}" -eq 0 ]; then
    return 0
  fi

  echo "[launch-slicer] Ensuring extensions: ${need[*]}"
  if DISPLAY="${DISPLAY:-:1}" /opt/Slicer/Slicer \
      --no-splash \
      --no-main-window \
      --exit-after-startup \
      --python-script /usr/local/bin/install-slicer-extensions.py "${need[@]}"; then
    for name in "${need[@]}"; do
      touch "${marker_dir}/slicer-web-ext-${name}"
    done
  else
    echo "[launch-slicer] WARNING: extension install failed (${need[*]}); some scenes may lack layouts/modules"
  fi
}

ensure_required_extensions

ensure_developer_mode() {
  # ScriptedLoadableModuleWidget reads Developer/DeveloperMode at widget init.
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

while IFS= read -r mod_path; do
  [ -n "$mod_path" ] || continue
  echo "[launch-slicer] additional module path: ${mod_path}"
  launch_cmd+=(--additional-module-paths "$mod_path")
done < <(python3 - <<'PY'
import sys
sys.path.insert(0, "/usr/local/bin")
from slicer_addons import launch_additional_module_paths
for path in launch_additional_module_paths():
    print(path)
PY
)

launch_cmd+=(--python-script /usr/local/bin/slicer_session.py)

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
