#!/bin/bash
# Integration test for Step 8c (Offset Path QA).
# Runs AI_ExportFinal.jsx against a saved post-pencil .ai and checks that 1mm
# offset paths were built and the QA flagged a deliberately-too-close pair.
#
# FIXTURE REQUIRED:
#   tests/integration/fixtures/step8c-cutlines.ai
#     A production .ai after the manual pencil pass (Cutlines layer populated with
#     named cut lines). To exercise the spacing flag, include at least one pair of
#     elements closer than 2mm. Create it by running run-step8.sh's output, then in
#     Illustrator nudging two elements together and File > Save As → this path.
#
# WHY THIS STOPS AFTER 8c:
#   AI_ExportFinal halts after Step 8c when flagged > 0 (artist must fix, then
#   re-run). A fixture with a too-close pair therefore keeps Steps 9/10 — which
#   need the shared Peeling Tab asset — out of the test path.
#
# GOLDEN FILE WORKFLOW — first run:
#   1. Run this script (SKIP diff if no golden file yet)
#   2. Verify the log looks correct (checked > 0, flagged > 0, no ERROR)
#   3. Commit: cp "$LOG" tests/integration/expected/ai-export-final-expected.txt

set -euo pipefail

STEP="ai-export-final"
APP="Adobe Illustrator"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/pipelines/AI_ExportFinal.jsx"
FIXTURE_DIR="$(cd "$(dirname "$0")" && pwd)/fixtures"
AI_FIXTURE="$FIXTURE_DIR/step8c-cutlines.ai"
EXPECTED="$(cd "$(dirname "$0")" && pwd)/expected/ai-export-final-expected.txt"

TEMP_SCRIPT="/tmp/${STEP}-test.jsx"
LOG="/tmp/AI_ExportFinal.log"

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

perl -pe 's|suppressAlerts:\s*false|suppressAlerts: true|;    s|#include "\.\./|#include "$REPO_ROOT/|g;
' "$SCRIPT" > "$TEMP_SCRIPT"

# ── Run script via osascript ─────────────────────────────────────────────────

echo "[$STEP] Opening fixture and running AfterPencil pipeline..."
osascript << EOF
tell application "$APP"
    open POSIX file "$AI_FIXTURE"
    do javascript file (POSIX file "$TEMP_SCRIPT")
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

if grep -q "\[step8c\] done |" "$LOG"; then
    echo "PASS [$STEP]: Step 8c (Offset Path QA) completed."
else
    echo "FAIL [$STEP]: '[step8c] done |' not found in log."
    FAIL=1
fi

if grep -q "\[pipeline\] ERROR | step 8c" "$LOG"; then
    echo "FAIL [$STEP]: pipeline reported an ERROR in step 8c."
    FAIL=1
fi

CHECKED=$(grep -oE "\[step8c\] done \| checked=[0-9]+" "$LOG" | grep -oE "[0-9]+$" || echo "0")
if [ "${CHECKED:-0}" -gt 0 ]; then
    echo "PASS [$STEP]: $CHECKED cut line(s) offset + checked."
else
    echo "WARN [$STEP]: checked=0 — verify the fixture has named cut lines."
fi

FLAGGED=$(grep -oE "flagged=[0-9]+" "$LOG" | head -1 | grep -oE "[0-9]+$" || echo "0")
if [ "${FLAGGED:-0}" -gt 0 ]; then
    echo "PASS [$STEP]: $FLAGGED path(s) flagged (spacing/margin) as expected."
else
    echo "WARN [$STEP]: flagged=0 — fixture may not include a too-close pair."
fi

if [ "$FAIL" -ne 0 ]; then
    echo "  Log contents:"
    cat "$LOG"
    exit 1
fi

# ── Diff against golden file ─────────────────────────────────────────────────

strip_variable_lines() {
    grep -Ev "^\[pipeline\] (document:|=== AI_ExportFinal (start|done))"
}

if [ ! -f "$EXPECTED" ]; then
    echo ""
    echo "NOTE [$STEP]: no golden file yet — this is expected on first run."
    echo "  Log written to: $LOG"
    echo "  Review the log. If correct, commit it as the golden file:"
    echo ""
    echo "    cp \"$LOG\" \"$EXPECTED\""
    echo "    git add \"$EXPECTED\""
    echo "    git commit -m 'Add golden output for ai-export-final'"
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
    echo "    git add \"$EXPECTED\" && git commit -m 'Update ai-export-final golden output: <reason>'"
    exit 1
fi
