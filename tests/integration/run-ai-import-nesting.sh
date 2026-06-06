#!/bin/bash
# Integration test for Step 7B (Nesting Import) via the AI_ImportNesting pipeline.
# Opens a saved working .ai (Step-6 cutlines) and runs AI_ImportNesting against
# Deepnest output SVGs, asserting every cutline matched (unmatched=0) and artwork
# placed. Matching is area-only and runs headless via auto-discovery (suppressAlerts).
#
# FIXTURES REQUIRED (all next to each other, named by the {base} convention so the
# pipeline's auto-discovery finds them — see _findNestedSvgs / _findElementsFolder):
#   tests/integration/fixtures/import-nesting.ai
#       Working .ai right after Step 6 (Cutlines layer populated, Sticker layer present).
#   tests/integration/fixtures/import-nesting_regular_nested.svg
#   tests/integration/fixtures/import-nesting_irregular_nested.svg
#       Real Deepnest output (the nested layouts). One or both may be present.
#   tests/integration/fixtures/import-nesting_elements/
#       Per-element PNGs (the {base}_elements folder PSAI exports), names matching
#       the cutline display names (spaces preserved).
#
# Create them from a real run: run-psai-build-export-cutlines.sh produces the .ai +
# {base}_elements; nest its two SVGs in Deepnest and save the outputs as the
# _regular_nested.svg / _irregular_nested.svg names above.

set -euo pipefail

STEP="ai-import-nesting"
APP="Adobe Illustrator"

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/pipelines/AI_ImportNesting.jsx"
FIXTURE_DIR="$(cd "$(dirname "$0")" && pwd)/fixtures"
AI_FIXTURE="$FIXTURE_DIR/import-nesting.ai"

TEMP_SCRIPT="/tmp/${STEP}-test.jsx"
LOG="/tmp/AI_ImportNesting.log"

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

perl -pe 's|suppressAlerts:\s*false|suppressAlerts: true|;
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
    MATCHED=$(echo "$RESULT_LINE"   | grep -oE "matched: [0-9]+"   | grep -oE "[0-9]+")
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
fi

if [ "$FAIL" -ne 0 ]; then
    echo "  Log contents:"
    cat "$LOG"
    exit 1
fi

echo "PASS [$STEP]"
exit 0
