#!/bin/bash
# Node unit test for _capSplitLines in aiUtils.jsx (pure string logic, no Adobe app required).
set -euo pipefail
STEP="caption-linesplit-unit"
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "[$STEP] Running caption line-split unit tests (node)..."
if ! command -v node >/dev/null 2>&1; then echo "SKIP [$STEP]: node not found on PATH."; exit 0; fi
if node "$DIR/test-caption-linesplit.js"; then echo "PASS [$STEP]"; exit 0; else echo "FAIL [$STEP]"; exit 1; fi
