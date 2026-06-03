#!/bin/bash
# Integration test for Step 3A (caption text placement).
# Runs PS_BuildElements.jsx (Steps 1 + 2 + 3A) and verifies T layers were created.
#
# FIXTURES REQUIRED:
#   tests/integration/fixtures/source-psds/  (≥1 source PSD)
#   PS_BuildElements creates its own template document — no pre-opened PSD needed.
#
# GOLDEN FILE WORKFLOW — first run:
#   1. Run this script (SKIP diff if no golden file yet)
#   2. Verify the log looks correct
#   3. Commit the golden file:
#        cp "$LOG" tests/integration/expected/ps-build-elements-captions-expected.txt
#        git add tests/integration/expected/ps-build-elements-captions-expected.txt
#        git commit -m "Add golden output for ps-build-elements-captions"

set -euo pipefail

STEP="ps-build-elements-captions"
APP="Adobe Photoshop 2026"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/pipelines/PS_BuildElements.jsx"
FIXTURE_DIR="$(cd "$(dirname "$0")" && pwd)/fixtures"
SOURCE_FIXTURE="$FIXTURE_DIR/source-psds"
EXPECTED="$(cd "$(dirname "$0")" && pwd)/expected/ps-build-elements-captions-expected.txt"

TEMP_SCRIPT="/tmp/${STEP}-test.jsx"
LOG="/tmp/PS_BuildElements.log"

# ── Pre-flight checks ────────────────────────────────────────────────────────

if [ ! -d "$SOURCE_FIXTURE" ] || [ -z "$(ls "$SOURCE_FIXTURE"/*.psd 2>/dev/null)" ]; then
    echo "SKIP [$STEP]: source fixture folder missing or empty: $SOURCE_FIXTURE"
    exit 0
fi

# ── Prepare temp script ──────────────────────────────────────────────────────

rm -f "$LOG" "$TEMP_SCRIPT"

perl -pe '
    s|sourceFolderPath:\s*""|sourceFolderPath: "'"$SOURCE_FIXTURE"'"|;
    s|suppressAlerts:\s*false|suppressAlerts: true|;
    s|#include "\.\./|#include "$REPO_ROOT/|g;
' "$SCRIPT" > "$TEMP_SCRIPT"

# ── Run script via osascript ─────────────────────────────────────────────────

echo "[$STEP] Running script..."
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

# ── Diff against golden file ─────────────────────────────────────────────────
# Strip variable lines (paths, timestamps) before diffing.

strip_variable_lines() {
    grep -Ev "^\[pipeline\] (template:|source folder:|=== PS_BuildElements (start|done))"
}

if [ ! -f "$EXPECTED" ]; then
    echo ""
    echo "NOTE [$STEP]: no golden file yet — this is expected on first run."
    echo "  Log written to: $LOG"
    echo "  Review the log. If correct, commit it as the golden file:"
    echo ""
    echo "    cp \"$LOG\" \"$EXPECTED\""
    echo "    git add \"$EXPECTED\""
    echo "    git commit -m 'Add golden output for ps-build-elements-captions'"
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
    echo "    git add \"$EXPECTED\" && git commit -m 'Update ps-build-elements-captions golden output: <reason>'"
    exit 1
fi
