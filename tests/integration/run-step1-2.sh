#!/bin/bash
# Integration test for ProductionFileScript.jsx (Steps 1 + 2: combine + resize)
#
# FIXTURES REQUIRED — place these before running:
#
#   tests/integration/fixtures/resize-area-template.psd
#     Minimal Resize Area Template: 42 × 59.4 cm, 300 DPI.
#     Must contain exactly one layer named per CONFIG.skipLayerName (default: "Guide").
#     No element layers — the script will populate them.
#
#   tests/integration/fixtures/source-psds/
#     One or more source PSDs, each with top-level LayerSet groups
#     named per the Foundation convention e.g. "Horseshoe Bend [WC-LM]".
#
# GOLDEN FILE WORKFLOW — first run:
#   1. Run this script (it will SKIP the diff and print the log path)
#   2. Verify the log looks correct
#   3. Commit the golden file:
#        cp "$LOG" tests/integration/expected/step1-2-expected.txt
#        git add tests/integration/expected/step1-2-expected.txt
#        git commit -m "Add golden output for step1-2"
#
# UPDATING THE GOLDEN FILE — after an intentional change:
#   1. Verify the new output is correct
#   2. cp "$LOG" tests/integration/expected/step1-2-expected.txt
#   3. git add + commit with a message explaining why it changed

set -euo pipefail

STEP="step1-2"
APP="Adobe Photoshop 2024"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/photoshop/ProductionFileScript.jsx"
FIXTURE_DIR="$(cd "$(dirname "$0")" && pwd)/fixtures"
TEMPLATE_FIXTURE="$FIXTURE_DIR/resize-area-template.psd"
SOURCE_FIXTURE="$FIXTURE_DIR/source-psds"
EXPECTED="$(cd "$(dirname "$0")" && pwd)/expected/step1-2-expected.txt"

# The script writes its log to the same folder as the JSX file being run.
# Since we run a temp copy from /tmp, the log lands there.
TEMP_SCRIPT="/tmp/${STEP}-test.jsx"
LOG="/tmp/ProductionFileScript.log"

# ── Pre-flight checks ────────────────────────────────────────────────────────

if [ ! -f "$TEMPLATE_FIXTURE" ]; then
    echo "SKIP [$STEP]: fixture not found: $TEMPLATE_FIXTURE"
    echo "  Create: 42×59.4 cm, 300 DPI PSD with a single layer named 'Guide' (or CONFIG.skipLayerName)"
    exit 0
fi

if [ ! -d "$SOURCE_FIXTURE" ] || [ -z "$(ls "$SOURCE_FIXTURE"/*.psd 2>/dev/null)" ]; then
    echo "SKIP [$STEP]: source fixture folder missing or empty: $SOURCE_FIXTURE"
    echo "  Create: folder containing ≥1 source PSD with element groups e.g. 'Horseshoe Bend [WC-LM]'"
    exit 0
fi

# ── Prepare temp script with test CONFIG overrides ───────────────────────────
# Injects sourceFolderPath (skips folder picker dialog) and
# suppressAlerts (skips alert() dialogs for headless run).

rm -f "$LOG" "$TEMP_SCRIPT"

perl -pe '
    s|sourceFolderPath:\s*""|sourceFolderPath: "'"$SOURCE_FIXTURE"'"|;
    s|suppressAlerts:\s*false|suppressAlerts: true|;
' "$SCRIPT" > "$TEMP_SCRIPT"

# ── Run script via osascript ─────────────────────────────────────────────────

echo "[$STEP] Opening template and running script..."
osascript << EOF
tell application "$APP"
    open POSIX file "$TEMPLATE_FIXTURE"
    delay 1
    do javascript file "$TEMP_SCRIPT"
end tell
EOF

rm -f "$TEMP_SCRIPT"

# ── Wait for log ─────────────────────────────────────────────────────────────
# do javascript is synchronous, but we poll as a safety net.

TIMEOUT=60
ELAPSED=0
until [ -f "$LOG" ] || [ "$ELAPSED" -ge "$TIMEOUT" ]; do
    sleep 1
    ELAPSED=$((ELAPSED + 1))
done

if [ ! -f "$LOG" ]; then
    echo "FAIL [$STEP]: log not written after ${TIMEOUT}s — script may have crashed."
    echo "  Check: $LOG"
    exit 1
fi

# ── Diff against golden file ─────────────────────────────────────────────────
# Variable lines (folder name can vary by machine) are stripped before diffing.
# Add further exclusions here if new variable lines are introduced.

strip_variable_lines() {
    grep -Ev "^\[step1-2\] (template:|source folder:|=== ProductionFileScript (start|done))"
}

if [ ! -f "$EXPECTED" ]; then
    echo ""
    echo "NOTE [$STEP]: no golden file yet — this is expected on first run."
    echo "  Log written to: $LOG"
    echo "  Review the log. If correct, commit it as the golden file:"
    echo ""
    echo "    cp \"$LOG\" \"$EXPECTED\""
    echo "    git add \"$EXPECTED\""
    echo "    git commit -m 'Add golden output for step1-2'"
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
    echo "    git add \"$EXPECTED\" && git commit -m 'Update step1-2 golden output: <reason>'"
    exit 1
fi
