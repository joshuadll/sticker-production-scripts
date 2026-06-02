#!/bin/bash
# Runs all step integration tests and prints a pass/fail summary.
# Usage: bash tests/integration/run-all.sh
#        npm test

PASS=0
FAIL=0
DIR="$(cd "$(dirname "$0")" && pwd)"

# Unit tests first — these catch shared utility bugs before running integration tests.
for runner in "$DIR"/run-test*.sh; do
    bash "$runner" && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
done

# Integration tests (require fixture files and a running Adobe app).
for runner in "$DIR"/run-step*.sh "$DIR"/run-ps-*.sh "$DIR"/run-ai-*.sh; do
    [ -f "$runner" ] && { bash "$runner" && PASS=$((PASS+1)) || FAIL=$((FAIL+1)); }
done

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
