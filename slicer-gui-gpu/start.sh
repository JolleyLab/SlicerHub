#!/bin/bash
set -e

# TurboVNC needs -dridir (Mesa swrast) for GLX.
CLOUDFLARE_PID=""
VNC_EXTRA_ARGS=()
NOVNC_PARAMS="autoconnect=true&scale=true&quality=9"
VNC_BIN="${VNC_BIN:-/opt/TurboVNC/bin/Xvnc}"

setup_vnc_auth() {
  if [ "${VNC_ALLOW_NO_PASSWORD:-true}" = "false" ] || [ "${VNC_ALLOW_NO_PASSWORD:-true}" = "0" ]; then
    if [ -z "${VNC_PASSWORD:-}" ]; then
      echo "ERROR: VNC_ALLOW_NO_PASSWORD=false but VNC_PASSWORD is not set."
      exit 1
    fi
    mkdir -p /home/slicer/.vnc
    if command -v /opt/TurboVNC/bin/vncpasswd >/dev/null 2>&1; then
      printf '%s\n' "${VNC_PASSWORD}" | /opt/TurboVNC/bin/vncpasswd -f > /home/slicer/.vnc/passwd
    else
      printf '%s\n' "${VNC_PASSWORD}" | vncpasswd -f > /home/slicer/.vnc/passwd
    fi
    chmod 600 /home/slicer/.vnc/passwd
    VNC_EXTRA_ARGS=(-rfbauth /home/slicer/.vnc/passwd)
    local encoded_password
    encoded_password="$(printf '%s' "${VNC_PASSWORD}" | python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read(), safe=''))")"
    NOVNC_PARAMS="${NOVNC_PARAMS}&password=${encoded_password}"
    return 0
  fi

  echo "VNC authentication disabled (default for this stack)."
  VNC_EXTRA_ARGS=(-SecurityTypes None)
}

setup_vnc_auth

cleanup_stale_vnc_display() {
  local display_num="1"
  local lock_file="/tmp/.X${display_num}-lock"
  local socket_file="/tmp/.X11-unix/X${display_num}"

  if [ -f "${lock_file}" ]; then
    local lock_pid
    lock_pid=$(cat "${lock_file}" 2>/dev/null | tr -d '[:space:]')
    if [ -n "${lock_pid}" ] && kill -0 "${lock_pid}" 2>/dev/null; then
      echo "VNC display :${display_num} appears active (pid ${lock_pid})"
    else
      echo "Removing stale VNC lock/socket for display :${display_num}"
      rm -f "${lock_file}" "${socket_file}"
    fi
  elif [ -S "${socket_file}" ]; then
    echo "Removing stale VNC socket for display :${display_num}"
    rm -f "${socket_file}"
  fi
}

cleanup_stale_vnc_display

DISPLAY_WIDTH=${DISPLAY_WIDTH:-1920}
DISPLAY_HEIGHT=${DISPLAY_HEIGHT:-1080}
GEOMETRY="${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}"

if [ ! -x "${VNC_BIN}" ]; then
  echo "ERROR: VNC server not found at ${VNC_BIN}"
  echo "Rebuild the slicer-gui base image so TurboVNC is installed."
  exit 1
fi

DRI_DIR="${TVNC_DRIDIR:-/usr/lib/x86_64-linux-gnu/dri}"
if [ ! -d "${DRI_DIR}" ]; then
  DRI_DIR="/usr/lib64/dri"
fi

echo "Starting TurboVNC (${VNC_BIN}) on :1 (${GEOMETRY})..."
"${VNC_BIN}" :1 -geometry "${GEOMETRY}" -depth 24 \
  -rfbport 5901 "${VNC_EXTRA_ARGS[@]}" \
  -dridir "${DRI_DIR}" \
  -desktop Slicer &
VNC_PID=$!
sleep 2

if ! kill -0 "$VNC_PID" 2>/dev/null; then
  echo "ERROR: TurboVNC failed to start (${VNC_BIN})"
  ls -la /tmp/.X1-lock /tmp/.X11-unix/X1 2>/dev/null || true
  exit 1
fi

export DISPLAY=:1
xsetroot -solid grey || true

/usr/local/bin/fix-screen-geometry.sh >/dev/null 2>&1 || true

if [ "${SLICER_WEB_GPU_DIAG:-0}" = "1" ]; then
  echo "=== GPU Diagnostics ==="
  nvidia-smi 2>&1 || echo "nvidia-smi failed"
  ls /usr/lib/x86_64-linux-gnu/libEGL_nvidia* 2>/dev/null \
    && echo "NVIDIA EGL: present" \
    || echo "NVIDIA EGL: NOT found"
  xdpyinfo 2>&1 | grep -E "(^| )GLX( |$)" \
    && echo "GLX: present" \
    || echo "GLX: MISSING"
  glxinfo 2>&1 | grep -E "OpenGL renderer" || echo "glxinfo failed"
  vglrun -d egl glxinfo 2>&1 | grep -E "OpenGL renderer|OpenGL vendor|ERROR" || true
  echo "NVIDIA_VISIBLE_DEVICES=${NVIDIA_VISIBLE_DEVICES}"
  echo "NVIDIA_DRIVER_CAPABILITIES=${NVIDIA_DRIVER_CAPABILITIES}"
elif ! ls /dev/nvidia* >/dev/null 2>&1; then
  echo "WARNING: /dev/nvidia* missing — OpenGL will use software (llvmpipe)."
elif ! ls /usr/share/glvnd/egl_vendor.d/*nvidia* >/dev/null 2>&1 \
   && ! ls /usr/lib/x86_64-linux-gnu/libEGL_nvidia* >/dev/null 2>&1; then
  echo "WARNING: NVIDIA EGL ICD not present (only Mesa)."
fi

cat > /opt/novnc/index.html << HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0; url=slicer-vnc.html?${NOVNC_PARAMS}">
  <title>Slicer</title>
</head>
<body></body>
</html>
HTML

echo "Starting noVNC on port 6080..."
python3 -m websockify --web /opt/novnc 6080 localhost:5901 &
NOVNC_PID=$!

if [ -n "${CLOUDFLARE_TUNNEL_TOKEN}" ]; then
  echo "Starting Cloudflare Tunnel..."
  cloudflared tunnel run --token "${CLOUDFLARE_TUNNEL_TOKEN}" &
  CLOUDFLARE_PID=$!
  sleep 2
fi

echo "Starting 3D Slicer..."
mkdir -p /home/slicer/data
chmod 777 /home/slicer/data 2>/dev/null || true
rm -f /home/slicer/data/.open-request.json 2>/dev/null || true
/usr/local/bin/launch-slicer.sh
SLICER_PID="$(cat /tmp/slicer.pid)"

(
  WIN=$(xdotool search --sync --class "Slicer" 2>/dev/null \
    || xdotool search --sync --name "Slicer" 2>/dev/null)
  WIN=$(echo "$WIN" | head -1)
  if [ -n "$WIN" ]; then
    SIZE=$(xrandr 2>/dev/null \
      | grep -m1 'current' \
      | grep -oP 'current \K\d+ x \d+' \
      | tr -d ' ')
    W=$(echo "$SIZE" | cut -dx -f1)
    H=$(echo "$SIZE" | cut -dx -f2)
    xdotool windowmove "$WIN" 0 0
    xdotool windowsize "$WIN" "$W" "$H"
  fi
) &

(
  APPLIED_SIZE=""
  while true; do
    SIZE=$(xrandr 2>/dev/null \
      | grep -m1 'current' \
      | grep -oP 'current \K\d+ x \d+' \
      | tr -d ' ')

    if [ -n "$SIZE" ] && [ "$SIZE" != "$APPLIED_SIZE" ]; then
      W=$(echo "$SIZE" | cut -dx -f1)
      H=$(echo "$SIZE" | cut -dx -f2)

      WIN=""
      for PATTERN in "Slicer" "slicer" "3D Slicer"; do
        WIN=$(xdotool search --onlyvisible --class "$PATTERN" 2>/dev/null | head -1)
        [ -n "$WIN" ] && break
        WIN=$(xdotool search --onlyvisible --name "$PATTERN" 2>/dev/null | head -1)
        [ -n "$WIN" ] && break
      done

      if [ -n "$WIN" ]; then
        xdotool windowmove "$WIN" 0 0
        xdotool windowsize "$WIN" "$W" "$H"
        /usr/local/bin/fix-screen-geometry.sh >/dev/null 2>&1 &
        APPLIED_SIZE="$SIZE"
      fi
    fi
    sleep 1
  done
) &
RESIZE_PID=$!

cleanup() {
  echo "Shutting down..."
  [ -n "$CLOUDFLARE_PID" ] && kill $CLOUDFLARE_PID 2>/dev/null || true
  kill $RESIZE_PID 2>/dev/null || true
  kill $SLICER_PID 2>/dev/null || true
  kill $NOVNC_PID 2>/dev/null || true
  kill $VNC_PID 2>/dev/null || true
  exit 0
}
trap cleanup SIGINT SIGTERM

echo "Slicer noVNC ready on :6080"
wait
