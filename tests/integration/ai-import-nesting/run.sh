#!/bin/bash
# Integration test for Step 7B (Nesting Import) via the AI_ImportNesting pipeline.
# Opens a saved working .ai (Step-6 cutlines) and runs AI_ImportNesting against
# Deepnest output SVGs, asserting every cutline matched (unmatched=0) and artwork
# placed. Matching is area-only and runs headless via auto-discovery (suppressAlerts).
#
# FIXTURE (committed — the real Slovakia SKU, the recurring rotation/overlap regression
# case). Lives in its own folder, named by the {base} convention so the pipeline's
# auto-discovery finds the siblings next to the .ai (see _findNestedSvgs/_findElementsFolder):
#   tests/integration/ai-import-nesting/fixtures/import-nesting/import-nesting.ai
#       Working .ai right after Step 6 (Cutlines layer populated, Sticker layer present).
#   tests/integration/ai-import-nesting/fixtures/import-nesting/import-nesting_regular_nested.svg
#   tests/integration/ai-import-nesting/fixtures/import-nesting/import-nesting_irregular_nested.svg
#       Real Deepnest output (the nested layouts).
#   tests/integration/ai-import-nesting/fixtures/import-nesting/import-nesting_elements/
#       Per-element art + caption PNGs, names matching the cutline display names.
#   tests/integration/ai-import-nesting/fixtures/import-nesting/import-nesting_elements.json
#       PSAI sidecar (psdWidth → absolute art-sizing factor).
# These are force-tracked via a .gitignore exception (the global *.ai / fixtures/* rules
# would otherwise skip them). Regenerate from a real run: run-psai-build-export-cutlines.sh
# produces the .ai + _elements; nest its two SVGs in Deepnest, save as the *_nested.svg names.

set -euo pipefail

STEP="ai-import-nesting"
APP="Adobe Illustrator"

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$REPO_ROOT/pipelines/AI_ImportNesting.jsx"
FIXTURE_DIR="$(cd "$(dirname "$0")" && pwd)/fixtures/import-nesting"
AI_FIXTURE="$FIXTURE_DIR/import-nesting.ai"

TEMP_SCRIPT="/tmp/${STEP}-test.jsx"
LOG="/tmp/AI_ImportNesting.log"
EXPECTED="$(cd "$(dirname "$0")" && pwd)/expected.txt"

# Golden normaliser: drop the machine-specific / volatile lines (absolute fixture
# paths + start/done banners). Everything kept is deterministic given the fixed
# fixtures (parts read, per-element ART-FIT/VERIFY, group rotation, contour-fit,
# result) — the fixtures are stable committed inputs and the test never saves the
# .ai, so each run starts from the same upright-cutline state.
strip_variable_lines() {
    # Also drop the per-element [seat]/[halfcut] lines: they carry absolute bezier-sample
    # coordinates (pixel-level, fixture-position-dependent) — the geometry they describe is
    # asserted by the dedicated unit tests (test-ai-caption-seat, test-halfcut-alignment),
    # and the COUNTS are still checked by the "half-cut sync | N" / "result | matched" lines.
    grep -Ev "^(\[pipeline\] === AI_ImportNesting (start|done) ===|\[pipeline\] (document|SVG|art folder):|Log: |\[seat\]|\[seatdbg\]|\[halfcut\])" \
        | grep '^\['
}

# ── Pre-flight ───────────────────────────────────────────────────────────────

if [ ! -f "$AI_FIXTURE" ]; then
    echo "SKIP [$STEP]: fixture not found: $AI_FIXTURE"
    echo "  See script header for fixture creation instructions."
    exit 0
fi
if [ ! -f "$FIXTURE_DIR/import-nesting_regular_nested.svg" ] \
   && [ ! -f "$FIXTURE_DIR/import-nesting_irregular_nested.svg" ]; then
    echo "SKIP [$STEP]: no *_nested.svg fixtures next to $AI_FIXTURE"
    exit 0
fi

# ── Prepare temp script ──────────────────────────────────────────────────────
# Suppress alerts (auto-discovery accepts the {base}_*_nested.svg + {base}_elements
# siblings without dialogs) and rewrite #include paths + logPath for the headless run.

rm -f "$LOG" "$TEMP_SCRIPT"

# verifyOverlaps: true keeps the all-pairs overlap sweep ON for the test — it is the
# rotation-recovery regression guard the assertions below depend on (overlaps=0). It is
# OFF in the shipped CONFIG (interactive artist run skips it for speed; Step 8c gates
# overlap at export). So the test must re-enable it, exactly like suppressAlerts.
perl -pe 's|suppressAlerts:\s*false|suppressAlerts: true|;
          s|verifyOverlaps:\s*false|verifyOverlaps: true|;
          s|#include "\.\./|#include "'"$REPO_ROOT"'/|g;
          s|CONFIG\.logPath\s*=\s*_root[^;]+;|CONFIG.logPath = "'"$LOG"'";|;' \
    "$SCRIPT" > "$TEMP_SCRIPT"

# ── Run via osascript ────────────────────────────────────────────────────────
# Open the fixture with alerts suppressed (avoids the AppleScript `open` dialog),
# then run the pipeline file (which processes #include, unlike $.evalFile).

echo "[$STEP] Opening fixture and running AI_ImportNesting..."
osascript -e 'with timeout of 600 seconds' \
  -e "tell application \"$APP\"" \
  -e "do javascript \"app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS; while(app.documents.length>0){app.documents[0].close(SaveOptions.DONOTSAVECHANGES);} app.open(new File('$AI_FIXTURE'));\"" \
  -e "do javascript file (POSIX file \"$TEMP_SCRIPT\")" \
  -e 'end tell' -e 'end timeout'

rm -f "$TEMP_SCRIPT"

# ── Wait for log ─────────────────────────────────────────────────────────────

TIMEOUT=180
ELAPSED=0
until { [ -f "$LOG" ] && grep -q "\[step-nest\] result \|\[pipeline\] FATAL\|cannot resolve" "$LOG"; } \
      || [ "$ELAPSED" -ge "$TIMEOUT" ]; do
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done

if [ ! -f "$LOG" ]; then
    echo "FAIL [$STEP]: log not written after ${TIMEOUT}s — script may have crashed."
    exit 1
fi

# ── Verify ───────────────────────────────────────────────────────────────────

FAIL=0

if grep -q "\[pipeline\] FATAL" "$LOG"; then
    echo "FAIL [$STEP]: pipeline reported FATAL."
    FAIL=1
fi

RESULT_LINE=$(grep "\[step-nest\] result |" "$LOG" || true)
if [ -z "$RESULT_LINE" ]; then
    echo "FAIL [$STEP]: no result line in log."
    FAIL=1
else
    # Leading space on " matched" avoids also matching the "matched: 0" inside "unmatched: 0".
    MATCHED=$(echo "$RESULT_LINE"   | grep -oE " matched: [0-9]+"  | grep -oE "[0-9]+")
    UNMATCHED=$(echo "$RESULT_LINE" | grep -oE "unmatched: [0-9]+" | grep -oE "[0-9]+")
    ART=$(echo "$RESULT_LINE"       | grep -oE "art placed: [0-9]+"| grep -oE "[0-9]+")
    echo "[$STEP] matched=$MATCHED unmatched=$UNMATCHED art=$ART"

    if [ "${MATCHED:-0}" -gt 0 ]; then
        echo "PASS [$STEP]: $MATCHED cutline(s) matched."
    else
        echo "FAIL [$STEP]: 0 cutlines matched."
        FAIL=1
    fi
    if [ "${UNMATCHED:-1}" -eq 0 ]; then
        echo "PASS [$STEP]: no unmatched parts."
    else
        echo "FAIL [$STEP]: $UNMATCHED unmatched part(s)."
        FAIL=1
    fi
    if [ "${ART:-0}" -gt 0 ]; then
        echo "PASS [$STEP]: $ART artwork PNG(s) placed."
    else
        echo "WARN [$STEP]: art placed=0 — check the {base}_elements PNG names match cutline display names."
    fi

    # Rotation correctness: each placed cutline is the SAME polygon as its SVG part,
    # so its bounding box must match (logged as VERIFY ... ROTATION WRONG on mismatch).
    # This is the objective guard against the rotation-recovery regression.
    WRONG=$(grep -c "ROTATION WRONG" "$LOG" || true)
    if [ "${WRONG:-0}" -eq 0 ]; then
        echo "PASS [$STEP]: all rotations verified (cutline bbox matches SVG part)."
    else
        echo "FAIL [$STEP]: $WRONG element(s) placed at the wrong rotation:"
        grep "ROTATION WRONG" "$LOG"
        FAIL=1
    fi

    # Overlap correctness (the bug this guards): no two finished cut lines may intersect.
    # The bbox VERIFY above is blind to a few-degree rotation of a near-square shape, so a
    # placement/rotation error can pass VERIFY yet still cross a neighbour. _nestDetectOverlaps
    # logs "*** CUTLINE OVERLAP ***" per intersecting pair + an "overlap-check | N" summary.
    if grep -q "\[step-nest\] overlap-check" "$LOG"; then
        if grep -q "CUTLINE OVERLAP" "$LOG"; then
            echo "FAIL [$STEP]: finished cut lines overlap:"
            grep "CUTLINE OVERLAP" "$LOG"
            FAIL=1
        else
            echo "PASS [$STEP]: no cut-line overlaps."
        fi
    fi

    # Art-layer correctness: artwork must land on the Stickers layer, not Cutlines.
    if grep -q "ART ON WRONG LAYER" "$LOG"; then
        echo "FAIL [$STEP]: artwork landed on the wrong layer:"
        grep "art-layer-check" "$LOG"
        FAIL=1
    else
        echo "PASS [$STEP]: artwork on Stickers layer."
    fi

    # Art-POSITION correctness: each art item must ride the nest transform WITH its cutline
    # and stay co-located. ART-FIT (size) + VERIFY (cutline bbox) + art-layer-check (count) are
    # all blind to a detached art item that keeps the right size on the right layer but sits far
    # from its cutline — exactly the failure mode when the embed/reference handling is wrong.
    if grep -q "ART MISPLACED" "$LOG"; then
        echo "FAIL [$STEP]: art detached from its cutline (rode the wrong reference):"
        grep "art-pos-check" "$LOG"
        FAIL=1
    else
        echo "PASS [$STEP]: art co-located with cutlines."
        grep "art-pos-check" "$LOG" || true
    fi

    # Group-rotation correctness: the regular cluster's −90° rotation must transpose
    # its bbox (W↔H). A failure means elements spun in place instead of orbiting the
    # pivot, so the group never actually rotated to its top-left landscape band.
    if grep -q "GROUP ROTATION DID NOT TRANSPOSE" "$LOG"; then
        echo "FAIL [$STEP]: regular group did not rotate as a cluster:"
        grep "group-rot-check" "$LOG"
        FAIL=1
    else
        echo "PASS [$STEP]: regular group rotated −90° (bbox transposed)."
    fi

    # Art-fit (the actual bug under test): art and cutline are the SAME element, so
    # their bounding boxes must agree closely once art is at its true size. Under the
    # old height-fit, height matched but width could be far off; the absolute factor
    # makes both agree (residual = Image-Trace inset + plate-vs-render). Print every
    # element so the layout can be eyeballed, and fail on any gross divergence.
    echo "[$STEP] --- per-element art-vs-cutline fit (dW/dH in pt) ---"
    grep "ART-FIT |" "$LOG" || echo "  (no ART-FIT lines)"
    WORST=$(grep "ART-FIT |" "$LOG" | grep -oE "dW=-?[0-9]+ dH=-?[0-9]+" \
        | grep -oE -- "-?[0-9]+" \
        | awk '{a=($1<0?-$1:$1); if(a>m)m=a} END{print m+0}')
    echo "[$STEP] worst |dW or dH| = ${WORST}pt"
    # Tolerance 10pt: comfortably above the observed worst (a ~5pt caption-height
    # residual on long-caption WC elements, the known plate-vs-render gap) yet well
    # below a sizing regression (height-fit mis-scales by tens of pt).
    ARTFIT_TOL=10
    if [ "${WORST:-9999}" -le "$ARTFIT_TOL" ]; then
        echo "PASS [$STEP]: art fits cutline within ${ARTFIT_TOL}pt for all elements."
    else
        echo "FAIL [$STEP]: art/cutline mismatch exceeds ${ARTFIT_TOL}pt (worst ${WORST}pt)."
        FAIL=1
    fi
fi

# ── Golden diff ──────────────────────────────────────────────────────────────
# Regression guard on the full deterministic log (placement, rotations, art-fit,
# contour-fit). Stale only when the fixtures are deliberately re-nested — then
# refresh the golden, exactly like the P2 PSD workflow.
if [ ! -f "$EXPECTED" ]; then
    strip_variable_lines < "$LOG" > "$EXPECTED"
    echo "NOTE [$STEP]: no golden file yet — wrote one from this run:"
    echo "    $EXPECTED"
    echo "  Review it, then commit it as the golden file."
elif diff -u <(strip_variable_lines < "$EXPECTED") <(strip_variable_lines < "$LOG"); then
    echo "PASS [$STEP]: log matches golden."
else
    strip_variable_lines < "$LOG" > "$EXPECTED.new"
    echo "FAIL [$STEP]: log differs from golden (diff above)."
    echo "  If the change is intentional (e.g. fixtures re-nested), accept this run's log:"
    echo "    cp \"$EXPECTED.new\" \"$EXPECTED\""
    FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
    echo "  Log contents:"
    cat "$LOG"
    exit 1
fi

echo "PASS [$STEP]"
exit 0
