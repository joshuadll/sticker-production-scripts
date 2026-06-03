#!/bin/bash
# Integration test for PSAI_BuildAndExportCutlines.jsx (Steps 3B → 5 → silhouette export).
# BridgeTalk handoff to Illustrator is skipped — the test ends after the silhouette PNG is written.
#
# FIXTURES REQUIRED:
#   tests/integration/fixtures/elements-captioned-ungrouped.psd
#     A Production Template PSD with all elements placed, resized, and caption
#     text layers added (SO + T layers at the top level, not yet grouped).
#     Create this by running PS_BuildElements.jsx on fixture source PSDs,
#     then saving the resulting document to that path.
#
# GOLDEN FILE WORKFLOW — first run:
#   1. Run this script (SKIP diff if no golden file yet)
#   2. Verify the log looks correct (elements grouped, Silhouette created)
#   3. Commit:  cp "$LOG" tests/integration/expected/psai-build-export-cutlines-expected.txt

set -euo pipefail

STEP="psai-build-export-cutlines"
APP="Adobe Photoshop 2026"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/pipelines/PSAI_BuildAndExportCutlines.jsx"
FIXTURE_DIR="$(cd "$(dirname "$0")" && pwd)/fixtures"
TEMPLATE_FIXTURE="$FIXTURE_DIR/elements-captioned-ungrouped.psd"
EXPECTED="$(cd "$(dirname "$0")" && pwd)/expected/psai-build-export-cutlines-expected.txt"

TEMP_SCRIPT="/tmp/${STEP}-test.jsx"
LOG="/tmp/PSAI_BuildAndExportCutlines.log"

# ── Pre-flight ───────────────────────────────────────────────────────────────

if [ ! -f "$TEMPLATE_FIXTURE" ]; then
    echo "SKIP [$STEP]: fixture not found: $TEMPLATE_FIXTURE"
    echo "  Create by running PS_BuildElements.jsx on fixture source PSDs,"
    echo "  then saving the resulting document as: $TEMPLATE_FIXTURE"
    exit 0
fi

# ── Prepare temp script ──────────────────────────────────────────────────────
# Patches applied:
#   - Suppress alerts
#   - Open the fixture PSD via app.open() injected before CONFIG, so the
#     document is loaded synchronously before main() runs (avoids the
#     timing issues of AppleScript's open + delay approach)
#   - Blank out the runtime aiPipelinePath assignment so BridgeTalk is skipped
#     (the literal CONFIG default is already "", but the runtime line overwrites it)
#   - Rewrite #include paths to absolute so they resolve from /tmp/

rm -f "$LOG" "$TEMP_SCRIPT"

perl -pe '
    s|suppressAlerts:\s*false|suppressAlerts: true|;
    s|CONFIG\.logPath\s*=\s*_root[^;]+;|CONFIG.logPath = "/tmp/PSAI_BuildAndExportCutlines.log";|;
    s|CONFIG\.aiPipelinePath\s*=\s*_root[^;]+;|CONFIG.aiPipelinePath = "";|;
    s|(var CONFIG\s*=)|app.open(new File("'"$TEMPLATE_FIXTURE"'"));\n$1|;
    s|#include "\.\./|#include "'"$REPO_ROOT"'/|g;
' "$SCRIPT" > "$TEMP_SCRIPT"

# ── Run script via osascript ─────────────────────────────────────────────────

echo "[$STEP] Running script (fixture opened by script itself)..."
osascript << EOF
tell application "$APP"
    do javascript file (POSIX file "$TEMP_SCRIPT")
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
    echo "[$STEP] Silhouette created — OK"
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
    echo "    git commit -m 'Add golden output for psai-build-export-cutlines'"
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
    echo "    git add \"$EXPECTED\" && git commit -m 'Update psai-build-export-cutlines golden output: <reason>'"
    exit 1
fi
