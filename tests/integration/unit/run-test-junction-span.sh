#!/bin/bash
set -euo pipefail
STEP="junction-span-unit"; DIR="$(cd "$(dirname "$0")" && pwd)"
echo "[$STEP] Running _farthestPairDist unit tests (node)..."
if ! command -v node >/dev/null 2>&1; then echo "SKIP [$STEP]: node not found."; exit 0; fi
if node "$DIR/test-junction-span.js"; then echo "PASS [$STEP]"; exit 0; else echo "FAIL [$STEP]"; exit 1; fi
