#!/bin/bash
# Unit tests for psUtils.jsx pure functions.
# Requires Photoshop to be running. No fixture PSD or open document needed.
#
# Pass/fail is determined by the log file — no golden file needed here.
# Any line containing "FAIL |" means a test failed.

set -euo pipefail

STEP="psUtils-unit"
APP="Adobe Photoshop 2024"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/test-psUtils.jsx"
LOG="$HOME/Desktop/test-psUtils.log"

echo "[$STEP] Running psUtils unit tests..."

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

# Any FAIL line = test failure. No golden file needed — logic is asserted in the JSX.
FAIL_COUNT=$(grep -c "\[psUtils-test\] FAIL |" "$LOG" || true)
PASS_COUNT=$(grep -c "\[psUtils-test\] PASS |" "$LOG" || true)

echo "[$STEP] $PASS_COUNT passed, $FAIL_COUNT failed."

if [ "$FAIL_COUNT" -gt 0 ]; then
    echo ""
    echo "Failures:"
    grep "\[psUtils-test\] FAIL |" "$LOG" || true
    echo ""
    echo "Full log: $LOG"
    exit 1
else
    echo "PASS [$STEP]"
    exit 0
fi
