#!/bin/bash
# Static assertions on installer/install.command (it needs sudo + real apps to run).
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IC="$ROOT/installer/install.command"
PASS=0; FAIL=0
has(){ if grep -qF "$2" "$IC"; then echo "ok - $1"; PASS=$((PASS+1)); else echo "FAIL - $1"; FAIL=$((FAIL+1)); fi; }

has "StartInterval key present" "<key>StartInterval</key>"
has "StartInterval is 3600" "<integer>3600</integer>"
has "Desktop command created" 'Update Noteworthie.command'
has "Desktop command reads status" "update-status.txt"

echo ""; echo "PASS=$PASS FAIL=$FAIL"; [ "$FAIL" -eq 0 ]
