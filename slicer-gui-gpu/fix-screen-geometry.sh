#!/bin/bash
# Synchronize X11/EWMH geometry after a VNC framebuffer resize so Qt popups
# are not constrained to stale work-area dimensions.

if [ -z "${DISPLAY}" ]; then
  echo "ERROR: DISPLAY not set"
  exit 1
fi

get_current_size() {
  local size=""

  if command -v xrandr >/dev/null 2>&1; then
    size=$(xrandr 2>/dev/null | grep -m1 'current' | grep -oE 'current [0-9]+ x [0-9]+' | sed -E 's/current ([0-9]+) x ([0-9]+)/\1x\2/')
  fi

  if [ -z "${size}" ] && command -v xdpyinfo >/dev/null 2>&1; then
    size=$(xdpyinfo 2>/dev/null | grep -m1 'dimensions:' | grep -oE '[0-9]+x[0-9]+')
  fi

  echo "${size}"
}

SIZE="$(get_current_size)"
if [ -z "${SIZE}" ]; then
  echo "Warning: could not determine current screen size"
  exit 1
fi

WIDTH="${SIZE%x*}"
HEIGHT="${SIZE#*x}"

if [ -z "${WIDTH}" ] || [ -z "${HEIGHT}" ]; then
  echo "Warning: invalid size '${SIZE}'"
  exit 1
fi

echo "Syncing X11 geometry to ${WIDTH}x${HEIGHT}"

if command -v xrefresh >/dev/null 2>&1; then
  xrefresh -white >/dev/null 2>&1 || true
fi

if command -v xrandr >/dev/null 2>&1; then
  xrandr --query | awk '/ connected/{print $1}' | while read -r output; do
    current_mode=$(xrandr --query | awk -v out="${output}" '$1==out && $2=="connected"{for(i=1;i<=NF;i++) if($i ~ /^[0-9]+x[0-9]+/) {print $i; exit}}')
    if [ -n "${current_mode}" ]; then
      xrandr --output "${output}" --mode "${current_mode}" >/dev/null 2>&1 || true
    fi
  done
fi

if command -v xprop >/dev/null 2>&1; then
  xprop -root -f _NET_NUMBER_OF_DESKTOPS 32c -set _NET_NUMBER_OF_DESKTOPS "1" >/dev/null 2>&1 || true
  xprop -root -f _NET_CURRENT_DESKTOP 32c -set _NET_CURRENT_DESKTOP "0" >/dev/null 2>&1 || true
  xprop -root -f _NET_DESKTOP_GEOMETRY 32c -set _NET_DESKTOP_GEOMETRY "${WIDTH}, ${HEIGHT}" >/dev/null 2>&1 || true
  xprop -root -f _NET_DESKTOP_VIEWPORT 32c -set _NET_DESKTOP_VIEWPORT "0, 0" >/dev/null 2>&1 || true
  xprop -root -f _NET_WORKAREA 32c -set _NET_WORKAREA "0, 0, ${WIDTH}, ${HEIGHT}" >/dev/null 2>&1 || true
fi

if command -v wmctrl >/dev/null 2>&1; then
  wmctrl -m >/dev/null 2>&1 || true
fi

echo "Screen geometry sync complete"
