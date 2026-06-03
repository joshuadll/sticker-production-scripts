#!/bin/bash
# Integration test for Step 8 (Simplify + Caption Normalisation).
# Runs AI_RefineCutlines.jsx against a saved Step-6 output .ai and checks that
# cutlines were simplified and GC plates normalised.
#
# FIXTURE REQUIRED:
#   tests/integration/fixtures/step8-cutlines.ai
#     A production .ai right after Step 6 (the Cutlines layer populated with
#     named cutline groups). Create it by running run-step6.sh, then in
#     Illustrator: File > Save As → this path. Include at least one GC caption
#     element so Step 8b has something to normalise.
#
# GOLDEN FILE WORKFLOW — first run:
#   1. Run this script (SKIP diff if no golden file yet)
#   2. Verify the log looks correct (simplified > 0, normalised >= 0, no errors)
#   3. Commit: cp "$LOG" tests/integration/expected/step8-expected.txt

set -euo pipefail

STEP="step8"
APP="Adobe Illustrator 2024"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/pipelines/AI_RefineCutlines.jsx"
FIXTURE_DIR="$(cd "$(dirname "$0")" && pwd)/fixtures"
AI_FIXTURE="$FIXTURE_DIR/step8-cutlines.ai"
EXPECTED="$(cd "$(dirname "$0")" && pwd)/expected/step8-expected.txt"

TEMP_SCRIPT="/tmp/${STEP}-test.jsx"
LOG="/tmp/AI_RefineCutlines.log"

# ── Pre-flight ───────────────────────────────────────────────────────────────

if [ ! -f "$AI_FIXTURE" ]; then
    echo "SKIP [$STEP]: fixture not found: $AI_FIXTURE"
    echo "  See script header for fixture creation instructions."
    exit 0
fi

# ── Prepare temp script ──────────────────────────────────────────────────────
# Suppress alerts for headless run. main() operates on app.activeDocument, so we
# open the fixture first (below) then eval the patched pipeline.

rm -f "$LOG" "$TEMP_SCRIPT"

perl -pe 's|suppressAlerts:\s*false|suppressAlerts: true|;' "$SCRIPT" > "$TEMP_SCRIPT"

# ── Run script via osascript ─────────────────────────────────────────────────

echo "[$STEP] Opening fixture and running AfterDeepnest pipeline..."
osascript << EOF
tell application "$APP"
    open POSIX file "$AI_FIXTURE"
    do javascript (read POSIX file "$TEMP_SCRIPT")
end tell
EOF

rm -f "$TEMP_SCRIPT"

# ── Wait for log ─────────────────────────────────────────────────────────────

TIMEOUT=120
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

if grep -q "\[step8a\] done |" "$LOG"; then
    echo "PASS [$STEP]: Step 8a (Simplify) completed."
else
    echo "FAIL [$STEP]: '[step8a] done |' not found in log."
    FAIL=1
fi

if grep -q "\[step8b\] done |" "$LOG"; then
    echo "PASS [$STEP]: Step 8b (Caption Normalisation) completed."
else
    echo "FAIL [$STEP]: '[step8b] done |' not found in log."
    FAIL=1
fi

if grep -q "\[pipeline\] ERROR" "$LOG"; then
    echo "FAIL [$STEP]: pipeline reported an ERROR."
    FAIL=1
fi

SIMPLIFIED=$(grep -oE "\[step8a\] done \| simplified=[0-9]+" "$LOG" | grep -oE "[0-9]+$" || echo "0")
if [ "${SIMPLIFIED:-0}" -gt 0 ]; then
    echo "PASS [$STEP]: $SIMPLIFIED cutline(s) simplified."
else
    echo "WARN [$STEP]: simplified=0 — check tolerance or that the fixture has cutlines."
fi

if [ "$FAIL" -ne 0 ]; then
    echo "  Log contents:"
    cat "$LOG"
    exit 1
fi

# ── Diff against golden file ─────────────────────────────────────────────────

strip_variable_lines() {
    grep -Ev "^\[pipeline\] (document:|=== AI_RefineCutlines (start|done))"
}

if [ ! -f "$EXPECTED" ]; then
    echo ""
    echo "NOTE [$STEP]: no golden file yet — this is expected on first run."
    echo "  Log written to: $LOG"
    echo "  Review the log. If correct, commit it as the golden file:"
    echo ""
    echo "    cp \"$LOG\" \"$EXPECTED\""
    echo "    git add \"$EXPECTED\""
    echo "    git commit -m 'Add golden output for step8'"
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
    echo "    git add \"$EXPECTED\" && git commit -m 'Update step8 golden output: <reason>'"
    exit 1
fi
