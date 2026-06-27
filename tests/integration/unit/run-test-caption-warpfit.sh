#!/bin/bash
# Node unit test for the caption auto-warp decision helpers in aiUtils.jsx
# (_capBottomProfile / _capBaseArcFit — pure geometry, no Adobe app required).
# The .js extracts the helpers from aiUtils.jsx and asserts their behaviour; exit 0 = pass.

set -euo pipefail

STEP="caption-warpfit-unit"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[$STEP] Running caption warp-fit unit tests (node)..."

if ! command -v node >/dev/null 2>&1; then
    echo "SKIP [$STEP]: node not found on PATH."
    exit 0
fi

if node "$DIR/test-caption-warpfit.js"; then
    echo "PASS [$STEP]"
    exit 0
else
    echo "FAIL [$STEP]"
    exit 1
fi
