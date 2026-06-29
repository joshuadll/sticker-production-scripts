#!/bin/bash
# Unit tests for the Illustrator-side vector caption seat in utils/aiUtils.jsx
# (seatPlateToOutline + its pure helpers). Requires Illustrator to be running.
# No fixture or open document needed.
#
# Pass/fail is determined by the log file — no golden file needed here.
# Any line containing "FAIL |" means a test failed.

set -euo pipefail

STEP="ai-caption-seat-unit"
APP="Adobe Illustrator"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/test-ai-caption-seat.jsx"
LOG="$HOME/Desktop/test-ai-caption-seat.log"

echo "[$STEP] Running AI caption-seat unit tests..."

rm -f "$LOG"

osascript -e "tell application \"$APP\" to do javascript file \"$SCRIPT\""

# Wait for log
TIMEOUT=30
ELAPSED=0
until [ -f "$LOG" ] || [ "$ELAPSED" -ge "$TIMEOUT" ]; do
    sleep 1
    ELAPSED=$((ELAPSED + 1))
done

if [ ! -f "$LOG" ]; then
    echo "FAIL [$STEP]: log not written after ${TIMEOUT}s — script may have crashed."
    exit 1
fi

FAIL_COUNT=$(grep -c "\[ai-seat-test\] FAIL |" "$LOG" || true)
PASS_COUNT=$(grep -c "\[ai-seat-test\] PASS |" "$LOG" || true)

echo "[$STEP] $PASS_COUNT passed, $FAIL_COUNT failed."

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo ""
    echo "Failures:"
    grep "\[ai-seat-test\] FAIL |" "$LOG" || true
    echo ""
    echo "Full log: $LOG"
    exit 1
else
    echo "PASS [$STEP]"
    exit 0
fi
