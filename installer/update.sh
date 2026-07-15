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
latest=$(curl -fsSL -H "Accept: application/vnd.github.sha" \
    "https://api.github.com/repos/$REPO_SLUG/commits/main" 2>/dev/null || true)
printf '%s' "$latest" | grep -Eq '^[0-9a-f]{40}$' || latest=""

now=$(date +%s)
write_status() {   # $1 installed  $2 latest  $3 ok
    { echo "installed=$1"; echo "latest=$2"; echo "checked=$now"; echo "ok=$3"; } > "$STATUS_FILE"
}

# Offline / fetch failed: leave scripts + installed SHA intact, mark not-ok.
if [ -z "$latest" ]; then
    write_status "$installed" "$installed" "0"
    exit 0
fi

# Already current: skip the download entirely.
if [ "$latest" = "$installed" ] && [ -d "$INSTALL_DIR" ]; then
    write_status "$installed" "$latest" "1"
    exit 0
fi

# Changed (or first run): full sync. If any download/sync step fails here, record
# ok=0 while KEEPING the previous installed SHA (the new version did not land), so
# the status never misreports a failed or partial sync as healthy.
trap 'write_status "$installed" "$latest" "0"' ERR
mkdir -p "$INSTALL_DIR"
curl -fsSL "$REPO_ZIP" -o "$TMP_DIR/scripts.zip"
ditto -xk "$TMP_DIR/scripts.zip" "$TMP_DIR"
rsync -a --delete \
    --exclude='tests/' \
    --exclude='docs/' \
    --exclude='installer/' \
    "$TMP_DIR/sticker-production-scripts-main/" "$INSTALL_DIR/"
trap - ERR

write_status "$latest" "$latest" "1"
