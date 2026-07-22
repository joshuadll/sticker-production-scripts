#!/bin/bash
set -e

STEP="stitch-crossings-unit"
echo "=== Testing $STEP ==="
node tests/integration/unit/test-stitch-crossings.js
echo "PASS [$STEP]"
