#!/bin/bash
set -e

SUPPORT_DIR="${NOTEWORTHIE_SUPPORT_DIR:-$HOME/Library/Application Support/Noteworthie}"
INSTALL_DIR="$SUPPORT_DIR/scripts"
REPO_SLUG="joshuadll/sticker-production-scripts"
REPO_ZIP="https://github.com/$REPO_SLUG/archive/refs/heads/main.zip"
STATUS_FILE="$SUPPORT_DIR/update-status.txt"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$SUPPORT_DIR"

# Previously-installed commit SHA (empty on first run)
installed=""
[ -f "$STATUS_FILE" ] && installed=$(grep '^installed=' "$STATUS_FILE" | head -1 | cut -d= -f2)

# Cheap precheck: latest main SHA via the GitHub API (pure curl — no git dependency).
# -f makes curl fail on non-2xx (rate-limit/offline) -> empty. Validate it's a real
# 40-char hex SHA; anything else is treated as "couldn't check" (offline path).
latest=$(curl -fsSL --connect-timeout 10 --max-time 15 -H "Accept: application/vnd.github.sha" \
    "https://api.github.com/repos/$REPO_SLUG/commits/main" 2>/dev/null || true)
printf '%s' "$latest" | grep -Eq '^[0-9a-f]{40}$' || latest=""

now=$(date +%s)
write_status() {   # $1 installed  $2 latest  $3 ok  (atomic: write temp, then rename)
    { echo "installed=$1"; echo "latest=$2"; echo "checked=$now"; echo "ok=$3"; } > "$STATUS_FILE.tmp"
    mv -f "$STATUS_FILE.tmp" "$STATUS_FILE"
}

have_scripts() { [ -d "$INSTALL_DIR/pipelines" ] && [ -n "$(ls -A "$INSTALL_DIR/pipelines" 2>/dev/null)" ]; }

# Confirmed current (known SHA matches what's installed): skip the download entirely.
if [ -n "$latest" ] && [ "$latest" = "$installed" ] && have_scripts; then
    write_status "$installed" "$latest" "1"
    exit 0
fi

# Couldn't verify the latest SHA (rate-limit / API blip / offline) AND scripts already
# exist: keep them and mark the check unsuccessful. Do NOT block or blindly re-download.
if [ -z "$latest" ] && have_scripts; then
    write_status "$installed" "$installed" "0"
    exit 0
fi

# Otherwise: a genuinely new SHA, OR no scripts yet (first install). Try the zip even if
# the API precheck was unavailable — the zip endpoint (codeload) may be reachable when the
# API isn't, so a first install is never blocked by an API-only failure. On any failure
# here, record ok=0 while KEEPING the previous installed SHA (the new version did not land).
trap 'write_status "$installed" "$latest" "0"' ERR
mkdir -p "$INSTALL_DIR"
curl -fsSL --connect-timeout 10 --max-time 120 "$REPO_ZIP" -o "$TMP_DIR/scripts.zip"
ditto -xk "$TMP_DIR/scripts.zip" "$TMP_DIR"
rsync -a --delete \
    --exclude='tests/' \
    --exclude='docs/' \
    --exclude='installer/' \
    "$TMP_DIR/sticker-production-scripts-main/" "$INSTALL_DIR/"
trap - ERR

# If the precheck couldn't get the SHA (first-install fallback above), we don't know it —
# record what we have (empty -> "unknown" until the next successful check). ok=1: the sync succeeded.
write_status "${latest:-$installed}" "$latest" "1"
