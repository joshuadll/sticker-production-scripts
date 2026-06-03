#!/bin/bash
# Integration test for Step 5 (silhouette creation).
# Runs PSAI_BuildAndExportCutlines.jsx on a grouped fixture PSD with Step 3B in dryRun
# so only Step 5 executes for real. Checks that the Silhouette layer was created.
#
# FIXTURES REQUIRED:
#   tests/integration/fixtures/resize-area-template-grouped.psd
#     A Resize Area Template that has had Steps 1–3B run on it (all elements
#     are [Display Name] [STYLE-CAT] groups + Guide at top level).
#     Create this by running PSAI_BuildAndExportCutlines.jsx on a captioned fixture PSD,
#     stopping after Step 3B completes, then saving.
#
# GOLDEN FILE WORKFLOW — first run:
#   1. Run this script (SKIP diff if no golden file yet)
#   2. Verify the log looks correct (Silhouette created, Elements grouped)
#   3. Commit: cp "$LOG" tests/integration/expected/psai-build-export-cutlines-silhouette-expected.txt

set -euo pipefail

STEP="psai-build-export-cutlines-silhouette"
APP="Adobe Photoshop 2024"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/pipelines/PSAI_BuildAndExportCutlines.jsx"
FIXTURE_DIR="$(cd "$(dirname "$0")" && pwd)/fixtures"
TEMPLATE_FIXTURE="$FIXTURE_DIR/resize-area-template-grouped.psd"
EXPECTED="$(cd "$(dirname "$0")" && pwd)/expected/psai-build-export-cutlines-silhouette-expected.txt"

TEMP_SCRIPT="/tmp/${STEP}-test.jsx"
LOG="/tmp/PSAI_BuildAndExportCutlines.log"

# ── Pre-flight ───────────────────────────────────────────────────────────────

if [ ! -f "$TEMPLATE_FIXTURE" ]; then
    echo "SKIP [$STEP]: fixture not found: $TEMPLATE_FIXTURE"
    echo "  Create by running PSAI_BuildAndExportCutlines.jsx (Steps 1–3B) on fixture source PSDs,"
    echo "  then save the result as: $TEMPLATE_FIXTURE"
    exit 0
fi

# ── Prepare temp script ──────────────────────────────────────────────────────
# Suppress alerts. Patch Step 3B to dryRun by making CONFIG.dryRun true for
# the 3B phase only — simplest approach is to run the whole script with dryRun
# false but skip BridgeTalk, since Step 5 is the target and 3B is a no-op on
# an already-grouped file (it will skip all elements it cannot find T layers for).

rm -f "$LOG" "$TEMP_SCRIPT"

perl -pe '
    s|suppressAlerts:\s*false|suppressAlerts: true|;
    s|aiPipelinePath:\s*""|aiPipelinePath: "__skip__"|;
' "$SCRIPT" > "$TEMP_SCRIPT"

# ── Run script via osascript ─────────────────────────────────────────────────

echo "[$STEP] Opening grouped template and running script..."
osascript << EOF
tell application "$APP"
    open POSIX file "$TEMPLATE_FIXTURE"
    delay 1
    do javascript file "$TEMP_SCRIPT"
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

# ── Verify Silhouette line appears in log ────────────────────────────────────

if grep -q "\[step5\] Silhouette created\." "$LOG"; then
    echo "PASS [$STEP]: Silhouette created."
else
    echo "FAIL [$STEP]: '[step5] Silhouette created.' not found in log."
    echo "  Log contents:"
    cat "$LOG"
    exit 1
fi

# ── Diff against golden file ─────────────────────────────────────────────────

strip_variable_lines() {
    grep -Ev "^\[pipeline\] (document:|=== PSAI_BuildAndExportCutlines (start|done)|saved:)"
}

if [ ! -f "$EXPECTED" ]; then
    echo ""
    echo "NOTE [$STEP]: no golden file yet — this is expected on first run."
    echo "  Log written to: $LOG"
    echo "  Review the log. If correct, commit it as the golden file:"
    echo ""
    echo "    cp \"$LOG\" \"$EXPECTED\""
    echo "    git add \"$EXPECTED\""
    echo "    git commit -m 'Add golden output for psai-build-export-cutlines-silhouette'"
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
    echo "    git add \"$EXPECTED\" && git commit -m 'Update psai-build-export-cutlines-silhouette golden output: <reason>'"
    exit 1
fi
