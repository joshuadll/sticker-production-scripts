#!/bin/bash
# Static: every artist-runnable pipeline computes _ver and appends _vline.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0; FAIL=0
has(){ if grep -qF "$3" "$ROOT/pipelines/$2"; then echo "ok - $1"; PASS=$((PASS+1)); else echo "FAIL - $1"; FAIL=$((FAIL+1)); fi; }

for p in PS_BuildElements AI_BuildAndExportCutlines AI_ImportNesting AI_NormaliseCaptions AI_LayoutQA AI_ExportFinal; do
    has "$p reads version" "$p.jsx" "readVersionStatus(_root)"
    has "$p banner has version" "$p.jsx" "(version "
    has "$p appends status line" "$p.jsx" "formatVersionStatus(_ver)"
done

echo ""; echo "PASS=$PASS FAIL=$FAIL"; [ "$FAIL" -eq 0 ]
