#!/bin/bash
# Integration test for Step 7A (Deepnest SVG Export).
# Runs AI_BuildCutlines.jsx (direct/main() path) against a fixture .ai file that has
# named paths in a Cutlines layer and checks that _regular.svg and _irregular.svg are produced.
#
# FIXTURES REQUIRED:
#   tests/integration/fixtures/step7a-working.ai
#     A working .ai file that has been through Step 6 — must have a "Cutlines"
#     layer with at least one named PathItem or CompoundPathItem.
#     Obtain by running Step 6 on a fixture PSD and saving the result here.
#
# GOLDEN FILE WORKFLOW — first run:
#   1. Run this script (SKIP diff if no golden file yet)
#   2. Verify the log shows per-path ratios and sane regular/irregular split
#   3. Commit: cp "$LOG" tests/integration/expected/ai-build-cutlines-export-expected.txt

set -euo pipefail

STEP="ai-build-cutlines-export"
APP="Adobe Illustrator"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/pipelines/AI_BuildCutlines.jsx"
FIXTURE_DIR="$(cd "$(dirname "$0")" && pwd)/fixtures"
FIXTURE_AI="$FIXTURE_DIR/step7a-working.ai"
EXPECTED="$(cd "$(dirname "$0")" && pwd)/expected/ai-build-cutlines-export-expected.txt"

TEMP_SCRIPT="/tmp/${STEP}-test.jsx"
LOG="/tmp/AI_BuildCutlines.log"

REGULAR_SVG="${FIXTURE_AI%.ai}_regular.svg"
IRREGULAR_SVG="${FIXTURE_AI%.ai}_irregular.svg"

# ── Pre-flight ───────────────────────────────────────────────────────────────

if [ ! -f "$FIXTURE_AI" ]; then
    echo "SKIP [$STEP]: fixture not found: $FIXTURE_AI"
    echo "  See script header for fixture creation instructions."
    exit 0
fi

# ── Prepare temp script ──────────────────────────────────────────────────────
# Inject suppressAlerts and point logPath to /tmp so it is always writable.

rm -f "$LOG" "$TEMP_SCRIPT" "$REGULAR_SVG" "$IRREGULAR_SVG"

perl -pe '
    s|suppressAlerts:\s*false|suppressAlerts: true|;
    s|#include "\.\./|#include "'"$REPO_ROOT"'/|g;
' "$SCRIPT" > "$TEMP_SCRIPT"

# ── Run script via osascript ─────────────────────────────────────────────────

echo "[$STEP] Opening fixture and running Deepnest export..."
osascript << EOF
tell application "$APP"
    set doc to open (POSIX file "$FIXTURE_AI")
    do javascript file (POSIX file "$TEMP_SCRIPT")
end tell
EOF

rm -f "$TEMP_SCRIPT"

# ── Wait for log ─────────────────────────────────────────────────────────────

TIMEOUT=60
ELAPSED=0
until [ -f "$LOG" ] || [ "$ELAPSED" -ge "$TIMEOUT" ]; do
    sleep 1
    ELAPSED=$((ELAPSED + 1))
done

if [ ! -f "$LOG" ]; then
    echo "FAIL [$STEP]: log not written after ${TIMEOUT}s — script may have crashed."
    exit 1
fi

# ── Verify key log lines ─────────────────────────────────────────────────────

FAIL=0

if grep -q "\[step7a\] classified:" "$LOG"; then
    echo "PASS [$STEP]: classification summary found in log."
else
    echo "FAIL [$STEP]: '[step7a] classified:' not found in log."
    FAIL=1
fi

if grep -q "\[step7a\] exported:" "$LOG"; then
    echo "PASS [$STEP]: export lines found in log."
else
    echo "FAIL [$STEP]: '[step7a] exported:' not found in log."
    FAIL=1
fi

if [ -f "$REGULAR_SVG" ] && [ -s "$REGULAR_SVG" ]; then
    echo "PASS [$STEP]: _regular.svg created and non-empty."
else
    echo "FAIL [$STEP]: _regular.svg missing or empty."
    FAIL=1
fi

if [ -f "$IRREGULAR_SVG" ] && [ -s "$IRREGULAR_SVG" ]; then
    echo "PASS [$STEP]: _irregular.svg created and non-empty."
else
    echo "FAIL [$STEP]: _irregular.svg missing or empty."
    FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
    echo "  Log contents:"
    cat "$LOG"
    exit 1
fi

# ── Diff against golden file ─────────────────────────────────────────────────

strip_variable_lines() {
    grep -Ev "^\[pipeline\] (=== AI_BuildCutlines .*(start|done)|document:|threshold:)"
}

if [ ! -f "$EXPECTED" ]; then
    echo ""
    echo "NOTE [$STEP]: no golden file yet — this is expected on first run."
    echo "  Log written to: $LOG"
    echo "  Check per-path ratios to calibrate CONFIG.deepnestRectThreshold."
    echo "  If the split looks correct, commit the log as the golden file:"
    echo ""
    echo "    cp \"$LOG\" \"$EXPECTED\""
    echo "    git add \"$EXPECTED\""
    echo "    git commit -m 'Add golden output for ai-build-cutlines-export'"
    echo ""
    exit 0
fi

if diff -u <(strip_variable_lines < "$EXPECTED") <(strip_variable_lines < "$LOG"); then
    echo "PASS [$STEP]"
    exit 0
else
    echo "FAIL [$STEP]: output differs from golden file (diff above)."
    echo "  If the change is intentional:"
    echo "    cp \"$LOG\" \"$EXPECTED\""
    echo "    git add \"$EXPECTED\" && git commit -m 'Update ai-build-cutlines-export golden output: <reason>'"
    exit 1
fi
