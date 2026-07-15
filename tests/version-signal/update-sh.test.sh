#!/bin/bash
# Exercises installer/update.sh with a PATH-shimmed curl and a sandbox SUPPORT_DIR.
# update.sh has no `git` dependency (macOS ships no real git by default) — the SHA
# precheck and the zip download both go through curl.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UPDATE_SH="$ROOT/installer/update.sh"
PASS=0; FAIL=0
check(){ if [ "$2" = "$3" ]; then echo "ok - $1"; PASS=$((PASS+1)); else echo "FAIL - $1: exp[$3] got[$2]"; FAIL=$((FAIL+1)); fi; }

SB=$(mktemp -d)
export NOTEWORTHIE_SUPPORT_DIR="$SB/support"
BIN="$SB/bin"; mkdir -p "$BIN"

# stub: curl serves two call shapes used by update.sh —
#   1. SHA precheck: `curl ... https://api.github.com/repos/<slug>/commits/main` -> prints $FAKE_SHA
#      (empty FAKE_SHA simulates curl -f failing on a non-2xx response, i.e. offline/rate-limited)
#   2. zip download: `curl ... -o <file> <zip-url>` -> writes a fake repo zip
#      ($FAIL_ZIP simulates a download failure AFTER a good precheck)
cat > "$BIN/curl" <<'EOF'
#!/bin/bash
is_api=0; out=""; prev=""
for a in "$@"; do
  case "$a" in *api.github.com*) is_api=1;; esac
  [ "$prev" = "-o" ] && out="$a"
  prev="$a"
done
if [ "$is_api" = "1" ]; then
  [ -z "$FAKE_SHA" ] && exit 22        # simulate offline / curl -f failure
  printf '%s' "$FAKE_SHA"; exit 0
fi
[ -n "$FAIL_ZIP" ] && exit 1            # simulate a download failure after a good precheck
tmp=$(mktemp -d)
mkdir -p "$tmp/sticker-production-scripts-main/pipelines"
echo "// fake" > "$tmp/sticker-production-scripts-main/pipelines/PS_BuildElements.jsx"
( cd "$tmp" && zip -qr "$out" sticker-production-scripts-main )
rm -rf "$tmp"
EOF
chmod +x "$BIN/curl"
export PATH="$BIN:$PATH"

S="$NOTEWORTHIE_SUPPORT_DIR/update-status.txt"
PJSX="$NOTEWORTHIE_SUPPORT_DIR/scripts/pipelines/PS_BuildElements.jsx"

SHA_A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
SHA_B="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
SHA_D="dddddddddddddddddddddddddddddddddddddddd"
SHA_E="eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

# 1. first run downloads, installed=latest, ok=1
export FAKE_SHA="$SHA_A"; bash "$UPDATE_SH"
check "first installed" "$(grep '^installed=' "$S" | cut -d= -f2)" "$SHA_A"
check "first ok" "$(grep '^ok=' "$S" | cut -d= -f2)" "1"
check "first synced" "$(cat "$PJSX")" "// fake"

# 2. unchanged sha -> no re-download (marker survives)
echo "MARKER" > "$PJSX"; bash "$UPDATE_SH"
check "unchanged no-download" "$(cat "$PJSX")" "MARKER"
check "unchanged ok" "$(grep '^ok=' "$S" | cut -d= -f2)" "1"

# 3. changed sha -> re-download
export FAKE_SHA="$SHA_B"; bash "$UPDATE_SH"
check "changed installed" "$(grep '^installed=' "$S" | cut -d= -f2)" "$SHA_B"
check "changed re-downloaded" "$(cat "$PJSX")" "// fake"

# 4. offline (precheck fails) -> ok=0, scripts untouched, installed preserved
export FAKE_SHA=""; echo "KEEP" > "$PJSX"; bash "$UPDATE_SH"
check "offline ok=0" "$(grep '^ok=' "$S" | cut -d= -f2)" "0"
check "offline untouched" "$(cat "$PJSX")" "KEEP"
check "offline keeps installed" "$(grep '^installed=' "$S" | cut -d= -f2)" "$SHA_B"

# 5. Establish a healthy baseline (ok=1) first, so this test actually exercises the bug:
#    a stale ok=1 from a PRIOR successful sync must not survive a later failed one.
export FAKE_SHA="$SHA_D"; bash "$UPDATE_SH"
check "baseline installed" "$(grep '^installed=' "$S" | cut -d= -f2)" "$SHA_D"
check "baseline ok" "$(grep '^ok=' "$S" | cut -d= -f2)" "1"

# precheck succeeds (new sha) but the zip download fails -> ok=0, installed UNCHANGED
# (stays the previous good sha, since the new version did not land), and the
# previously-synced script file survives untouched.
export FAIL_ZIP=1
echo "MARKER5" > "$PJSX"
export FAKE_SHA="$SHA_E"; bash "$UPDATE_SH" || true
unset FAIL_ZIP
check "download-fail ok=0" "$(grep '^ok=' "$S" | cut -d= -f2)" "0"
check "download-fail keeps installed" "$(grep '^installed=' "$S" | cut -d= -f2)" "$SHA_D"
check "download-fail scripts survive" "$(cat "$PJSX")" "MARKER5"

echo ""; echo "PASS=$PASS FAIL=$FAIL (15 checks)"; rm -rf "$SB"; [ "$FAIL" -eq 0 ]
