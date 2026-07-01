#!/bin/bash
set -euo pipefail
STEP="element-gets-caption-unit"
DIR="$(cd "$(dirname "$0")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "SKIP [$STEP]: node not found."; exit 0; }
if node "$DIR/test-element-gets-caption.js"; then echo "PASS [$STEP]"; else echo "FAIL [$STEP]"; exit 1; fi
