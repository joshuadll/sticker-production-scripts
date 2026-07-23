#!/bin/bash
# Node unit test for _junctionSliverLeaves in aiUtils.jsx (pure geometry, no Adobe app required).
set -euo pipefail
STEP="junction-slivers-unit"
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "[$STEP] Running caption-junction sliver-selection unit tests (node)..."
if ! command -v node >/dev/null 2>&1; then echo "FAIL [$STEP]: node not found on PATH."; exit 1; fi
if node "$DIR/test-junction-slivers.js"; then echo "PASS [$STEP]"; exit 0; else echo "FAIL [$STEP]"; exit 1; fi
