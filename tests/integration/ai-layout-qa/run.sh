#!/bin/bash
# Integration test for AI_LayoutQA — the independent, re-runnable layout QA that
# consolidates Spacing+Margin QA (Step 8c) and Nesting Quality (NQI / StepQA).
# Runs AI_LayoutQA.jsx against a fixture .ai and verifies BOTH phases log:
#   • Spacing+Margin — [step8c] collected / done
#   • Nesting Quality — [stepQA] NQI= / paths: / grid:
#
# FIXTURE REQUIRED (local-only — *.ai is gitignored, so it never leaves your Mac):
#   tests/integration/ai-layout-qa/fixtures/quality-check.ai
#     A working .ai file that has been through Steps 6 + Deepnest import —
#     must have a "Cutlines" layer with nested PathItems/CompoundPathItems.
#
# GOLDEN FILE WORKFLOW — first run:
#   1. Run this script (SKIP diff if no golden file yet)
#   2. Verify the log shows the spacing/margin counts AND the NQI score/pockets
#   3. Commit: cp "$LOG" tests/integration/ai-layout-qa/expected.txt

set -euo pipefail

STEP="ai-layout-qa"
APP="Adobe Illustrator"

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$REPO_ROOT/pipelines/AI_LayoutQA.jsx"
FIXTURE_AI="$(cd "$(dirname "$0")" && pwd)/fixtures/quality-check.ai"
EXPECTED="$(cd "$(dirname "$0")" && pwd)/expected.txt"

TEMP_SCRIPT="/tmp/${STEP}-test.jsx"
LOG="/tmp/AI_LayoutQA.log"

# ── Pre-flight ───────────────────────────────────────────────────────────────

if [ ! -f "$FIXTURE_AI" ]; then
    echo "SKIP [$STEP]: fixture not found: $FIXTURE_AI"
    echo "  See script header for fixture creation instructions."
    exit 0
fi

# ── Prepare patched script ───────────────────────────────────────────────────
# Disable alerts and overlay so the script runs non-interactively.

rm -f "$LOG" "$TEMP_SCRIPT"

perl -pe '
    s|suppressAlerts:\s*false|suppressAlerts: true|;
    s|showOverlay:\s*true|showOverlay: false|;
    s|#include "\.\./|#include "'"$REPO_ROOT"'/|g;
' "$SCRIPT" > "$TEMP_SCRIPT"

# ── Run via osascript ────────────────────────────────────────────────────────

echo "[$STEP] Opening fixture and running Layout QA (spacing/margin + NQI)..."
osascript << EOF
tell application "$APP"
    set doc to open (POSIX file "$FIXTURE_AI")
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

# ── Verify key log lines (both phases) ───────────────────────────────────────

FAIL=0
check_line() {
    # $1 = grep pattern, $2 = human description
    if grep -q "$1" "$LOG"; then
        echo "PASS [$STEP]: $2"
    else
        echo "FAIL [$STEP]: '$1' not found in log ($2)."
        FAIL=1
    fi
}

# Phase 1 — Spacing + Margin QA.
check_line "\[step8c\] collected" "spacing/margin collected cut lines"
check_line "\[step8c\] done"      "spacing/margin completed"
# Phase 2 — Nesting Quality.
check_line "\[stepQA\] NQI="      "NQI score computed"
check_line "\[stepQA\] paths:"    "NQI path count"
check_line "\[stepQA\] sheet:.*grid:" "NQI grid dimensions"

if [ "$FAIL" -ne 0 ]; then
    echo "  Log contents:"
    cat "$LOG"
    exit 1
fi

# ── Diff against golden file ─────────────────────────────────────────────────

strip_variable_lines() {
    # Drop run-variable lines: pipeline banners + the advisory [timing] lines (wall
    # durations differ every run by design — they measure, they don't assert).
    grep -Ev "^\[pipeline\] (=== AI_LayoutQA (start|done)|document:)" \
        | grep -Ev "^\[timing\] " \
        | grep '^\['
}

if [ ! -f "$EXPECTED" ]; then
    echo ""
    echo "NOTE [$STEP]: no golden file yet — expected on first run."
    echo "  Log written to: $LOG"
    echo "  Review: spacing/margin flagged count, NQI score, pocket count, utilization."
    echo "  If output looks correct, commit as golden file:"
    echo ""
    echo "    cp \"$LOG\" \"$EXPECTED\""
    echo "    git add \"$EXPECTED\""
    echo "    git commit -m 'Add golden output for ai-layout-qa'"
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
    echo "    git add \"$EXPECTED\" && git commit -m 'Update ai-layout-qa golden output: <reason>'"
    exit 1
fi
