#!/usr/bin/env sh
# Fetch the prebuilt SlicerWeb site (github.com/lassoan/slicerweb-app) at the commit pinned in
# slicerweb/VERSION into data/slicerweb/ (git-ignored), where nginx serves it at /slicerweb/.
# To upgrade: put a new commit SHA in slicerweb/VERSION and re-run.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_URL="${SLICERWEB_REPO_URL:-https://github.com/lassoan/slicerweb-app.git}"
SHA="$(tr -d '[:space:]' < "$ROOT/slicerweb/VERSION")"
DEST="$ROOT/data/slicerweb"
TMP="$ROOT/data/.slicerweb-fetch"

if [ -f "$DEST/.version" ] && [ "$(cat "$DEST/.version")" = "$SHA" ]; then
    echo "SlicerWeb $SHA already present in data/slicerweb"
    exit 0
fi

rm -rf "$TMP"
mkdir -p "$TMP"
git -C "$TMP" init -q
git -C "$TMP" remote add origin "$REPO_URL"
# The upstream repo keeps one build and rewrites history; if this SHA is gone, pin a newer one.
git -C "$TMP" fetch -q --depth 1 origin "$SHA" \
    || { echo "Could not fetch $SHA from $REPO_URL - update slicerweb/VERSION" >&2; rm -rf "$TMP"; exit 1; }
git -C "$TMP" checkout -q FETCH_HEAD

rm -rf "$DEST"
mkdir -p "$DEST"
rm -rf "$TMP/.git" "$TMP/.github"
cp -R "$TMP"/. "$DEST"/
rm -rf "$TMP"
printf '%s\n' "$SHA" > "$DEST/.version"
echo "SlicerWeb $SHA installed in data/slicerweb"
