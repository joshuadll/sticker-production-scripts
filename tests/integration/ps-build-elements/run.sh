#!/bin/bash
# Integration test for Pipeline 1 — PS_BuildElements.jsx (two-phase, both Adobe apps).
#
#   PHASE 1 (Photoshop): PS_BuildElements — Combine -> Resize -> White edge -> Group ->
#       Silhouette (Step 5) -> Export handoff (Step5b). aiPipelinePath is BLANKED so the
#       BridgeTalk is skipped here; the pipeline still writes the real sidecars
#       ({base}_silhouette.png + {base}_elements.json) next to the saved PSD. The PS log
#       is diffed against the golden (expected.txt).
#
#   PHASE 2 (Illustrator): drives the REAL handoff entry AI_BuildCutlines.buildDocAndImport
#       on Phase 1's actual sidecars -- the same function BridgeTalk invokes -- then asserts
#       Step 6 traced the cut (named>0, unmatched=0), trace tuning applied, and the working
#       .ai was saved. (Step 7A/Deepnest is Pipeline 2; not exercised here.)
#
# Decoupling the two phases (vs. letting PS BridgeTalk synchronously) avoids a headless
# deadlock: the AI-side success scriptAlert() would block Illustrator. Phase 2 runs the AI
# script with suppressAlerts:true instead.
#
# FIXTURES (committed): fixtures/source-psds/ -- >=1 source PSD with [Display Name] [STYLE-CAT] groups.
# REQUIRES: Adobe Photoshop 2026 + Adobe Illustrator.
#
# GOLDEN WORKFLOW: first run prints NOTE + skips diff. Review the PS log, then:
#   cp "$LOG_PS" "$EXPECTED"  &&  git add "$EXPECTED" && commit
# Update after an intentional change: same cp + commit with a reason.

set -euo pipefail

STEP="ps-build-elements"
APP_PS="Adobe Photoshop 2026"
APP_AI="Adobe Illustrator"

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../../.." && pwd)"
SCRIPT_PS="$REPO_ROOT/pipelines/PS_BuildElements.jsx"
SCRIPT_AI="$REPO_ROOT/pipelines/AI_BuildCutlines.jsx"
SOURCE_FIXTURE="$DIR/fixtures/source-psds"
EXPECTED="$DIR/expected.txt"

TEMP_SCRIPT_PS="/tmp/${STEP}-ps-test.jsx"
TEMP_SCRIPT_AI="/tmp/${STEP}-ai-test.jsx"
LOG_PS="/tmp/PS_BuildElements.log"
LOG_AI="/tmp/AI_BuildCutlines.log"

# Sidecars PS writes next to the saved working PSD ({folderName}.psd inside the source folder),
# and the AI-side working doc derived from them.
BASE="$(basename "$SOURCE_FIXTURE")"            # = source-psds
SILH="$SOURCE_FIXTURE/${BASE}_silhouette.png"
ELEM="$SOURCE_FIXTURE/${BASE}_elements.json"
WORKING_AI="$SOURCE_FIXTURE/${BASE}.ai"

# -- Pre-flight ---------------------------------------------------------------
if [ ! -d "$SOURCE_FIXTURE" ] || [ -z "$(ls "$SOURCE_FIXTURE"/*.psd 2>/dev/null)" ]; then
    echo "SKIP [$STEP]: source fixture folder missing or empty: $SOURCE_FIXTURE"
    exit 0
fi

# -- Clean slate UP FRONT -----------------------------------------------------
# Close all docs in both apps; clear logs + ALL generated artifacts in the fixture folder.
# The pipeline saves its working PSD as {folder}/{folder}.psd; left behind it becomes an
# extra source PSD next run (Step 1 would double every element). The AI side adds {base}.ai
# + sidecars. Wipe them so each run starts from the 3 source PSDs only.
echo "[$STEP] clean slate: closing docs in both apps + clearing artifacts..."
osascript -e 'tell application "'"$APP_PS"'" to do javascript "while (app.documents.length > 0) { app.documents[0].close(SaveOptions.DONOTSAVECHANGES); }"' >/dev/null 2>&1 || true
osascript -e 'tell application "'"$APP_AI"'" to do javascript "while (app.documents.length > 0) { app.documents[0].close(SaveOptions.DONOTSAVECHANGES); }"' >/dev/null 2>&1 || true
rm -f "$LOG_PS" "$LOG_AI" "$TEMP_SCRIPT_PS" "$TEMP_SCRIPT_AI" \
      "$SOURCE_FIXTURE/${BASE}.psd" "$SILH" "$ELEM" "$WORKING_AI" \
      "$SOURCE_FIXTURE/${BASE}_regular.svg" "$SOURCE_FIXTURE/${BASE}_irregular.svg"
rm -rf "$SOURCE_FIXTURE/${BASE}_elements"

# === PHASE 1 -- Photoshop ====================================================
# Inject: sourceFolderPath, suppressAlerts, fixed logPath, BLANK aiPipelinePath
# (skip BridgeTalk -- Phase 2 drives the AI side), absolute #include paths.
perl -pe '
    s|sourceFolderPath:\s*""|sourceFolderPath: "'"$SOURCE_FIXTURE"'"|;
    s|suppressAlerts:\s*false|suppressAlerts: true|;
    s|CONFIG\.logPath\s*=\s*_root[^;]+;|CONFIG.logPath = "'"$LOG_PS"'";|;
    s|CONFIG\.aiPipelinePath\s*=\s*_root[^;]+;|CONFIG.aiPipelinePath = "";|;
    s|#include "\.\./|#include "'"$REPO_ROOT"'/|g;
' "$SCRIPT_PS" > "$TEMP_SCRIPT_PS"

echo "[$STEP] PHASE 1 (Photoshop): running PS_BuildElements..."
osascript << EOF
tell application "$APP_PS"
    with timeout of 600 seconds
        do javascript file (POSIX file "$TEMP_SCRIPT_PS")
    end timeout
end tell
EOF

TIMEOUT=120; ELAPSED=0
until [ -f "$LOG_PS" ] || [ "$ELAPSED" -ge "$TIMEOUT" ]; do sleep 1; ELAPSED=$((ELAPSED + 1)); done
if [ ! -f "$LOG_PS" ]; then
    echo "FAIL [$STEP]: PS log not written after ${TIMEOUT}s -- script may have crashed."
    exit 1
fi

# White-edge smoothing must have run (path-level; pixel effect is invisible to a log golden).
if grep -q "^\[step2B\] smooth radius |" "$LOG_PS"; then
    echo "  PASS: white-edge smoothing active: $(grep -o '\[step2B\] smooth radius | .*' "$LOG_PS" | head -1)"
else
    echo "FAIL [$STEP]: '[step2B] smooth radius |' not found in PS log."; exit 1
fi

# Sidecars Phase 2 depends on must have landed.
if [ -f "$SILH" ] && [ -s "$SILH" ] && [ -f "$ELEM" ] && [ -s "$ELEM" ]; then
    echo "  PASS: sidecars written ($(basename "$SILH"), $(basename "$ELEM"))."
else
    echo "FAIL [$STEP]: sidecars missing -- cannot drive Phase 2 ($SILH / $ELEM)."; exit 1
fi

# === PHASE 2 -- Illustrator ==================================================
# Drive the genuine handoff entry on Phase 1's sidecars. Inject the handoff flag so the
# bottom dispatch does NOT auto-run main(); suppress alerts; log to /tmp.
perl -pe '
    s|suppressAlerts:\s*false|suppressAlerts: true|;
    s|CONFIG\.logPath\s*=\s*_root[^;]+;|CONFIG.logPath = "'"$LOG_AI"'";|;
    s|CONFIG\.peelTabAssetPathPeelHere\s*=\s*_root[^;]+;|CONFIG.peelTabAssetPathPeelHere = "'"$REPO_ROOT"'/assets/Peel_Tab_B.ai";|;
    s|CONFIG\.peelTabAssetPathSemiCircle\s*=\s*_root[^;]+;|CONFIG.peelTabAssetPathSemiCircle = "'"$REPO_ROOT"'/assets/Peel_Tab_A.ai";|;
    s|#include "\.\./|#include "'"$REPO_ROOT"'/|g;
    s|^(#target illustrator.*)|$1\n\$.global.__aiBuildCutlinesHandoff = true;|;
' "$SCRIPT_AI" > "$TEMP_SCRIPT_AI"

cat >> "$TEMP_SCRIPT_AI" << JSEOF
while (app.documents.length > 0) { app.documents[0].close(SaveOptions.DONOTSAVECHANGES); }
buildDocAndImport("$SILH", "$ELEM");
JSEOF

echo "[$STEP] PHASE 2 (Illustrator): running buildDocAndImport (Step 6)..."
osascript << EOF
tell application "$APP_AI"
    with timeout of 600 seconds
        do javascript file (POSIX file "$TEMP_SCRIPT_AI")
    end timeout
end tell
EOF

TIMEOUT=180; ELAPSED=0
until [ -f "$LOG_AI" ] || [ "$ELAPSED" -ge "$TIMEOUT" ]; do sleep 1; ELAPSED=$((ELAPSED + 1)); done
if [ ! -f "$LOG_AI" ]; then
    echo "FAIL [$STEP]: AI log not written after ${TIMEOUT}s -- script may have crashed."; exit 1
fi

FAIL=0
# Step 6 traced + named with nothing unmatched.
if grep -q "step 6 complete" "$LOG_AI" && grep -q "unmatched: 0" "$LOG_AI"; then
    echo "  PASS: Step 6 traced the cut, 0 unmatched."
else
    echo "FAIL [$STEP]: Step 6 did not complete cleanly."
    grep -E "step 6 complete|unmatched|ERROR|HALT" "$LOG_AI" || true; FAIL=1
fi
# Trace tuning applied (guards a silent fallback to the loose preset).
if grep -q "\[step6\] trace tuning | applied" "$LOG_AI" && ! grep -q "\[step6\] trace tuning | WARN" "$LOG_AI"; then
    echo "  PASS: trace tuning applied."
else
    echo "FAIL [$STEP]: trace tuning did not fully apply."
    grep -E "\[step6\] trace tuning" "$LOG_AI" || true; FAIL=1
fi
# Handoff saved the working doc (regression guard for the Untitled bug).
if grep -q "working document saved:" "$LOG_AI" && [ -f "$WORKING_AI" ]; then
    echo "  PASS: working .ai saved ($(basename "$WORKING_AI"))."
else
    echo "FAIL [$STEP]: working .ai not saved ($WORKING_AI)."; FAIL=1
fi
# Auto-warp (Illustrator-side behaviour) — size-relative roundness applied to the REAL traced
# fixture: round bases warp ("-> bend"), flat-bottomed buildings stay flat ("-> flat"). The node
# test covers the decision geometry on synthetic data; this asserts the split end-to-end. If the
# fixture art changes, update these two lists. (Pirohy = short caption on a big circle, Kraslice =
# small egg-bottom — the two the size-relative rule fixed; castles are the flat control.)
# Note: "Tatra chamois" stays FLAT — the warp samples the base edge across the CAPTION's x-span,
# so the short caption only sees a near-flat central slice (R/elW ~4.4). The art is round elsewhere;
# the decision is correctly relative to where the (short) caption connects.
WARP_EXPECT=("Pirohy" "Kraslice" "Bryndzové halušky" "Šúľance s Makom")
FLAT_EXPECT=("Bratislava Castle" "Devín Castle" "Spiš Castle" "Tatra chamois")
WARP_OK=1
for el in "${WARP_EXPECT[@]}"; do
    grep -qF "caption warp | $el -> bend" "$LOG_AI" || { echo "  FAIL: expected '$el' to WARP"; WARP_OK=0; }
done
for el in "${FLAT_EXPECT[@]}"; do
    grep -qF "caption warp | $el -> flat" "$LOG_AI" || { echo "  FAIL: expected '$el' to stay FLAT"; WARP_OK=0; }
done
if [ "$WARP_OK" -eq 1 ]; then
    echo "  PASS: auto-warp split correct (${#WARP_EXPECT[@]} round warp, ${#FLAT_EXPECT[@]} flat stay flat)."
else
    grep "caption warp |" "$LOG_AI" || true; FAIL=1
fi

# "|" line-split — Step 6 splits the display name on "|" into stacked caption lines (the frame
# NAME keeps the full string for matching). Assert the split end-to-end on the real fixture, not
# just in the node unit test: the two piped names land on 2 lines, a plain name stays on 1.
# (The "(N line(s))" suffix is emitted by Step 6's caption-text log.) Update if the fixture names change.
SPLIT_OK=1
grep -qF 'caption text | St Elizabeth'"'"'s Cathedral | (Dóm Svätej Alzbety) (2 line(s))' "$LOG_AI" \
    || { echo "  FAIL: 'St Elizabeth's Cathedral | (Dóm Svätej Alzbety)' did not split into 2 lines"; SPLIT_OK=0; }
grep -qF 'caption text | The Blue Church | Church of St. Elizabeth (2 line(s))' "$LOG_AI" \
    || { echo "  FAIL: 'The Blue Church | Church of St. Elizabeth' did not split into 2 lines"; SPLIT_OK=0; }
grep -qF 'caption text | Tatra chamois (1 line(s))' "$LOG_AI" \
    || { echo "  FAIL: 'Tatra chamois' (no pipe) was not a single line"; SPLIT_OK=0; }
if [ "$SPLIT_OK" -eq 1 ]; then
    echo "  PASS: \"|\" line-split correct (2 piped names -> 2 lines, plain name -> 1 line)."
else
    grep "caption text |" "$LOG_AI" || true; FAIL=1
fi
if [ "$FAIL" -ne 0 ]; then echo "  AI log:"; cat "$LOG_AI"; exit 1; fi

# === PHASE 1 golden diff (PS log) ============================================
strip_variable_lines() {
    grep -Ev "^\[pipeline\] (template:|source folder:|saved|=== PS_BuildElements (start|done))" \
        | grep '^\[' \
        | sed -E "s#$SOURCE_FIXTURE#<FIXTURE>#g; s#$REPO_ROOT#<REPO>#g"
}

if [ ! -f "$EXPECTED" ]; then
    echo ""
    echo "NOTE [$STEP]: no golden yet -- expected on first run."
    echo "  Review $LOG_PS, then commit it:"
    echo "    cp \"$LOG_PS\" \"$EXPECTED\" && git add \"$EXPECTED\""
    echo "PASS [$STEP]: cut traced + sidecars built (PS golden pending)."
    exit 0
fi

if diff -u <(strip_variable_lines < "$EXPECTED") <(strip_variable_lines < "$LOG_PS"); then
    echo "PASS [$STEP]: two-phase OK + PS log matches golden."
    exit 0
else
    echo "FAIL [$STEP]: PS log differs from golden (diff above)."
    echo "  If intentional: cp \"$LOG_PS\" \"$EXPECTED\" && git add \"$EXPECTED\" && commit"
    exit 1
fi
