#!/bin/bash
# In-Illustrator validation of the bezier caption caps (test-caption-capend-ai.jsx):
# proves the smooth cap survives the Pathfinder UNITE (deriveCutline) and the peel-tab SEAM
# trace (plateSeamPath) in the REAL app — the two things the node unit test can't check.
# No fixture: the JSX builds its own doc. Writes [capend-ai] PASS|/FAIL| lines; runner greps FAIL.
set -euo pipefail

STEP="caption-capend-ai"
APP="Adobe Illustrator"
DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$DIR/test-caption-capend-ai.jsx"
LOG="$HOME/Desktop/test-caption-capend-ai.log"

rm -f "$LOG"

echo "[$STEP] Running bezier-cap validation in Illustrator..."
osascript -e 'with timeout of 300 seconds' \
  -e "tell application \"$APP\"" \
  -e "do javascript file (POSIX file \"$SCRIPT\")" \
  -e 'end tell' -e 'end timeout'

TIMEOUT=120; ELAPSED=0
until { [ -f "$LOG" ] && grep -qE "\[capend-ai\] (PASS|FAIL) \|" "$LOG"; } || [ "$ELAPSED" -ge "$TIMEOUT" ]; do
    sleep 2; ELAPSED=$((ELAPSED + 2))
done

if [ ! -f "$LOG" ]; then
    echo "FAIL [$STEP]: log not written after ${TIMEOUT}s — script may have crashed."
    exit 1
fi

echo "--- log ---"
cat "$LOG"
echo "-----------"

FAILS=$(grep -c "\[capend-ai\] FAIL |" "$LOG" || true)
PASSES=$(grep -c "\[capend-ai\] PASS |" "$LOG" || true)

if [ "${FAILS:-0}" -gt 0 ] || [ "${PASSES:-0}" -eq 0 ]; then
    echo "FAIL [$STEP]: ${FAILS:-0} failing assertion(s), ${PASSES:-0} pass(es)."
    exit 1
fi

echo "PASS [$STEP]: bezier caps survive Unite + seam trace ($PASSES assertions)."
exit 0
