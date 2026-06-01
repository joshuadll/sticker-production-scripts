#!/bin/bash
# Integration test for StepQA (Nesting Quality Index).
# Runs AI_NestingQA.jsx against a fixture .ai file and verifies that an NQI
# score is computed and logged.
#
# FIXTURE REQUIRED:
#   tests/integration/fixtures/stepQA-working.ai
#     A working .ai file that has been through Steps 6 + Deepnest import —
#     must have a "Cutlines" layer with nested PathItems/CompoundPathItems.
#     A good source: save any post-Deepnest .ai file here before running.
#
# GOLDEN FILE WORKFLOW — first run:
#   1. Run this script (SKIP diff if no golden file yet)
#   2. Verify the log shows NQI score and correct pocket count
#   3. Commit: cp "$LOG" tests/integration/expected/stepQA-expected.txt

set -euo pipefail

STEP="stepQA"
APP="Adobe Illustrator 2024"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/pipelines/AI_NestingQA.jsx"
FIXTURE_AI="$REPO_ROOT/tests/integration/fixtures/stepQA-working.ai"
EXPECTED="$REPO_ROOT/tests/integration/expected/stepQA-expected.txt"

TEMP_SCRIPT="/tmp/${STEP}-test.jsx"
LOG="/tmp/AI_NestingQA.log"

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
' "$SCRIPT" > "$TEMP_SCRIPT"

# ── Run via osascript ────────────────────────────────────────────────────────

echo "[$STEP] Opening fixture and running NQI check..."
osascript << EOF
tell application "$APP"
    set doc to open (POSIX file "$FIXTURE_AI")
    do javascript (read POSIX file "$TEMP_SCRIPT")
end tell
EOF

rm -f "$TEMP_SCRIPT"

# ── Wait for log ─────────────────────────────────────────────────────────────

TIMEOUT=90
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

if grep -q "\[stepQA\] NQI=" "$LOG"; then
    echo "PASS [$STEP]: NQI score found in log."
else
    echo "FAIL [$STEP]: '[stepQA] NQI=' not found in log."
    FAIL=1
fi

if grep -q "\[stepQA\] paths:" "$LOG"; then
    echo "PASS [$STEP]: path count found in log."
else
    echo "FAIL [$STEP]: '[stepQA] paths:' not found in log."
    FAIL=1
fi

if grep -q "\[stepQA\] grid:" "$LOG"; then
    echo "PASS [$STEP]: grid dimensions found in log."
else
    echo "FAIL [$STEP]: '[stepQA] grid:' not found in log."
    FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
    echo "  Log contents:"
    cat "$LOG"
    exit 1
fi

# ── Diff against golden file ─────────────────────────────────────────────────

strip_variable_lines() {
    grep -Ev "^\[pipeline\] (=== AI_NestingQA (start|done)|document:)"
}

if [ ! -f "$EXPECTED" ]; then
    echo ""
    echo "NOTE [$STEP]: no golden file yet — expected on first run."
    echo "  Log written to: $LOG"
    echo "  Review: NQI score, pocket count, utilization."
    echo "  If output looks correct, commit as golden file:"
    echo ""
    echo "    cp \"$LOG\" \"$EXPECTED\""
    echo "    git add \"$EXPECTED\""
    echo "    git commit -m 'Add golden output for stepQA'"
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
    echo "    git add \"$EXPECTED\" && git commit -m 'Update stepQA golden output: <reason>'"
    exit 1
fi
