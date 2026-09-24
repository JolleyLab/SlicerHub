#!/usr/bin/env sh
# Fetch the prebuilt SlicerWeb site (github.com/lassoan/slicerweb-app) at the commit pinned in
# slicerweb/VERSION, where nginx serves it at /slicerweb/.
#
# Destination: data/slicerweb/ (git-ignored), or $SLICERWEB_DIR when set. Use SLICERWEB_DIR if data/ is
# not writable by you (for example root-owned because Docker created it), and set the same value in .env
# so docker compose mounts that folder:   SLICERWEB_DIR=$HOME/slicerweb-site
#
# To upgrade: put a new commit SHA in slicerweb/VERSION and re-run.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_URL="${SLICERWEB_REPO_URL:-https://github.com/lassoan/slicerweb-app.git}"
SHA="$(tr -d '[:space:]' < "$ROOT/slicerweb/VERSION")"
DEST="${SLICERWEB_DIR:-$ROOT/data/slicerweb}"

if [ -f "$DEST/.version" ] && [ "$(cat "$DEST/.version")" = "$SHA" ]; then
    echo "SlicerWeb $SHA already present in $DEST"
    exit 0
fi

if ! mkdir -p "$DEST" 2>/dev/null || [ ! -w "$DEST" ]; then
    echo "Cannot write to $DEST." >&2
    echo "Set SLICERWEB_DIR to a folder you can write to (in your shell and in .env), then run this again." >&2
    exit 1
fi

# Work in the system temp folder, so nothing is needed beyond the destination itself.
TMP="$(mktemp -d "${TMPDIR:-/tmp}/slicerweb-fetch.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

git -C "$TMP" init -q
git -C "$TMP" remote add origin "$REPO_URL"
# The upstream repo keeps one build and rewrites history; if this SHA is gone, pin a newer one.
git -C "$TMP" fetch -q --depth 1 origin "$SHA" \
    || { echo "Could not fetch $SHA from $REPO_URL - update slicerweb/VERSION" >&2; exit 1; }
git -C "$TMP" checkout -q FETCH_HEAD
rm -rf "$TMP/.git" "$TMP/.github"

# Replace the contents (not the folder itself, which may be a mount point or owned by someone else).
find "$DEST" -mindepth 1 -delete
cp -R "$TMP"/. "$DEST"/
printf '%s\n' "$SHA" > "$DEST/.version"
echo "SlicerWeb $SHA installed in $DEST"
