#!/bin/bash
# Regression guard for the HALF-CUT ENDPOINT EXTENSION (utils/aiUtils.jsx).
# Opens the post-Step-6 import-nesting.ai fixture, runs the REAL aiUtils path
# (syncHalfcut) on every caption group via
# test-halfcut-alignment.jsx, and asserts every half-cut endpoint lands ON the cut line
# (the 1mm overshoot runs along the contour, not off along the art tangent — commit d996451).
#
# No golden file: the JSX asserts the invariant and writes [halfcut-test] PASS|/FAIL| lines.
# A regression that pushes endpoints off the cut line trips a FAIL line.
#
# FIXTURE: tests/integration/unit/fixtures/import-nesting.ai (a local-only copy; the ai-import-nesting pipeline test has its own under ai-import-nesting/fixtures/).
set -euo pipefail

STEP="ai-halfcut-alignment"
APP="Adobe Illustrator"
DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$DIR/test-halfcut-alignment.jsx"
AI_FIXTURE="$DIR/fixtures/import-nesting.ai"
LOG="$HOME/Desktop/test-halfcut-alignment.log"

if [ ! -f "$AI_FIXTURE" ]; then
    echo "SKIP [$STEP]: fixture not found: $AI_FIXTURE"
    exit 0
fi

rm -f "$LOG"

echo "[$STEP] Opening fixture and measuring half-cut alignment..."
osascript -e 'with timeout of 300 seconds' \
  -e "tell application \"$APP\"" \
  -e "do javascript \"app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS; while(app.documents.length>0){app.documents[0].close(SaveOptions.DONOTSAVECHANGES);} app.open(new File('$AI_FIXTURE'));\"" \
  -e "do javascript file (POSIX file \"$SCRIPT\")" \
  -e 'end tell' -e 'end timeout'

TIMEOUT=120; ELAPSED=0
until { [ -f "$LOG" ] && grep -qE "\[halfcut-test\] (PASS|FAIL) \|" "$LOG"; } || [ "$ELAPSED" -ge "$TIMEOUT" ]; do
    sleep 2; ELAPSED=$((ELAPSED + 2))
done

if [ ! -f "$LOG" ]; then
    echo "FAIL [$STEP]: log not written after ${TIMEOUT}s — script may have crashed."
    exit 1
fi

echo "--- log ---"
cat "$LOG"
echo "-----------"

FAILS=$(grep -c "\[halfcut-test\] FAIL |" "$LOG" || true)
PASSES=$(grep -c "\[halfcut-test\] PASS |" "$LOG" || true)

if [ "${FAILS:-0}" -gt 0 ] || [ "${PASSES:-0}" -eq 0 ]; then
    echo "FAIL [$STEP]: $FAILS failing assertion(s)."
    exit 1
fi

echo "PASS [$STEP]: half-cut endpoints on the cut line."
exit 0
