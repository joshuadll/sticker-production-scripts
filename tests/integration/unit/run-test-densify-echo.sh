#!/bin/bash
set -euo pipefail
STEP="densify-echo-unit"; DIR="$(cd "$(dirname "$0")" && pwd)"
echo "[$STEP] Running _densifyPoly + plate-echo predicate unit tests (node)..."
if ! command -v node >/dev/null 2>&1; then echo "FAIL [$STEP]: node not found on PATH."; exit 1; fi
if node "$DIR/test-densify-echo.js"; then echo "PASS [$STEP]"; exit 0; else echo "FAIL [$STEP]"; exit 1; fi
