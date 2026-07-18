#!/bin/bash
# Node unit test for _capArcToCrossing in aiUtils.jsx (pure geometry, no Adobe app required).
set -euo pipefail
STEP="halfcut-cap-follow-unit"
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "[$STEP] Running half-cut cap-follow unit tests (node)..."
if ! command -v node >/dev/null 2>&1; then echo "SKIP [$STEP]: node not found on PATH."; exit 0; fi
if node "$DIR/test-halfcut-cap-follow.js"; then echo "PASS [$STEP]"; exit 0; else echo "FAIL [$STEP]"; exit 1; fi
