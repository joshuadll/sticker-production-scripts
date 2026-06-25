#!/bin/bash
# LIVE DOM validation of the multi-line caption fix on the real St Elizabeth's geometry.
# Opens the committed fixture, edits one caption in memory, asserts, closes WITHOUT saving
# (fixture on disk untouched). Requires Photoshop running.

set -euo pipefail

STEP="caption-linecount-live"
APP="Adobe Photoshop 2026"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/test-caption-linecount-live.jsx"
LOG="$HOME/Desktop/test-caption-linecount-live.log"

echo "[$STEP] Running live caption line-count validation..."
rm -f "$LOG"

osascript -e "tell application \"$APP\" to do javascript file \"$SCRIPT\""

TIMEOUT=60; ELAPSED=0
until [ -f "$LOG" ] || [ "$ELAPSED" -ge "$TIMEOUT" ]; do sleep 1; ELAPSED=$((ELAPSED + 1)); done
if [ ! -f "$LOG" ]; then
    echo "FAIL [$STEP]: log not written after ${TIMEOUT}s -- script may have crashed."
    exit 1
fi

FAIL_COUNT=$(grep -c "\[linecount-live\] FAIL |" "$LOG" || true)
PASS_COUNT=$(grep -c "\[linecount-live\] PASS |" "$LOG" || true)
echo "[$STEP] $PASS_COUNT passed, $FAIL_COUNT failed."
echo "--- log ---"; cat "$LOG"; echo "-----------"

if [ "$FAIL_COUNT" -gt 0 ] || [ "$PASS_COUNT" -eq 0 ]; then
    echo "FAIL [$STEP]  (full log: $LOG)"
    exit 1
else
    echo "PASS [$STEP]"
    exit 0
fi
