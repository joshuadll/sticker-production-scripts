#!/bin/bash
# Integration test for AI_ExportFinal (Steps 8c → 9A → 10 → 11).
# Runs against a nested-and-normalised cutlines fixture.
#
# FIXTURE REQUIRED:
#   tests/integration/ai-export-final/fixtures/step8c-cutlines.ai
#     A post-nesting .ai (cutlines imported + captions normalised) — the state
#     the artist hands off after the manual nest loop. Set up manually.
#
# A temp copy is used so Step 11's saveAs (_final.ai) and Step 10's
# JPEG/PNG exports land in /tmp rather than the fixtures directory.
#
# GOLDEN FILE WORKFLOW — first run:
#   1. Run this script (SKIP diff if no golden file yet)
#   2. Verify the log looks correct (checked > 0, flagged > 0, no ERROR)
#   3. Commit: cp "$LOG" tests/integration/ai-export-final/expected.txt

set -euo pipefail

STEP="ai-export-final"
APP="Adobe Illustrator"

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$REPO_ROOT/pipelines/AI_ExportFinal.jsx"
FIXTURE_DIR="$(cd "$(dirname "$0")" && pwd)/fixtures"
AI_FIXTURE="$FIXTURE_DIR/step8c-cutlines.ai"
EXPECTED="$(cd "$(dirname "$0")" && pwd)/expected.txt"

TEMP_SCRIPT="/tmp/${STEP}-test.jsx"
TEMP_FIXTURE="/tmp/${STEP}-fixture.ai"
LOG="/tmp/AI_ExportFinal.log"

# ── Pre-flight ───────────────────────────────────────────────────────────────

if [ ! -f "$AI_FIXTURE" ]; then
    echo "SKIP [$STEP]: fixture not found: $AI_FIXTURE"
    echo "  Set up a post-nesting cutlines .ai at this path (see header)."
    exit 0
fi

# ── Clean slate ───────────────────────────────────────────────────────────────
rm -f "$LOG" "$TEMP_SCRIPT" "$TEMP_FIXTURE" /tmp/${STEP}-fixture_final.ai
osascript -e "tell application \"$APP\" to do javascript \"while(app.documents.length>0){app.documents[0].close(SaveOptions.DONOTSAVECHANGES);}\"" >/dev/null 2>&1 || true

cp "$AI_FIXTURE" "$TEMP_FIXTURE"

# ── Prepare temp script ──────────────────────────────────────────────────────

# NOTE: spacingThresholdMm is relaxed 2 -> 1.7 for THIS TEST ONLY (temp script), so the
# tightly-nested fixture clears the QA gate and the run exercises the full export path
# (Steps 9A -> 10 -> 11) end-to-end. Production stays at 2mm. 1.7 (not 1.8) because the
# fixture's tightest 3 gaps round to "1.8mm" but are actually just under 1.8 — 1.7 clears
# them all. This trades the "gate halts on sub-2mm spacing" assertion for end-to-end export coverage.
perl -pe 's|suppressAlerts:\s*false|suppressAlerts: true|;
          s|spacingThresholdMm:\s*2\b|spacingThresholdMm: 1.7|;
          s|#include "\.\./|#include "'"$REPO_ROOT"'/|g;
' "$SCRIPT" > "$TEMP_SCRIPT"

# ── Run script via osascript ─────────────────────────────────────────────────

echo "[$STEP] Opening fixture copy and running AI_ExportFinal..."
# 1800s: the full export (9A on 26 elements + 10 exporting 26 PNGs + 11 saving a heavy
# ~23MB .ai twice) can exceed 10min on this fixture, especially once Illustrator churn
# has degraded. A short AppleEvent timeout (-1712) would cut off the final fd.save().
osascript << EOF
tell application "$APP"
    with timeout of 1800 seconds
        open POSIX file "$TEMP_FIXTURE"
        do javascript file (POSIX file "$TEMP_SCRIPT")
    end timeout
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
    # Drop run-variable lines so the golden asserts the QA SCORING, not the drawing
    # (mirrors ai-layout-qa/run.sh): pipeline banners + advisory [timing] lines (wall
    # durations differ every run) + the overlay-drawing tally ("[step8c] overlay | drew
    # flags … | N halo(s), …"), whose counts are pixel-derived (greedy tiling + sliver
    # decimation) and would churn on a future tweak. The scoring is already asserted by
    # "[step8c] done | … spacing: N pair(s); margin: N".
    grep -Ev "^\[pipeline\] (document:|=== AI_ExportFinal (start|done))" \
        | grep -Ev "^\[timing\] " \
        | grep -Ev "^\[step8c\] overlay \| drew flags " \
        | grep '^\['
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
