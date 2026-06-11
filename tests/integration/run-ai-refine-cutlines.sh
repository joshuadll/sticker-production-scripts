#!/bin/bash
# Integration test for AI_RefineCutlines (Step 8a Simplify).
# Caption/plate spec normalisation (former Step 8b) is now its own pipeline — see
# run-ai-normalise-captions.sh.
#
# FIXTURE REQUIRED:
#   tests/integration/fixtures/resize-elements.ai
#     A nested working doc (Slovakia SKU): well-formed Cutlines groups (note +
#     outline/plate components) with the decoupled caption PNGs placed on the
#     Sticker layer — i.e. the post-Step-7B state Step 8b consumes. NOTE: this SKU
#     is all-WC, so it exercises 8b's WC caption re-anchor path (anchored=21);
#     the GC plate-reset path (normalized) is intentionally not covered here.
#
# GOLDEN FILE WORKFLOW — first run:
#   1. Run this script (SKIP diff if no golden file yet)
#   2. Verify the log looks correct (simplified > 0, no errors)
#   3. Commit: cp "$LOG" tests/integration/expected/ai-refine-cutlines-expected.txt

set -euo pipefail

STEP="ai-refine-cutlines"
APP="Adobe Illustrator"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/pipelines/AI_RefineCutlines.jsx"
FIXTURE_DIR="$(cd "$(dirname "$0")" && pwd)/fixtures"
AI_FIXTURE="$FIXTURE_DIR/resize-elements.ai"
EXPECTED="$(cd "$(dirname "$0")" && pwd)/expected/ai-refine-cutlines-expected.txt"

TEMP_SCRIPT="/tmp/${STEP}-test.jsx"
LOG="/tmp/AI_RefineCutlines.log"

# ── Pre-flight ───────────────────────────────────────────────────────────────

if [ ! -f "$AI_FIXTURE" ]; then
    echo "SKIP [$STEP]: fixture not found: $AI_FIXTURE"
    echo "  Expected the committed resize-elements.ai fixture in tests/integration/fixtures/."
    exit 0
fi

# ── Clean slate ───────────────────────────────────────────────────────────────
rm -f "$LOG" "$TEMP_SCRIPT"
osascript -e "tell application \"$APP\" to do javascript \"while(app.documents.length>0){app.documents[0].close(SaveOptions.DONOTSAVECHANGES);}\"" >/dev/null 2>&1 || true

# ── Prepare temp script ──────────────────────────────────────────────────────

perl -pe 's|suppressAlerts:\s*false|suppressAlerts: true|;
          s|#include "\.\./|#include "'"$REPO_ROOT"'/|g;
' "$SCRIPT" > "$TEMP_SCRIPT"

# ── Run script via osascript ─────────────────────────────────────────────────

echo "[$STEP] Opening fixture and running AI_RefineCutlines..."
osascript << EOF
tell application "$APP"
    with timeout of 300 seconds
        open POSIX file "$AI_FIXTURE"
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

if grep -q "\[step8a\] done |" "$LOG"; then
    echo "PASS [$STEP]: Step 8a (Simplify) completed."
else
    echo "FAIL [$STEP]: '[step8a] done |' not found in log."
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
    echo "    git commit -m 'Add golden output for ai-refine-cutlines'"
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
    echo "    git add \"$EXPECTED\" && git commit -m 'Update ai-refine-cutlines golden output: <reason>'"
    exit 1
fi
