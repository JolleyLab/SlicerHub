#!/usr/bin/env sh
# Fetch a prebuilt SlicerWeb channel into its local data directory.
#
# Usage:
#   scripts/fetch-slicerweb.sh                  # stable channel (default)
#   scripts/fetch-slicerweb.sh --channel stable
#   scripts/fetch-slicerweb.sh --channel latest
#
# The channel maps to a git branch in the deploy repo:
#   stable  →  deploy/stable   →  data/slicerweb-stable/
#   latest  →  deploy/latest   →  data/slicerweb-latest/
#
# With credentials configured (.env), the backend downloads and updates both channels itself
# (slicerWebUpdater.js); this fills a channel by hand, e.g. without them or with the backend stopped.
#
# Repo: $SLICERWEB_REPO_URL, default the SlicerHeart viewer builds. The repo is private, so git needs
# read access: your own GitHub login, or the deploy key the backend uses.
# Override the destination with $SLICERWEB_STABLE_DIR or $SLICERWEB_LATEST_DIR, and set the
# same value in .env so docker compose mounts the same folder.
set -eu

CHANNEL=stable
if [ "${1:-}" = "--channel" ]; then CHANNEL="${2:-}"; fi
case "$CHANNEL" in
    stable|latest) ;;
    *) echo "Unknown channel '$CHANNEL'. Use 'stable' or 'latest'." >&2; exit 1 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_URL="${SLICERWEB_REPO_URL:-https://github.com/JolleyLab/SlicerHeartWebViewer-app.git}"
REF="deploy/$CHANNEL"
if [ "$CHANNEL" = stable ]; then DEST="${SLICERWEB_STABLE_DIR:-$ROOT/data/slicerweb-stable}"
else DEST="${SLICERWEB_LATEST_DIR:-$ROOT/data/slicerweb-latest}"; fi

if ! mkdir -p "$DEST" 2>/dev/null || [ ! -w "$DEST" ]; then
    VAR="SLICERWEB_$(echo "$CHANNEL" | tr '[:lower:]' '[:upper:]')_DIR"
    echo "Cannot write to $DEST." >&2
    echo "Set $VAR to a folder you can write to (in your shell and in .env), then run this again." >&2
    echo "If Docker created that folder (root-owned and empty, because docker compose ran first):" >&2
    echo "  docker compose stop nginx && rmdir \"$DEST\"   # allowed when you own its parent; no sudo" >&2
    exit 1
fi

# Work in the system temp folder, so nothing is needed beyond the destination itself.
TMP="$(mktemp -d "${TMPDIR:-/tmp}/slicerweb-fetch.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

echo "Resolving latest SHA for $REF ..."
git -C "$TMP" init -q
git -C "$TMP" remote add origin "$REPO_URL"
# Deploy branches are single-commit histories, force-pushed on each build: fetch by branch name.
GIT_TERMINAL_PROMPT=0 git -C "$TMP" fetch -q --depth 1 origin "$REF" \
    || { echo "Could not fetch $REF from $REPO_URL" >&2; exit 1; }
SHA="$(git -C "$TMP" rev-parse FETCH_HEAD)"

if [ -f "$DEST/.version" ] && [ "$(tr -d '[:space:]' < "$DEST/.version")" = "$SHA" ]; then
    echo "SlicerWeb $CHANNEL ($SHA) already present in $DEST"
    exit 0
fi

git -C "$TMP" checkout -q FETCH_HEAD
rm -rf "$TMP/.git" "$TMP/.github"

# Replace the contents (not the folder itself, which may be a mount point or owned by someone else).
find "$DEST" -mindepth 1 -delete
cp -R "$TMP"/. "$DEST"/
printf '%s' "$SHA" > "$DEST/.version"
echo "SlicerWeb $CHANNEL $(echo "$SHA" | cut -c1-12) installed in $DEST"
