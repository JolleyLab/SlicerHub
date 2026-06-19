#!/bin/bash
# Resize the Slicer main window to the current VNC framebuffer, then sync EWMH geometry.
set -u

export DISPLAY="${DISPLAY:-:1}"

get_current_size() {
  local size=""
  if command -v xrandr >/dev/null 2>&1; then
    size=$(xrandr 2>/dev/null | grep -m1 'current' | grep -oP 'current \K\d+ x \d+' | tr -d ' ')
  fi
  if [ -z "${size}" ] && command -v xdpyinfo >/dev/null 2>&1; then
    size=$(xdpyinfo 2>/dev/null | grep -m1 'dimensions:' | grep -oE '[0-9]+x[0-9]+')
  fi
  echo "${size}"
}

find_slicer_window() {
  local win=""
  for pattern in "Slicer" "slicer" "3D Slicer"; do
    win=$(xdotool search --onlyvisible --class "$pattern" 2>/dev/null | head -1)
    [ -n "$win" ] && { echo "$win"; return 0; }
    win=$(xdotool search --onlyvisible --name "$pattern" 2>/dev/null | head -1)
    [ -n "$win" ] && { echo "$win"; return 0; }
  done
  return 1
}

SIZE="$(get_current_size)"
if [ -z "$SIZE" ]; then
  echo "[apply-slicer-window-size] Could not determine screen size"
  exit 1
fi

W="${SIZE%x*}"
H="${SIZE#*x}"
WIN="$(find_slicer_window || true)"

if [ -n "$WIN" ] && [ -n "$W" ] && [ -n "$H" ]; then
  echo "[apply-slicer-window-size] Resizing wid=${WIN} to ${W}x${H}"
  xdotool windowmove "$WIN" 0 0
  xdotool windowsize "$WIN" "$W" "$H"
else
  echo "[apply-slicer-window-size] Slicer window or size not ready (win=${WIN:-none}, size=${SIZE})"
fi

/usr/local/bin/fix-screen-geometry.sh
