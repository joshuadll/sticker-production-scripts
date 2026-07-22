#!/bin/bash
set -e

STEP="stitch-loop-unit"
echo "=== Testing $STEP ==="
node tests/integration/unit/test-stitch-loop.js
echo "PASS [$STEP]"
