#!/bin/bash
# Integration test for Pipeline 2 — AI_BuildAndExportCutlines.jsx (Illustrator only).
#
# Pipeline 2 takes the post-Step-6 working doc (traced cut + native caption text placed by
# Pipeline 1) and, per WC/GC element: builds the caption (white pill -> seat into the traced
# cut -> unite -> bundle -> half-cut; GC also places a scaled plate raster), then runs Step 7A
# Deepnest export -> {base}_regular.svg + {base}_irregular.svg (the cutline SVGs for nesting).
#
# This drives the REAL artist entry point (the file's bottom dispatch runs main()) with
# suppressAlerts:true so the success alert doesn't block headless. main() resolves the open
# fixture by its Cutlines layer.
#
# FIXTURE (committed): fixtures/traced-cutlines.ai + fixtures/traced-cutlines_elements.json
#   A snapshot of Pipeline 1's ending file — the working .ai saved by buildDocAndImport after
#   Step 6 (Cutlines layer with "{name} outline" + "{name} caption text" members) plus its
#   sidecar. The fixture is WC-only (Slovakia SKU: 24 WC + 2 ST), so the GC plate-raster
#   branch is NOT exercised (known coverage gap; GC SKU validation is tracked separately).
#
# A temp copy is used so Step 7A's SVGs land in /tmp, not the committed fixtures dir. The
# sidecar copy MUST share the .ai base name and sit beside it (_readSidecarBeside resolves it).
#
# REQUIRES: Adobe Illustrator.
#
# GOLDEN WORKFLOW: first run prints NOTE + skips diff. Review the log, then:
#   cp "$LOG" "$EXPECTED" && git add "$EXPECTED" && commit
# Update after an intentional change: same cp + commit with a reason.

set -euo pipefail

STEP="ai-build-and-export-cutlines"
APP="Adobe Illustrator"

DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DIR/../../.." && pwd)"
SCRIPT="$REPO_ROOT/pipelines/AI_BuildAndExportCutlines.jsx"
AI_FIXTURE="$DIR/fixtures/traced-cutlines.ai"
SIDECAR_FIXTURE="$DIR/fixtures/traced-cutlines_elements.json"
EXPECTED="$DIR/expected.txt"

TEMP_SCRIPT="/tmp/${STEP}-test.jsx"
TEMP_BASE="/tmp/${STEP}-fixture"
TEMP_FIXTURE="${TEMP_BASE}.ai"
TEMP_SIDECAR="${TEMP_BASE}_elements.json"
LOG="/tmp/AI_BuildAndExportCutlines.log"
SVG_REGULAR="${TEMP_BASE}_regular.svg"
SVG_IRREGULAR="${TEMP_BASE}_irregular.svg"

# ── Pre-flight ────────────────────────────────────────────────────────────────
if [ ! -f "$AI_FIXTURE" ] || [ ! -f "$SIDECAR_FIXTURE" ]; then
    echo "SKIP [$STEP]: fixture not found ($AI_FIXTURE + sidecar)."
    echo "  Duplicate Pipeline 1's ending file (source-psds.ai + _elements.json) into fixtures/."
    exit 0
fi

# ── Clean slate ───────────────────────────────────────────────────────────────
rm -f "$LOG" "$TEMP_SCRIPT" "$TEMP_FIXTURE" "$TEMP_SIDECAR" "$SVG_REGULAR" "$SVG_IRREGULAR"
osascript -e "tell application \"$APP\" to do javascript \"while(app.documents.length>0){app.documents[0].close(SaveOptions.DONOTSAVECHANGES);}\"" >/dev/null 2>&1 || true

cp "$AI_FIXTURE" "$TEMP_FIXTURE"
cp "$SIDECAR_FIXTURE" "$TEMP_SIDECAR"

# ── Prepare temp script ───────────────────────────────────────────────────────
# Inject: suppressAlerts (so main()'s success alert doesn't block), fixed /tmp logPath,
# absolute #include paths. The bottom dispatch then runs main() on the opened fixture.
perl -pe '
    s|suppressAlerts:\s*false|suppressAlerts: true|;
    s|CONFIG\.logPath\s*=\s*_root[^;]+;|CONFIG.logPath = "'"$LOG"'";|;
    s|#include "\.\./|#include "'"$REPO_ROOT"'/|g;
' "$SCRIPT" > "$TEMP_SCRIPT"

# ── Run via osascript ─────────────────────────────────────────────────────────
echo "[$STEP] Opening fixture copy and running AI_BuildAndExportCutlines (main)..."
# stdout is just main()'s 'undefined' return; drop it. stderr stays visible so a real
# AppleScript error (e.g. -2741 when Illustrator is busy) still surfaces + fails the run.
# Timeout is generous (1200s): building 24 captions + exporting both SVGs can run >10min on a
# slow machine, and the AppleEvent blocks until main() returns (-1712 if it fires too early).
osascript >/dev/null << EOF
tell application "$APP"
    with timeout of 1200 seconds
        open POSIX file "$TEMP_FIXTURE"
        do javascript file (POSIX file "$TEMP_SCRIPT")
    end timeout
end tell
EOF

rm -f "$TEMP_SCRIPT"

# ── Wait for log ──────────────────────────────────────────────────────────────
TIMEOUT=180; ELAPSED=0
until [ -f "$LOG" ] || [ "$ELAPSED" -ge "$TIMEOUT" ]; do sleep 1; ELAPSED=$((ELAPSED + 1)); done
if [ ! -f "$LOG" ]; then
    echo "FAIL [$STEP]: log not written after ${TIMEOUT}s — script may have crashed."
    exit 1
fi

# ── Verify key log lines + outputs ────────────────────────────────────────────
FAIL=0

# Overall success: main() only logs the 'done' banner after the failed-caption guard passes.
if grep -q "=== AI_BuildAndExportCutlines done ===" "$LOG"; then
    echo "  PASS: pipeline reached 'done' (no failed captions)."
else
    echo "FAIL [$STEP]: pipeline did not reach 'done' (a caption failed or it errored)."
    grep -E "couldn't be built|ERROR|failed:" "$LOG" || true; FAIL=1
fi

# Captions built > 0 and failed = 0.
SUMMARY="$(grep -oE "\[ai-pipeline\] captions built: [0-9]+ \| skipped: [0-9]+ \| failed: [0-9]+" "$LOG" | tail -1 || true)"
BUILT="$(echo "$SUMMARY"  | grep -oE "built: [0-9]+"  | grep -oE "[0-9]+" || echo 0)"
FAILED="$(echo "$SUMMARY" | grep -oE "failed: [0-9]+" | grep -oE "[0-9]+" || echo 0)"
if [ "${BUILT:-0}" -gt 0 ] && [ "${FAILED:-0}" -eq 0 ]; then
    echo "  PASS: $BUILT caption(s) built, 0 failed."
else
    echo "FAIL [$STEP]: captions built=$BUILT failed=$FAILED ($SUMMARY)."; FAIL=1
fi

# Default tabs: the ST elements must build as tabs with a half-cut (built > 0, failed = 0).
if grep -qE "\[ai-pipeline\] tab built \| .* halfcut=true" "$LOG"; then
    echo "  PASS: at least one default tab built with a half-cut."
else
    echo "FAIL [$STEP]: no default tab built with a half-cut."
    grep -E "\[ai-pipeline\] tab built|tab \(" "$LOG" || true; FAIL=1
fi

# Both SVGs reported exported in the log AND present + non-empty on disk.
if grep -q "\[step7a\] exported: .*_regular.svg" "$LOG" && grep -q "\[step7a\] exported: .*_irregular.svg" "$LOG"; then
    echo "  PASS: Step 7A reported both SVG exports."
else
    echo "FAIL [$STEP]: Step 7A did not report both SVG exports."
    grep -E "\[step7a\]" "$LOG" || true; FAIL=1
fi
if [ -s "$SVG_REGULAR" ] && [ -s "$SVG_IRREGULAR" ]; then
    echo "  PASS: both SVGs on disk + non-empty ($(basename "$SVG_REGULAR"), $(basename "$SVG_IRREGULAR"))."
else
    echo "FAIL [$STEP]: SVG(s) missing or empty on disk ($SVG_REGULAR / $SVG_IRREGULAR)."; FAIL=1
fi

if [ "$FAIL" -ne 0 ]; then echo "  Log contents:"; cat "$LOG"; exit 1; fi

# ── Golden diff ───────────────────────────────────────────────────────────────
strip_variable_lines() {
    grep -Ev "^\[ai-pipeline\] === AI_BuildAndExportCutlines (start|done) ===" \
        | grep '^\[' \
        | sed -E "s#/private/tmp#/tmp#g; s#${TEMP_BASE}#<FIXTURE>#g; s#${REPO_ROOT}#<REPO>#g"
}

if [ ! -f "$EXPECTED" ]; then
    echo ""
    echo "NOTE [$STEP]: no golden yet — expected on first run."
    echo "  Review $LOG, then commit it:"
    echo "    cp \"$LOG\" \"$EXPECTED\" && git add \"$EXPECTED\""
    echo "PASS [$STEP]: captions built + both SVGs exported (golden pending)."
    exit 0
fi

if diff -u <(strip_variable_lines < "$EXPECTED") <(strip_variable_lines < "$LOG"); then
    echo "PASS [$STEP]: outputs OK + log matches golden."
    exit 0
else
    echo "FAIL [$STEP]: log differs from golden (diff above)."
    echo "  If intentional: cp \"$LOG\" \"$EXPECTED\" && git add \"$EXPECTED\" && commit"
    exit 1
fi
