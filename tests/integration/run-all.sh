#!/bin/bash
# Runs all tests and prints a pass/fail summary.
# Usage: bash tests/integration/run-all.sh   (or: npm test)
#
# Discovery:
#   unit/run-*.sh        -- util/algorithm tests (run first; catch shared-helper bugs)
#   <pipeline>/run.sh    -- one per pipeline (ps-build-elements, ai-*)
# The orphaned tests/integration/run-*.sh at the root (e.g. run-ps-build-elements-captions.sh,
# which tests the deleted Step 3A) are intentionally NOT discovered.

PASS=0
FAIL=0
DIR="$(cd "$(dirname "$0")" && pwd)"

# Unit tests first.
for runner in "$DIR"/unit/run-*.sh; do
    [ -f "$runner" ] && { bash "$runner" && PASS=$((PASS+1)) || FAIL=$((FAIL+1)); }
done

# Per-pipeline integration tests (require fixtures + a running Adobe app).
for runner in "$DIR"/*/run.sh; do
    [ -f "$runner" ] && { bash "$runner" && PASS=$((PASS+1)) || FAIL=$((FAIL+1)); }
done

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
