#!/bin/bash
# Integration test for AI_NormaliseCaptions (standalone caption/plate spec normalise,
# the former Step 8b — now its own re-runnable pipeline for the manual nest loop).
#
# FIXTURE REQUIRED:
#   tests/integration/ai-normalise-captions/fixtures/resize-elements.ai
#     A nested working doc (Slovakia SKU) with well-formed Cutlines groups (note +
#     outline/plate) and the decoupled caption PNGs placed on the Sticker layer at
#     varied off-spec scales — i.e. the post-manual-resize state this pipeline corrects.
#     NOTE: this SKU is all-WC, so it exercises the WC curved-capsule reset path; the GC
#     parametric plate-reset path is intentionally not covered here.
#
# WHAT IT CHECKS:
#   1. Run #1 resets every caption to absolute spec (reset > 0, no errors).
#   2. Run #2 on the already-normalised doc is a no-op (every unscale factor x1.000) —
#      proves the pipeline is idempotent / safe to loop.
#   3. Run #1 log matches the golden file.
#
# GOLDEN FILE WORKFLOW — first run:
#   1. Run this script (SKIP diff if no golden file yet)
#   2. Verify the log looks correct (reset > 0, no errors)
#   3. Commit: cp /tmp/normalise-captions-run1.log \
#               tests/integration/ai-normalise-captions/expected.txt

set -euo pipefail

STEP="ai-normalise-captions"
APP="Adobe Illustrator"

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$REPO_ROOT/pipelines/AI_NormaliseCaptions.jsx"
FIXTURE_DIR="$(cd "$(dirname "$0")" && pwd)/fixtures"
AI_FIXTURE="$FIXTURE_DIR/resize-elements.ai"
EXPECTED="$(cd "$(dirname "$0")" && pwd)/expected.txt"

TEMP_SCRIPT="/tmp/${STEP}-test.jsx"
LOG="/tmp/AI_NormaliseCaptions.log"
RUN1="/tmp/normalise-captions-run1.log"
RUN2="/tmp/normalise-captions-run2.log"

# ── Pre-flight ───────────────────────────────────────────────────────────────

if [ ! -f "$AI_FIXTURE" ]; then
    echo "SKIP [$STEP]: fixture not found: $AI_FIXTURE"
    echo "  Expected the committed resize-elements.ai fixture in tests/integration/ai-normalise-captions/fixtures/."
    exit 0
fi

# ── Clean slate ───────────────────────────────────────────────────────────────
rm -f "$LOG" "$RUN1" "$RUN2" "$TEMP_SCRIPT"
osascript -e "tell application \"$APP\" to do javascript \"while(app.documents.length>0){app.documents[0].close(SaveOptions.DONOTSAVECHANGES);}\"" >/dev/null 2>&1 || true

# ── Prepare temp script ──────────────────────────────────────────────────────

perl -pe 's|suppressAlerts:\s*false|suppressAlerts: true|;
          s|#include "\.\./|#include "'"$REPO_ROOT"'/|g;
' "$SCRIPT" > "$TEMP_SCRIPT"

# ── Run #1: open fixture, normalise (resets off-spec captions) ────────────────

echo "[$STEP] Run #1 — opening fixture and normalising..."
osascript << EOF
tell application "$APP"
    with timeout of 300 seconds
        open POSIX file "$AI_FIXTURE"
        do javascript file (POSIX file "$TEMP_SCRIPT")
    end timeout
end tell
EOF
sleep 1
[ -f "$LOG" ] && cp "$LOG" "$RUN1"

# ── Run #2: re-run on the still-open, now-normalised doc (idempotency) ─────────

rm -f "$LOG"
echo "[$STEP] Run #2 — re-running on normalised doc (idempotency check)..."
osascript -e "tell application \"$APP\" to do javascript file (POSIX file \"$TEMP_SCRIPT\")" >/dev/null 2>&1 || true
sleep 1
[ -f "$LOG" ] && cp "$LOG" "$RUN2"

rm -f "$TEMP_SCRIPT"

# ── Verify logs exist ─────────────────────────────────────────────────────────

if [ ! -f "$RUN1" ] || [ ! -f "$RUN2" ]; then
    echo "FAIL [$STEP]: a run produced no log — script may have crashed."
    exit 1
fi

# ── Assertions ────────────────────────────────────────────────────────────────

FAIL=0

if grep -q "\[pipeline\] ERROR" "$RUN1" "$RUN2"; then
    echo "FAIL [$STEP]: pipeline reported an ERROR."
    FAIL=1
fi

RESET=$(grep -oE "\[step8b\] done \| reset=[0-9]+" "$RUN1" | grep -oE "[0-9]+$" || echo "0")
if [ "${RESET:-0}" -gt 0 ]; then
    echo "PASS [$STEP]: run #1 reset $RESET off-spec caption(s) to spec."
else
    echo "FAIL [$STEP]: run #1 reset=0 — nothing normalised (check fixture has off-spec captions)."
    FAIL=1
fi

# Idempotency: run #2 on the already-normalised doc must reset NOTHING (every caption
# now reports "at spec"). reset=0 on the second pass proves the pass is a safe no-op.
RESET2=$(grep -oE "\[step8b\] done \| reset=[0-9]+" "$RUN2" | grep -oE "[0-9]+$" || echo "-1")
ATSPEC2=$(grep -oE "atSpec=[0-9]+" "$RUN2" | grep -oE "[0-9]+$" || echo "0")
if [ "$RESET2" -eq 0 ] && [ "$ATSPEC2" -gt 0 ]; then
    echo "PASS [$STEP]: run #2 idempotent (reset=0, atSpec=$ATSPEC2)."
else
    echo "FAIL [$STEP]: run #2 not idempotent — reset=$RESET2, atSpec=$ATSPEC2 (expected reset=0)."
    FAIL=1
fi

# ── Sliver-removal assertion: the cleanup fired during a re-derive, and did NOT spuriously
#    re-fire on the idempotent second pass (nothing re-derived → nothing to remove). The exact
#    per-element counts are pinned by the golden below; this just guards the fire/no-refire shape.
FIRED1=$(grep -c "\[cutline\] junction slivers removed" "$RUN1" || true)
FIRED2=$(grep -c "\[cutline\] junction slivers removed" "$RUN2" || true)
if [ "${FIRED1:-0}" -gt 0 ]; then
    echo "PASS [$STEP]: sliver cleanup fired on $FIRED1 re-derived element(s) in run #1."
else
    echo "FAIL [$STEP]: run #1 logged no '[cutline] junction slivers removed' — cleanup never ran."; FAIL=1
fi
if [ "${FIRED2:-0}" -eq 0 ]; then
    echo "PASS [$STEP]: idempotent — run #2 re-derived nothing, removed no slivers."
else
    echo "FAIL [$STEP]: run #2 re-fired sliver removal ($FIRED2) — not idempotent."; FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
    echo "  Run #1 log:"; cat "$RUN1"
    echo "  Run #2 log:"; cat "$RUN2"
    exit 1
fi

# ── Diff run #1 against golden file ───────────────────────────────────────────

strip_variable_lines() {
    # Also drop the per-element [seat]/[halfcut] lines (absolute, pixel-level coordinates):
    # the seat/half-cut geometry is asserted by the dedicated unit tests, and the reset/atSpec
    # COUNTS are still checked by the "[step8b] done | reset=N" line below.
    grep -Ev "^(\[pipeline\] (document:|=== AI_NormaliseCaptions (start|done))|\[seat\]|\[seatdbg\]|\[halfcut\])" \
        | grep '^\['
}

if [ ! -f "$EXPECTED" ]; then
    echo ""
    echo "NOTE [$STEP]: no golden file yet — this is expected on first run."
    echo "  Run #1 log: $RUN1"
    echo "  Review it. If correct, commit it as the golden file:"
    echo ""
    echo "    cp \"$RUN1\" \"$EXPECTED\""
    echo "    git add \"$EXPECTED\""
    echo "    git commit -m 'Add golden output for ai-normalise-captions'"
    echo ""
    exit 0
fi

if diff -u <(strip_variable_lines < "$EXPECTED") <(strip_variable_lines < "$RUN1"); then
    echo "PASS [$STEP]"
    exit 0
else
    echo "FAIL [$STEP]: output differs from golden file (diff above)."
    echo "  If the change is intentional:"
    echo "    cp \"$RUN1\" \"$EXPECTED\""
    echo "    git add \"$EXPECTED\" && git commit -m 'Update ai-normalise-captions golden output: <reason>'"
    exit 1
fi
