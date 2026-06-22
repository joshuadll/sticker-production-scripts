#!/bin/bash
# Unit tests for caption line-count detection in Step3B_CaptionWhite.jsx
# (_countCaptionLines / the _isMultiLineText decision boundary).
# Requires Photoshop to be running. No fixture PSD or open document needed.
#
# Pass/fail is determined by the log file -- no golden file needed here.
# Any line containing "FAIL |" means a test failed.

set -euo pipefail

STEP="caption-linecount-unit"
APP="Adobe Photoshop 2026"
SCRIPT="$(cd "$(dirname "$0")" && pwd)/test-caption-linecount.jsx"
LOG="$HOME/Desktop/test-caption-linecount.log"

echo "[$STEP] Running caption line-count unit tests..."

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
    echo "FAIL [$STEP]: log not written after ${TIMEOUT}s -- script may have crashed."
    exit 1
fi

# Any FAIL line = test failure. No golden file needed -- logic is asserted in the JSX.
FAIL_COUNT=$(grep -c "\[linecount-test\] FAIL |" "$LOG" || true)
PASS_COUNT=$(grep -c "\[linecount-test\] PASS |" "$LOG" || true)

echo "[$STEP] $PASS_COUNT passed, $FAIL_COUNT failed."

if [ "$FAIL_COUNT" -gt 0 ] || [ "$PASS_COUNT" -eq 0 ]; then
    echo ""
    echo "Failures:"
    grep "\[linecount-test\] FAIL |" "$LOG" || echo "  (no PASS lines either -- script likely errored before asserting)"
    echo ""
    echo "Full log: $LOG"
    exit 1
else
    echo "PASS [$STEP]"
    exit 0
fi
