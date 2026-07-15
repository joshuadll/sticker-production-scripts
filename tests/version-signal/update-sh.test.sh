#!/bin/bash
# Exercises installer/update.sh with PATH-shimmed git + curl and a sandbox SUPPORT_DIR.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UPDATE_SH="$ROOT/installer/update.sh"
PASS=0; FAIL=0
check(){ if [ "$2" = "$3" ]; then echo "ok - $1"; PASS=$((PASS+1)); else echo "FAIL - $1: exp[$3] got[$2]"; FAIL=$((FAIL+1)); fi; }

SB=$(mktemp -d)
export NOTEWORTHIE_SUPPORT_DIR="$SB/support"
BIN="$SB/bin"; mkdir -p "$BIN"

# stub: git ls-remote <url> main  ->  "<sha>\trefs/heads/main"
cat > "$BIN/git" <<'EOF'
#!/bin/bash
[ -z "$FAKE_SHA" ] && exit 1
printf '%s\trefs/heads/main\n' "$FAKE_SHA"
EOF
chmod +x "$BIN/git"

# stub: curl -fsSL <url> -o <out>  ->  writes a fake repo zip with the main folder
cat > "$BIN/curl" <<'EOF'
#!/bin/bash
out=""; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
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

# 1. first run downloads, installed=latest, ok=1
export FAKE_SHA="aaaa111"; bash "$UPDATE_SH"
check "first installed" "$(grep '^installed=' "$S" | cut -d= -f2)" "aaaa111"
check "first ok" "$(grep '^ok=' "$S" | cut -d= -f2)" "1"
check "first synced" "$(cat "$PJSX")" "// fake"

# 2. unchanged sha -> no re-download (marker survives)
echo "MARKER" > "$PJSX"; bash "$UPDATE_SH"
check "unchanged no-download" "$(cat "$PJSX")" "MARKER"
check "unchanged ok" "$(grep '^ok=' "$S" | cut -d= -f2)" "1"

# 3. changed sha -> re-download
export FAKE_SHA="bbbb222"; bash "$UPDATE_SH"
check "changed installed" "$(grep '^installed=' "$S" | cut -d= -f2)" "bbbb222"
check "changed re-downloaded" "$(cat "$PJSX")" "// fake"

# 4. offline (git fails) -> ok=0, scripts untouched, installed preserved
export FAKE_SHA=""; echo "KEEP" > "$PJSX"; bash "$UPDATE_SH"
check "offline ok=0" "$(grep '^ok=' "$S" | cut -d= -f2)" "0"
check "offline untouched" "$(cat "$PJSX")" "KEEP"
check "offline keeps installed" "$(grep '^installed=' "$S" | cut -d= -f2)" "bbbb222"

echo ""; echo "PASS=$PASS FAIL=$FAIL"; rm -rf "$SB"; [ "$FAIL" -eq 0 ]
