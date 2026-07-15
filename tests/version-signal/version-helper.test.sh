#!/bin/bash
# Grep both util files for the functions, then exercise them live in Photoshop.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSUTILS="$ROOT/utils/psUtils.jsx"
AIUTILS="$ROOT/utils/aiUtils.jsx"
PASS=0; FAIL=0
check(){ if [ "$2" = "$3" ]; then echo "ok - $1"; PASS=$((PASS+1)); else echo "FAIL - $1: exp[$3] got[$2]"; FAIL=$((FAIL+1)); fi; }
grepboth(){ if grep -q "$2" "$PSUTILS" && grep -q "$2" "$AIUTILS"; then echo "ok - $1"; PASS=$((PASS+1)); else echo "FAIL - $1"; FAIL=$((FAIL+1)); fi; }

grepboth "readVersionStatus in both utils" "function readVersionStatus"
grepboth "formatVersionStatus in both utils" "function formatVersionStatus"

SB=$(mktemp -d)
SUP="$SB/support"; ROOTP="$SUP/scripts"; mkdir -p "$ROOTP"
OUT="$SB/out.txt"; NOW=$(date +%s)

run_state(){
  local h="$SB/harness.jsx"
  cat > "$h" <<JSX
#include "$PSUTILS"
(function(){
  var st = readVersionStatus("$ROOTP");
  var line = formatVersionStatus(st);
  var out = new File("$OUT"); out.encoding = "UTF-8"; out.lineFeed = "Unix";
  out.open("w"); out.writeln("state=" + st.state); out.writeln("line=" + line); out.close();
})();
JSX
  rm -f "$OUT"
  osascript -e "tell application \"Adobe Photoshop 2026\" to do javascript (read (POSIX file \"$h\") as «class utf8»)" >/dev/null 2>&1 || true
  for i in $(seq 1 30); do [ -f "$OUT" ] && break; sleep 0.5; done
}

printf 'installed=aaaa1112222\nlatest=aaaa1112222\nchecked=%s\nok=1\n' "$NOW" > "$SUP/update-status.txt"
run_state; check "upToDate state" "$(grep '^state=' "$OUT" | cut -d= -f2)" "upToDate"
check "upToDate line" "$(grep '^line=' "$OUT" | cut -d= -f2-)" "✓ version aaaa111"

OLD=$((NOW - 20000))
printf 'installed=aaaa1112222\nlatest=aaaa1112222\nchecked=%s\nok=1\n' "$OLD" > "$SUP/update-status.txt"
run_state; check "stale state" "$(grep '^state=' "$OUT" | cut -d= -f2)" "stale"
check "stale line" "$(grep '^line=' "$OUT" | cut -d= -f2-)" "⚠ version aaaa111 — updates aren't reaching this Mac"

rm -f "$SUP/update-status.txt"
run_state; check "unknown state" "$(grep '^state=' "$OUT" | cut -d= -f2)" "unknown"
check "unknown empty line" "$(grep '^line=' "$OUT" | cut -d= -f2-)" ""

printf 'installed=aaaa1112222\nlatest=aaaa1112222\nchecked=%s\nok=0\n' "$NOW" > "$SUP/update-status.txt"
run_state; check "stale via ok=0 state" "$(grep '^state=' "$OUT" | cut -d= -f2)" "stale"

echo ""; echo "PASS=$PASS FAIL=$FAIL (9 checks)"; rm -rf "$SB"; [ "$FAIL" -eq 0 ]
