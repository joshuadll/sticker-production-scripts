#!/bin/bash
# End-to-end integration test for the 2nd pipeline (PSAI_BuildAndExportCutlines).
# Drives the FULL pipeline across both apps and verifies its real deliverable —
# cutlines built and Deepnest SVGs exported — not just the silhouette handoff.
#
#   PHASE 1 (Photoshop): PSAI_BuildAndExportCutlines.jsx — Steps 3B → 5 → export
#       Produces the real sidecars next to the PSD: {name}_silhouette.png + {name}_elements.txt.
#       BridgeTalk is skipped here (aiPipelinePath blanked); Phase 2 drives the AI side
#       deterministically instead of relying on async cross-app BridgeTalk.
#
#   PHASE 2 (Illustrator): AI_BuildCutlines.jsx — Steps 6 → 7A
#       Calls the REAL handoff entry buildDocAndImport() on Phase 1's actual sidecars —
#       the same function BridgeTalk invokes — then verifies cutlines + both SVGs on disk.
#       NOTE: this deliberately does NOT hand-roll the doc save. buildDocAndImport must
#       save the working doc itself; if it regresses to an unsaved "Untitled" doc, Step 7A
#       writes to filesystem root and SVG export fails — and THIS test catches it. (The
#       former fixture-based AI-only test masked this by injecting its own saveAs; it was
#       removed in favour of this end-to-end runner, which drives the real handoff entry.)
#
# The only production path not exercised is the BridgeTalk transport itself (arg passing
# from PS to AI); everything downstream of buildDocAndImport is the real code on real input.
#
# FIXTURES REQUIRED:
#   tests/integration/fixtures/elements-captioned-ungrouped.psd
#     Output of the Pipeline 1 integration test (run-ps-build-elements.sh).
#     Contains all elements placed, resized, white-edged, and caption text layers
#     added — the exact state PSAI_BuildAndExportCutlines expects as input.
#
# REQUIRES: both Adobe Photoshop 2026 and Adobe Illustrator installed.
#
# GOLDEN FILE WORKFLOW (Phase 1 PS log only):
#   1. Run this script (SKIP diff if no golden file yet)
#   2. Verify the log looks correct (elements grouped, transient silhouette built + exported)
#   3. Commit:  cp "$LOG_PS" tests/integration/expected/psai-build-export-cutlines-expected.txt

set -euo pipefail

STEP="psai-build-export-cutlines"
APP_PS="Adobe Photoshop 2026"
APP_AI="Adobe Illustrator"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT_PS="$REPO_ROOT/pipelines/PSAI_BuildAndExportCutlines.jsx"
SCRIPT_AI="$REPO_ROOT/pipelines/AI_BuildCutlines.jsx"
FIXTURE_DIR="$(cd "$(dirname "$0")" && pwd)/fixtures"
TEMPLATE_FIXTURE="$FIXTURE_DIR/elements-captioned-ungrouped.psd"
EXPECTED="$(cd "$(dirname "$0")" && pwd)/expected/psai-build-export-cutlines-expected.txt"

TEMP_SCRIPT_PS="/tmp/${STEP}-ps-test.jsx"
TEMP_SCRIPT_AI="/tmp/${STEP}-ai-test.jsx"
TEMP_FIXTURE="/tmp/${STEP}-fixture.psd"
LOG_PS="/tmp/PSAI_BuildAndExportCutlines.log"
LOG_AI="/tmp/AI_BuildCutlines.log"

# Sidecars PSAI writes next to TEMP_FIXTURE, and the AI-side outputs derived from them.
SILH="/tmp/${STEP}-fixture_silhouette.png"
ELEM="/tmp/${STEP}-fixture_elements.json"
WORKING_AI="/tmp/${STEP}-fixture.ai"
REGULAR_SVG="/tmp/${STEP}-fixture_regular.svg"
IRREGULAR_SVG="/tmp/${STEP}-fixture_irregular.svg"

# ── Pre-flight ───────────────────────────────────────────────────────────────

if [ ! -f "$TEMPLATE_FIXTURE" ]; then
    echo "SKIP [$STEP]: fixture not found: $TEMPLATE_FIXTURE"
    echo "  Run run-ps-build-elements.sh first to produce this fixture."
    exit 0
fi

# ── Clean slate UP FRONT (not on exit) ───────────────────────────────────────
# Establish a deterministic starting state instead of tearing down afterwards. This
# is more robust: a crashed previous run can't leave us dirty, the run's outputs are
# LEFT open/on disk for inspection (demo-friendly; the NEXT run clears them), and a
# failure leaves its evidence in place for debugging. Both apps are cleaned the same
# way, so there's no PS/AI asymmetry.
#
# CAVEAT: this closes ALL open documents in both apps with DONOTSAVECHANGES — any
# UNSAVED work you have open in Photoshop or Illustrator will be discarded. Intended
# for a dedicated test/dev machine. (Use targeted-by-path closes instead if that's a
# concern — see git history for the previous fixture-only PS close.)
echo "[$STEP] clean slate: closing open docs in both apps + clearing stale /tmp artifacts..."
osascript -e 'tell application "'"$APP_PS"'" to do javascript "while (app.documents.length > 0) { app.documents[0].close(SaveOptions.DONOTSAVECHANGES); }"' >/dev/null 2>&1 || true
osascript -e 'tell application "'"$APP_AI"'" to do javascript "while (app.documents.length > 0) { app.documents[0].close(SaveOptions.DONOTSAVECHANGES); }"' >/dev/null 2>&1 || true
rm -f "$TEMP_SCRIPT_PS" "$TEMP_SCRIPT_AI" "$TEMP_FIXTURE" \
      "$SILH" "$ELEM" "$WORKING_AI" "$REGULAR_SVG" "$IRREGULAR_SVG" \
      "$LOG_PS" "$LOG_AI"

# Copy fixture so doc.save() in the pipeline doesn't corrupt the original.
cp "$TEMPLATE_FIXTURE" "$TEMP_FIXTURE"

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 1 — Photoshop: PSAI produces the real sidecars
# ═══════════════════════════════════════════════════════════════════════════════
# Patches:
#   - Suppress alerts
#   - Open the fixture PSD via app.open() injected before CONFIG (synchronous load)
#   - Blank aiPipelinePath so BridgeTalk is skipped (Phase 2 drives the AI side)
#   - Rewrite #include paths to absolute so they resolve from /tmp/

rm -f "$LOG_PS" "$TEMP_SCRIPT_PS" "$SILH" "$ELEM"

perl -pe '
    s|suppressAlerts:\s*false|suppressAlerts: true|;
    s|CONFIG\.logPath\s*=\s*_root[^;]+;|CONFIG.logPath = "'"$LOG_PS"'";|;
    s|CONFIG\.aiPipelinePath\s*=\s*_root[^;]+;|CONFIG.aiPipelinePath = "";|;
    s|(var CONFIG\s*=)|(function(){var _t=new File("'"$TEMP_FIXTURE"'");for(var _i=app.documents.length-1;_i>=0;_i--){try{if(app.documents[_i].fullName\&\&app.documents[_i].fullName.fsName===_t.fsName){app.documents[_i].close(SaveOptions.DONOTSAVECHANGES);}}catch(_e){}}})();\napp.open(new File("'"$TEMP_FIXTURE"'"));\n$1|;
    s|#include "\.\./|#include "'"$REPO_ROOT"'/|g;
' "$SCRIPT_PS" > "$TEMP_SCRIPT_PS"

echo "[$STEP] PHASE 1 (Photoshop): running PSAI..."
osascript << EOF
tell application "$APP_PS"
    with timeout of 600 seconds
        do javascript file (POSIX file "$TEMP_SCRIPT_PS")
    end timeout
end tell
EOF

# Wait for PS log.
TIMEOUT=90; ELAPSED=0
until [ -f "$LOG_PS" ] || [ "$ELAPSED" -ge "$TIMEOUT" ]; do sleep 1; ELAPSED=$((ELAPSED + 1)); done
if [ ! -f "$LOG_PS" ]; then
    echo "FAIL [$STEP]: PS log not written after ${TIMEOUT}s — script may have crashed."
    exit 1
fi

# Verify the transient silhouette was built + exported.
if grep -q "\[step5\] transient Silhouette built\." "$LOG_PS" \
   && grep -q "exported silhouette PNG (transient layer removed)" "$LOG_PS"; then
    echo "  PASS: transient Silhouette built + exported."
else
    echo "FAIL [$STEP]: expected transient-silhouette build/export lines not found in PS log."
    echo "  Log contents:"; cat "$LOG_PS"
    exit 1
fi

# Verify the sidecars Phase 2 depends on actually landed.
if [ -f "$SILH" ] && [ -s "$SILH" ] && [ -f "$ELEM" ] && [ -s "$ELEM" ]; then
    echo "  PASS: sidecars written ($(basename "$SILH"), $(basename "$ELEM"))."
else
    echo "FAIL [$STEP]: PSAI sidecars missing — cannot drive Phase 2."
    echo "  Expected: $SILH and $ELEM"
    exit 1
fi

# ── Regression: shortened/renamed caption must still bind to its element ───────
# The fixture's "National Animal - Tatra chamois [WC-IC]" element carries a caption
# whose text was shortened to "Tatra chamois" — so it no longer equals the element's
# display name. String matching (the old findTextLayerByDisplayName) silently dropped
# it (caption: null). Positional matching (findCaptionForElement) must now bind it, so
# the sidecar carries a real caption. The genuinely-uncaptioned "Bratislava(text)"
# element (no text layer at all) is the control: it must STAY caption: null, proving
# the fix doesn't fabricate captions for elements that truly have none.
python3 - "$ELEM" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
els = {e["displayName"]: e for e in data["elements"]}
ok = True
tatra = els.get("National Animal - Tatra chamois")
if tatra is None:
    print("FAIL: Tatra element missing from sidecar"); ok = False
elif tatra.get("caption") is None:
    print("FAIL: shortened-caption regression — 'National Animal - Tatra chamois' has caption: null"
          " (positional match did not bind 'Tatra chamois')"); ok = False
else:
    print("  PASS: shortened caption bound positionally (Tatra carries a caption).")
brat = els.get("Bratislava(text)")
if brat is not None and brat.get("caption") is not None:
    print("FAIL: control broken — 'Bratislava(text)' (no text layer) fabricated a caption"); ok = False
elif brat is not None:
    print("  PASS: control intact (uncaptioned Bratislava(text) stays caption-less).")
sys.exit(0 if ok else 1)
PY
if [ $? -ne 0 ]; then
    echo "FAIL [$STEP]: caption positional-matching regression (see above)."
    exit 1
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 2 — Illustrator: real handoff buildDocAndImport → cutlines + SVGs
# ═══════════════════════════════════════════════════════════════════════════════
# Patches: suppress alerts, log to /tmp, absolute includes, neutralize trailing main().
# Then call the genuine handoff entry on Phase 1's real sidecars — NO hand-rolled saveAs.

rm -f "$LOG_AI" "$TEMP_SCRIPT_AI" "$WORKING_AI" "$REGULAR_SVG" "$IRREGULAR_SVG"

# Inject the handoff flag (as production's bt.body does) so AI_BuildCutlines' bottom
# dispatch does NOT auto-run its direct-run main(); we call buildDocAndImport ourselves.
perl -pe '
    s|suppressAlerts:\s*false|suppressAlerts: true|;
    s|CONFIG\.logPath\s*=\s*_root[^;]+;|CONFIG.logPath = "'"$LOG_AI"'";|;
    s|#include "\.\./|#include "'"$REPO_ROOT"'/|g;
    s|^(#target illustrator.*)|$1\n\$.global.__aiBuildCutlinesHandoff = true;|;
' "$SCRIPT_AI" > "$TEMP_SCRIPT_AI"

cat >> "$TEMP_SCRIPT_AI" << JSEOF
// Mirror production: close leftovers, then call the genuine BridgeTalk entry point.
while (app.documents.length > 0) { app.documents[0].close(SaveOptions.DONOTSAVECHANGES); }
buildDocAndImport("$SILH", "$ELEM");
JSEOF

echo "[$STEP] PHASE 2 (Illustrator): running real buildDocAndImport handoff..."
osascript << EOF
tell application "$APP_AI"
    with timeout of 600 seconds
        do javascript file (POSIX file "$TEMP_SCRIPT_AI")
    end timeout
end tell
EOF

# Wait for AI log.
TIMEOUT=180; ELAPSED=0
until [ -f "$LOG_AI" ] || [ "$ELAPSED" -ge "$TIMEOUT" ]; do sleep 1; ELAPSED=$((ELAPSED + 1)); done
if [ ! -f "$LOG_AI" ]; then
    echo "FAIL [$STEP]: AI log not written after ${TIMEOUT}s — script may have crashed."
    exit 1
fi

FAIL=0

# Step 6: cutlines created with no unmatched paths.
if grep -q "step 6 complete" "$LOG_AI" && grep -q "unmatched: 0" "$LOG_AI"; then
    echo "  PASS: Step 6 built cutlines, 0 unmatched."
else
    echo "FAIL [$STEP]: Step 6 did not complete cleanly (unmatched paths or error)."
    grep -E "step 6 complete|unmatched|ERROR|HALT" "$LOG_AI" || true
    FAIL=1
fi

# Trace tuning must actually take effect. A silent no-op — e.g. a future Illustrator
# that renames a trace property — would fall back to the loose "Silhouettes" preset
# while every other assertion here still passes; this guards that regression.
if grep -q "\[step6\] trace tuning | applied" "$LOG_AI" \
   && ! grep -q "\[step6\] trace tuning | WARN" "$LOG_AI"; then
    echo "  PASS: trace tuning applied (no silent no-op)."
else
    echo "FAIL [$STEP]: trace tuning did not fully apply — cutlines would use the raw preset."
    grep -E "\[step6\] trace tuning|\[step6\] trace opt" "$LOG_AI" || true
    FAIL=1
fi

# The handoff must save the working doc itself (regression guard for the Untitled bug).
if grep -q "working document saved:" "$LOG_AI"; then
    echo "  PASS: buildDocAndImport saved the working document."
else
    echo "FAIL [$STEP]: buildDocAndImport did not save the working doc — Step 7A will export to root."
    FAIL=1
fi

# Step 7A: both SVGs on disk next to the sidecars, non-empty.
if [ -f "$REGULAR_SVG" ] && [ -s "$REGULAR_SVG" ]; then
    echo "  PASS: _regular.svg exported ($(wc -c < "$REGULAR_SVG" | tr -d ' ') bytes)."
else
    echo "FAIL [$STEP]: _regular.svg missing or empty — Step 7A export failed."
    FAIL=1
fi
if [ -f "$IRREGULAR_SVG" ] && [ -s "$IRREGULAR_SVG" ]; then
    echo "  PASS: _irregular.svg exported ($(wc -c < "$IRREGULAR_SVG" | tr -d ' ') bytes)."
else
    echo "FAIL [$STEP]: _irregular.svg missing or empty — Step 7A export failed."
    FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
    echo "  AI log contents:"; cat "$LOG_AI"
    exit 1
fi

# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 1 golden diff (PS log) — regression detection on the Photoshop side
# ═══════════════════════════════════════════════════════════════════════════════

strip_variable_lines() {
    grep -Ev "^\[pipeline\] (document:|=== PSAI_BuildAndExportCutlines (start|done)|saved:)"
}

if [ ! -f "$EXPECTED" ]; then
    echo ""
    echo "NOTE [$STEP]: no PS golden file yet — this is expected on first run."
    echo "  PS log written to: $LOG_PS"
    echo "  Review it. If correct, commit it as the golden file:"
    echo "    cp \"$LOG_PS\" \"$EXPECTED\""
    echo "    git add \"$EXPECTED\" && git commit -m 'Add golden output for psai-build-export-cutlines'"
    echo ""
    echo "PASS [$STEP]: cutlines built + both SVGs exported (PS golden pending)."
    exit 0
fi

if diff -u <(strip_variable_lines < "$EXPECTED") <(strip_variable_lines < "$LOG_PS"); then
    echo "PASS [$STEP]: cutlines built, both SVGs exported, PS log matches golden."
    exit 0
else
    echo "FAIL [$STEP]: PS log differs from golden (diff above)."
    echo "  If the change is intentional:"
    echo "    cp \"$LOG_PS\" \"$EXPECTED\""
    echo "    git add \"$EXPECTED\" && git commit -m 'Update psai-build-export-cutlines golden output: <reason>'"
    exit 1
fi
