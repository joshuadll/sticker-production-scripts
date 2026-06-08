#!/bin/bash
set -e

SUPPORT_DIR="$HOME/Library/Application Support/Noteworthie"
INSTALL_DIR="$SUPPORT_DIR/scripts"
REPO_ZIP="https://github.com/joshuadll/sticker-production-scripts/archive/refs/heads/main.zip"
TMP_DIR=$(mktemp -d)

trap 'rm -rf "$TMP_DIR"' EXIT

curl -fsSL "$REPO_ZIP" -o "$TMP_DIR/scripts.zip"
unzip -q "$TMP_DIR/scripts.zip" -d "$TMP_DIR"
rsync -a --delete "$TMP_DIR/sticker-production-scripts-main/" "$INSTALL_DIR/"

# Write last-synced timestamp
echo "$(date '+%Y-%m-%d %H:%M')" > "$SUPPORT_DIR/last-synced.txt"
