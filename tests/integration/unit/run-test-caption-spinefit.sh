#!/bin/bash
# Node unit test for the caption baseline spine-fit helpers in aiUtils.jsx
# (_capRobustBaselineFit / _capBandSpan / _capYAt — pure geometry, no Adobe app required).
# The .js extracts the helpers from aiUtils.jsx and asserts their behaviour; exit 0 = pass.

set -euo pipefail

STEP="caption-spinefit-unit"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[$STEP] Running caption spine-fit unit tests (node)..."

if ! command -v node >/dev/null 2>&1; then
    echo "SKIP [$STEP]: node not found on PATH."
    exit 0
fi

if node "$DIR/test-caption-spinefit.js"; then
    echo "PASS [$STEP]"
    exit 0
else
    echo "FAIL [$STEP]"
    exit 1
fi
