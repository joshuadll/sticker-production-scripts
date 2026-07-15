#!/bin/bash
set -euo pipefail
STEP="halfcut-validate"; APP="Adobe Illustrator"
DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$DIR/test-halfcut-validate.jsx"
LOG="$HOME/Desktop/test-halfcut-validate.log"
rm -f "$LOG"
osascript -e 'with timeout of 120 seconds' -e "tell application \"$APP\"" \
  -e "do javascript file (POSIX file \"$SCRIPT\")" -e 'end tell' -e 'end timeout'
T=60; E=0
until { [ -f "$LOG" ] && grep -qE "\[halfcut-validate\] (PASS|FAIL) \|" "$LOG"; } || [ "$E" -ge "$T" ]; do sleep 2; E=$((E+2)); done
echo "--- log ---"; cat "$LOG"; echo "-----------"
FAILS=$(grep -c "\[halfcut-validate\] FAIL |" "$LOG" || true)
PASSES=$(grep -c "\[halfcut-validate\] PASS |" "$LOG" || true)
if [ "${FAILS:-0}" -gt 0 ] || [ "${PASSES:-0}" -eq 0 ]; then echo "FAIL [$STEP]: $FAILS failing"; exit 1; fi
echo "PASS [$STEP]"; exit 0
