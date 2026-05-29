#!/bin/bash
# Runs all step integration tests and prints a pass/fail summary.
# Usage: bash tests/integration/run-all.sh
#        npm test

PASS=0
FAIL=0
DIR="$(cd "$(dirname "$0")" && pwd)"

for runner in "$DIR"/run-step*.sh; do
    bash "$runner" && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
done

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
