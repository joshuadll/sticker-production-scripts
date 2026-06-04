#!/bin/bash
# Integration test for the AI half of the 2nd pipeline (PSAI_BuildAndExportCutlines):
# Steps 6 (Create Cut Lines) + 7A (Deepnest SVG Export).
#
# Runs AI_BuildCutlines.jsx against a pre-exported silhouette PNG + elements sidecar.
# The working document is built from scratch by buildWorkingDocument() (aiUtils.jsx),
# saved to a temp .ai path so Step 7A can resolve a real output path, then the two
# SVG files are verified on disk.
#
# FIXTURES REQUIRED:
#   tests/integration/fixtures/step6-silhouette.png
#     A flat black PNG of a silhouette layer from a real Resize Area PSD.
#     Export by running PSAI_BuildAndExportCutlines.jsx on a captioned fixture PSD
#     and copying the generated *_silhouette.png file here.
#
#   tests/integration/fixtures/step6-elements.txt
#     The elements sidecar for the matching PSD.
#     Copy the generated *_elements.txt file here.
#
# GOLDEN FILE WORKFLOW — first run:
#   1. Run this script (SKIP diff if no golden file yet)
#   2. Verify the log looks correct (named paths, no unmatched, SVGs exported)
#   3. Commit: cp "$LOG" tests/integration/expected/ai-build-cutlines-expected.txt

set -euo pipefail

STEP="ai-build-cutlines"
APP="Adobe Illustrator"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/pipelines/AI_BuildCutlines.jsx"
FIXTURE_DIR="$(cd "$(dirname "$0")" && pwd)/fixtures"
PNG_FIXTURE="$FIXTURE_DIR/step6-silhouette.png"
ELEMENTS_FIXTURE="$FIXTURE_DIR/step6-elements.txt"
EXPECTED="$(cd "$(dirname "$0")" && pwd)/expected/ai-build-cutlines-expected.txt"

TEMP_SCRIPT="/tmp/${STEP}-test.jsx"
LOG="/tmp/AI_BuildCutlines.log"
TEMP_AI="/tmp/${STEP}-working.ai"
REGULAR_SVG="/tmp/${STEP}-working_regular.svg"
IRREGULAR_SVG="/tmp/${STEP}-working_irregular.svg"

# ── Pre-flight ───────────────────────────────────────────────────────────────

for FIXTURE in "$PNG_FIXTURE" "$ELEMENTS_FIXTURE"; do
    if [ ! -f "$FIXTURE" ]; then
        echo "SKIP [$STEP]: fixture not found: $FIXTURE"
        echo "  See script header for fixture creation instructions."
        exit 0
    fi
done

# ── Prepare temp script ──────────────────────────────────────────────────────
# Inject fixture paths and suppress alerts.

rm -f "$LOG" "$TEMP_SCRIPT" "$TEMP_AI" "$REGULAR_SVG" "$IRREGULAR_SVG"

perl -pe '
    s|suppressAlerts:\s*false|suppressAlerts: true|;
    s|CONFIG\.logPath\s*=\s*_root[^;]+;|CONFIG.logPath = "/tmp/AI_BuildCutlines.log";|;
    s|#include "\.\./|#include "'"$REPO_ROOT"'/|g;
    s|^main\(\);||;
' "$SCRIPT" > "$TEMP_SCRIPT"

# Append step-by-step entry so the document is saved to a known path before
# Step 7A runs — otherwise doc.fullName resolves to an unusable Untitled path
# and the SVG export fails silently.
cat >> "$TEMP_SCRIPT" << JSEOF
// Close any documents left open from a previous run so main() has nothing to act on.
while (app.documents.length > 0) {
    app.documents[0].close(SaveOptions.DONOTSAVECHANGES);
}
var _doc = buildWorkingDocument();
runCreateCutlines(_doc, "$PNG_FIXTURE", "$ELEMENTS_FIXTURE");
var _prevLevel = app.userInteractionLevel;
app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
_doc.saveAs(new File("$TEMP_AI"), new IllustratorSaveOptions());
app.userInteractionLevel = _prevLevel;
_runExportForNesting(_doc);
JSEOF

# ── Run script via osascript ─────────────────────────────────────────────────

echo "[$STEP] Opening template and running cutlines script..."
osascript << EOF
tell application "$APP"
    with timeout of 600 seconds
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

if grep -q "\[step6\] created Cutlines layer" "$LOG" || grep -q "\[step6\] placed silhouette PNG" "$LOG"; then
    echo "PASS [$STEP]: Cutlines layer created / PNG placed."
else
    echo "FAIL [$STEP]: Cutlines layer or PNG placement not found in log."
    FAIL=1
fi

if grep -q "\[step6\] done |" "$LOG"; then
    echo "PASS [$STEP]: Step 6 completed."
else
    echo "FAIL [$STEP]: '[step6] done |' not found in log."
    FAIL=1
fi

if grep -q "unmatched=0" "$LOG"; then
    echo "PASS [$STEP]: No unmatched paths."
else
    UNMATCHED=$(grep "unmatched=" "$LOG" | tail -1)
    echo "WARN [$STEP]: unmatched paths found — $UNMATCHED"
    echo "  This may indicate a coordinate transform issue. Review the log."
fi

if [ -f "$REGULAR_SVG" ] && [ -s "$REGULAR_SVG" ]; then
    echo "PASS [$STEP]: _regular.svg created and non-empty."
else
    echo "FAIL [$STEP]: _regular.svg missing or empty — Step 7A export failed."
    FAIL=1
fi

if [ -f "$IRREGULAR_SVG" ] && [ -s "$IRREGULAR_SVG" ]; then
    echo "PASS [$STEP]: _irregular.svg created and non-empty."
else
    echo "FAIL [$STEP]: _irregular.svg missing or empty — Step 7A export failed."
    FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then
    echo "  Log contents:"
    cat "$LOG"
    exit 1
fi

# ── Diff against golden file ─────────────────────────────────────────────────

strip_variable_lines() {
    grep -Ev "^\[ai-pipeline\] (template:|=== AI_BuildCutlines (start|done))"
}

if [ ! -f "$EXPECTED" ]; then
    echo ""
    echo "NOTE [$STEP]: no golden file yet — this is expected on first run."
    echo "  Log written to: $LOG"
    echo "  Review the log. If correct, commit it as the golden file:"
    echo ""
    echo "    cp \"$LOG\" \"$EXPECTED\""
    echo "    git add \"$EXPECTED\""
    echo "    git commit -m 'Add golden output for ai-build-cutlines'"
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
    echo "    git add \"$EXPECTED\" && git commit -m 'Update ai-build-cutlines golden output: <reason>'"
    exit 1
fi
