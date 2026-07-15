# Version Visibility & Update Signal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make artist-run pipeline scripts self-report their installed commit SHA and a four-state up-to-date signal, so the developer can identify exactly what code ran during debugging.

> **⚠ Superseded in part (commits 905aa88, d928d1c).** As shipped: the SHA precheck uses **curl against the GitHub API**, not `git ls-remote` (no git dependency); and the signal is **two-state** (`updateAvailable` was dropped — pure auto-sync makes it unreachable). Task 1's `git ls-remote` and Task 3/4's `updateAvailable` wording below are the original plan; see `CLAUDE.md` §"Version signal and auto-update" for shipped behavior.

**Architecture:** `update.sh` (LaunchAgent, login + hourly) does a cheap SHA precheck against `main`, syncs only on change, and writes `update-status.txt` (installed SHA, latest SHA, check epoch, ok flag) into the SUPPORT_DIR that `rsync --delete` never touches. A shared read-only ExtendScript helper in both util files parses that file into one of four states and formats a one-line signal that every pipeline prints in its completion alert and log banner. A Desktop `.command` force-runs `update.sh` for live-debug "pull my fix now" moments.

**Tech Stack:** Bash (installer/updater), ExtendScript ES3 (Photoshop + Illustrator), macOS launchd, osascript for live test harnesses.

## Global Constraints

- **ExtendScript is ES3.** No `let`/`const`, no arrow functions, no template literals. (Applies to util + pipeline edits.)
- **Log prefix:** pipeline lines use `[pipeline]`; step lines use `[stepN]`.
- **Fail-safe, never false:** any missing/corrupt version data degrades to state `unknown` — never a false `✓` or `⚠`.
- **Status file format** (`update-status.txt`, plain `key=value`, one per line): `installed=<40-char sha>`, `latest=<40-char sha>`, `checked=<epoch seconds>`, `ok=<0|1>`.
- **State thresholds:** `STALE_SECONDS = 10800` (3 h). Displayed SHA = `installedSha.substring(0,7)`.
- **Message wording (exact, app-agnostic):**
  - upToDate: `✓ Up to date  ·  version <short>`
  - updateAvailable: `⚠ Update available — double-click "Update Noteworthie" on your Desktop, then re-run  ·  version <short>`
  - stale: `⚠ Update check is stale — reconnect to the internet  ·  version <short>`
  - unknown: *(empty string — line omitted from alert)*
- **SUPPORT_DIR resolution:** in the deployed layout the pipeline `_root` is the `scripts/` folder; SUPPORT_DIR = `File(_root).parent`. The status file lives at `SUPPORT_DIR/update-status.txt`.
- **Repo:** `joshuadll/sticker-production-scripts`, branch `main`.

---

### Task 1: Version-aware `update.sh`

**Files:**
- Modify: `installer/update.sh` (full rewrite of the sync body)
- Test: `tests/version-signal/update-sh.test.sh` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: the `update-status.txt` contract (keys `installed`, `latest`, `checked`, `ok`) that Task 3's `readVersionStatus` parses. Honors `NOTEWORTHIE_SUPPORT_DIR` env override for testability (default `$HOME/Library/Application Support/Noteworthie`).

- [ ] **Step 1: Write the failing test**

Create `tests/version-signal/update-sh.test.sh`:

```bash
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/version-signal/update-sh.test.sh`
Expected: FAIL — current `update.sh` writes no `update-status.txt` (checks for `installed=` find nothing).

- [ ] **Step 3: Rewrite `installer/update.sh`**

Replace the entire file with:

```bash
#!/bin/bash
set -e

SUPPORT_DIR="${NOTEWORTHIE_SUPPORT_DIR:-$HOME/Library/Application Support/Noteworthie}"
INSTALL_DIR="$SUPPORT_DIR/scripts"
REPO_SLUG="joshuadll/sticker-production-scripts"
REPO_ZIP="https://github.com/$REPO_SLUG/archive/refs/heads/main.zip"
REPO_GIT="https://github.com/$REPO_SLUG.git"
STATUS_FILE="$SUPPORT_DIR/update-status.txt"
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$SUPPORT_DIR"

# Previously-installed commit SHA (empty on first run)
installed=""
[ -f "$STATUS_FILE" ] && installed=$(grep '^installed=' "$STATUS_FILE" | head -1 | cut -d= -f2)

# Cheap precheck: latest main SHA (~1 KB, no full download). Empty on failure/offline.
latest=$(git ls-remote "$REPO_GIT" main 2>/dev/null | head -1 | cut -f1)

now=$(date +%s)
write_status() {   # $1 installed  $2 latest  $3 ok
    { echo "installed=$1"; echo "latest=$2"; echo "checked=$now"; echo "ok=$3"; } > "$STATUS_FILE"
}

# Offline / fetch failed: leave scripts + installed SHA intact, mark not-ok.
if [ -z "$latest" ]; then
    write_status "$installed" "$installed" "0"
    exit 0
fi

# Already current: skip the download entirely.
if [ "$latest" = "$installed" ] && [ -d "$INSTALL_DIR" ]; then
    write_status "$installed" "$latest" "1"
    exit 0
fi

# Changed (or first run): full sync.
mkdir -p "$INSTALL_DIR"
curl -fsSL "$REPO_ZIP" -o "$TMP_DIR/scripts.zip"
ditto -xk "$TMP_DIR/scripts.zip" "$TMP_DIR"
rsync -a --delete \
    --exclude='tests/' \
    --exclude='docs/' \
    --exclude='installer/' \
    "$TMP_DIR/sticker-production-scripts-main/" "$INSTALL_DIR/"

write_status "$latest" "$latest" "1"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/version-signal/update-sh.test.sh`
Expected: `PASS=9 FAIL=0`

- [ ] **Step 5: Commit**

```bash
git add installer/update.sh tests/version-signal/update-sh.test.sh
git commit -m "feat(update): version-aware sync writing update-status.txt"
```

---

### Task 2: Hourly timer + Desktop force-update command

**Files:**
- Modify: `installer/install.command` (add `StartInterval` to the plist; write the Desktop command)
- Test: `tests/version-signal/install-command.test.sh` (create)

**Interfaces:**
- Consumes: `update.sh` behavior from Task 1 (the Desktop command reads `update-status.txt`).
- Produces: a LaunchAgent that runs `update.sh` at login and every 3600 s; a `~/Desktop/Update Noteworthie.command`.

- [ ] **Step 1: Write the failing test**

Create `tests/version-signal/install-command.test.sh`:

```bash
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/version-signal/install-command.test.sh`
Expected: FAIL — none of those strings exist yet.

- [ ] **Step 3: Add `StartInterval` to the plist**

In `installer/install.command`, inside the plist heredoc (section 3), change:

```
    <key>RunAtLoad</key>
    <true/>
```
to:
```
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>3600</integer>
```

- [ ] **Step 4: Write the Desktop force-update command**

In `installer/install.command`, immediately **after** the `launchctl load "$PLIST_PATH"` line (before the `# ── Done` section), insert:

```bash
# ── Desktop "Update Noteworthie" force-update command ─────────────────────────
DESKTOP_CMD="$HOME/Desktop/Update Noteworthie.command"
cat > "$DESKTOP_CMD" <<EOF
#!/bin/bash
echo "Updating Noteworthie scripts..."
bash "$UPDATE_SCRIPT"
S="$SUPPORT_DIR/update-status.txt"
if [ -f "\$S" ]; then
    inst=\$(grep '^installed=' "\$S" | cut -d= -f2 | cut -c1-7)
    ok=\$(grep '^ok=' "\$S" | cut -d= -f2)
    if [ "\$ok" = "1" ]; then
        echo "Up to date — version \$inst"
        echo "Now re-run your step from File > Scripts (no need to restart the app)."
    else
        echo "Could not reach the internet. Check your connection and try again."
    fi
fi
read -r -p "Press Enter to close..." _
EOF
chmod +x "$DESKTOP_CMD"
echo "  ✓ Desktop      — Update Noteworthie.command"
```

(The outer `<<EOF` is unquoted so `$UPDATE_SCRIPT` and `$SUPPORT_DIR` bake absolute paths into the generated file, while `\$S`, `\$inst`, `\$ok`, `\$(...)` stay literal for runtime.)

- [ ] **Step 5: Run test to verify it passes**

Run: `bash tests/version-signal/install-command.test.sh`
Expected: `PASS=4 FAIL=0`

- [ ] **Step 6: Commit**

```bash
git add installer/install.command tests/version-signal/install-command.test.sh
git commit -m "feat(installer): hourly update timer + Desktop force-update command"
```

---

### Task 3: Shared ExtendScript version helper (both util files)

**Files:**
- Modify: `utils/psUtils.jsx` (append two functions)
- Modify: `utils/aiUtils.jsx` (append the identical two functions)
- Test: `tests/version-signal/version-helper.test.sh` (create; grep both files + behavioral via osascript/Photoshop)

**Interfaces:**
- Consumes: `update-status.txt` contract from Task 1.
- Produces:
  - `readVersionStatus(rootPath)` → `{ installedSha:String, latestSha:String, checkedEpoch:Number, ok:Boolean, state:String }` where `state ∈ {"upToDate","updateAvailable","stale","unknown"}`. SUPPORT_DIR = `File(rootPath).parent`.
  - `formatVersionStatus(status)` → `String` (the exact wording per Global Constraints; `""` when `state==="unknown"` or no `installedSha`).

- [ ] **Step 1: Write the failing test**

Create `tests/version-signal/version-helper.test.sh`:

```bash
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
  var out = new File("$OUT"); out.encoding = "UTF-8";
  out.open("w"); out.writeln("state=" + st.state); out.writeln("line=" + line); out.close();
})();
JSX
  rm -f "$OUT"
  osascript -e "tell application \"Adobe Photoshop 2026\" to do javascript (read (POSIX file \"$h\") as «class utf8»)" >/dev/null 2>&1 || true
  for i in $(seq 1 30); do [ -f "$OUT" ] && break; sleep 0.5; done
}

printf 'installed=aaaa1112222\nlatest=aaaa1112222\nchecked=%s\nok=1\n' "$NOW" > "$SUP/update-status.txt"
run_state; check "upToDate state" "$(grep '^state=' "$OUT" | cut -d= -f2)" "upToDate"
check "upToDate line" "$(grep '^line=' "$OUT" | cut -d= -f2-)" "✓ Up to date  ·  version aaaa111"

printf 'installed=aaaa1112222\nlatest=bbbb999\nchecked=%s\nok=1\n' "$NOW" > "$SUP/update-status.txt"
run_state; check "updateAvailable state" "$(grep '^state=' "$OUT" | cut -d= -f2)" "updateAvailable"

OLD=$((NOW - 20000))
printf 'installed=aaaa1112222\nlatest=aaaa1112222\nchecked=%s\nok=1\n' "$OLD" > "$SUP/update-status.txt"
run_state; check "stale state" "$(grep '^state=' "$OUT" | cut -d= -f2)" "stale"

rm -f "$SUP/update-status.txt"
run_state; check "unknown state" "$(grep '^state=' "$OUT" | cut -d= -f2)" "unknown"
check "unknown empty line" "$(grep '^line=' "$OUT" | cut -d= -f2-)" ""

echo ""; echo "PASS=$PASS FAIL=$FAIL"; rm -rf "$SB"; [ "$FAIL" -eq 0 ]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/version-signal/version-helper.test.sh`
Expected: FAIL — `grepboth` fails (functions don't exist); behavioral checks fail.

- [ ] **Step 3: Append the two functions to `utils/aiUtils.jsx` AND `utils/psUtils.jsx`**

Append this identical block to the end of **both** files (ES3 — no `let`/`const`/arrows/templates):

```javascript
// ── Version status (reads update-status.txt written by installer/update.sh) ──
// rootPath = pipeline _root (the scripts folder). SUPPORT_DIR = its parent.
function readVersionStatus(rootPath) {
    var res = { installedSha: "", latestSha: "", checkedEpoch: 0, ok: false, state: "unknown" };
    try {
        var f = new File(new File(rootPath).parent.fsName + "/update-status.txt");
        if (!f.exists) { return res; }
        f.open("r"); var txt = f.read(); f.close();
        var lines = txt.split(/\r\n|\r|\n/);
        for (var i = 0; i < lines.length; i++) {
            var eq = lines[i].indexOf("=");
            if (eq < 0) { continue; }
            var k = lines[i].substring(0, eq);
            var v = lines[i].substring(eq + 1);
            if (k === "installed") { res.installedSha = v; }
            else if (k === "latest") { res.latestSha = v; }
            else if (k === "checked") { res.checkedEpoch = parseInt(v, 10) || 0; }
            else if (k === "ok") { res.ok = (v === "1"); }
        }
        if (!res.installedSha) { res.state = "unknown"; return res; }
        var nowEpoch = Math.floor((new Date()).getTime() / 1000);
        var age = nowEpoch - res.checkedEpoch;
        if (!res.ok || res.checkedEpoch === 0 || age > 10800) { res.state = "stale"; }
        else if (res.latestSha && res.installedSha !== res.latestSha) { res.state = "updateAvailable"; }
        else { res.state = "upToDate"; }
    } catch (e) { res.state = "unknown"; }
    return res;
}

// Formats the one-line signal for a completion alert. "" when unknown.
function formatVersionStatus(status) {
    if (!status || status.state === "unknown" || !status.installedSha) { return ""; }
    var v = "  ·  version " + status.installedSha.substring(0, 7);
    if (status.state === "stale") {
        return "⚠ Update check is stale — reconnect to the internet" + v;
    }
    if (status.state === "updateAvailable") {
        return "⚠ Update available — double-click \"Update Noteworthie\" on your Desktop, then re-run" + v;
    }
    return "✓ Up to date" + v;
}
```

(Unicode escapes keep the ES3 source ASCII-clean: `·`=·, `⚠`=⚠, `—`=—, `✓`=✓.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/version-signal/version-helper.test.sh`
Expected: `PASS=8 FAIL=0`. (Photoshop must be running — the harness targets "Adobe Photoshop 2026"; per project notes a first osascript call may need the app already open.)

- [ ] **Step 5: Commit**

```bash
git add utils/psUtils.jsx utils/aiUtils.jsx tests/version-signal/version-helper.test.sh
git commit -m "feat(utils): readVersionStatus + formatVersionStatus in ps/ai utils"
```

---

### Task 4: Wire the signal into all pipelines

**Files:**
- Modify: `pipelines/PS_BuildElements.jsx`
- Modify: `pipelines/AI_BuildAndExportCutlines.jsx`
- Modify: `pipelines/AI_ImportNesting.jsx`
- Modify: `pipelines/AI_NormaliseCaptions.jsx`
- Modify: `pipelines/AI_LayoutQA.jsx`
- Modify: `pipelines/AI_ExportFinal.jsx`
- Test: `tests/version-signal/pipeline-wiring.test.sh` (create)

**Interfaces:**
- Consumes: `readVersionStatus(rootPath)` and `formatVersionStatus(status)` from Task 3 (already in scope via each pipeline's `#include` of psUtils/aiUtils).
- Produces: version in each pipeline's log start banner + a status line on each success completion alert.

- [ ] **Step 1: Write the failing test**

Create `tests/version-signal/pipeline-wiring.test.sh`:

```bash
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/version-signal/pipeline-wiring.test.sh`
Expected: FAIL — none of the pipelines reference the helpers yet.

- [ ] **Step 3: Edit each pipeline — compute version + amend the start banner**

For **each** of the 6 pipelines, locate the log-start banner line
`log("[pipeline] === <NAME> start ===");` and replace it with (using that file's own `<NAME>`):

```javascript
var _ver = readVersionStatus(_root);
var _vshort = _ver.installedSha ? _ver.installedSha.substring(0, 7) : "unknown";
log("[pipeline] === <NAME> start (version " + _vshort + ") ===");
```

`<NAME>` per file: `PS_BuildElements`, `AI_BuildAndExportCutlines`, `AI_ImportNesting`, `AI_NormaliseCaptions`, `AI_LayoutQA`, `AI_ExportFinal`. `_root` is already defined in every pipeline; `_ver` is now in scope for Step 4.

- [ ] **Step 4: Edit each pipeline — append the status line to the success alert**

In each pipeline, find the **success** completion `scriptAlert(...)` (the one shown when the run finishes cleanly — NOT the error/validation alerts) and append the status line. Add this once, just before that alert:

```javascript
var _vline = formatVersionStatus(_ver);
```

then append `+ (_vline ? "\n" + _vline : "")` to the alert's message argument.

Worked example — `pipelines/AI_BuildAndExportCutlines.jsx` success alert currently reads:

```javascript
scriptAlert("✅ Cut lines built (" + r.built + ") + " + svgs + ".\n\n" + ... );
```

becomes:

```javascript
var _vline = formatVersionStatus(_ver);
scriptAlert("✅ Cut lines built (" + r.built + ") + " + svgs + ".\n\n" + ... + (_vline ? "\n" + _vline : ""));
```

Apply the same transformation to the single success alert in each of the other 5 pipelines. Leave error/validation alerts unchanged (they keep their `Log:` path line; do not add the status line there).

- [ ] **Step 5: Run test to verify it passes**

Run: `bash tests/version-signal/pipeline-wiring.test.sh`
Expected: `PASS=18 FAIL=0`

- [ ] **Step 6: Live smoke check (one pipeline)**

Stage a status file and open the lightest pipeline to eyeball the banner + alert. Run:

```bash
mkdir -p "$HOME/Library/Application Support/Noteworthie"
printf 'installed=deadbeef1234\nlatest=deadbeef1234\nchecked=%s\nok=1\n' "$(date +%s)" \
  > "$HOME/Library/Application Support/Noteworthie/update-status.txt"
```

Then run `AI_LayoutQA` from Illustrator on an existing working doc (or via the osascript path used by its integration runner) and confirm: log banner shows `(version deadbee)` and the completion alert ends with `✓ Up to date  ·  version deadbee`. (Per project notes, long Illustrator osascript calls return a -1712 timeout but keep running — poll the log.)

- [ ] **Step 7: Commit**

```bash
git add pipelines/PS_BuildElements.jsx pipelines/AI_BuildAndExportCutlines.jsx \
        pipelines/AI_ImportNesting.jsx pipelines/AI_NormaliseCaptions.jsx \
        pipelines/AI_LayoutQA.jsx pipelines/AI_ExportFinal.jsx \
        tests/version-signal/pipeline-wiring.test.sh
git commit -m "feat(pipelines): print version + up-to-date signal in banner and alert"
```

---

### Task 5: Docs

**Files:**
- Modify: `docs/installer-artist-instructions.md` (mention the Desktop update command)
- Modify: `CLAUDE.md` (note the version signal + `update-status.txt`)

**Interfaces:**
- Consumes: everything above. Produces: nothing code-facing.

- [ ] **Step 1: Update artist instructions**

In `docs/installer-artist-instructions.md`, add a short section: scripts auto-update hourly; to force an update immediately, double-click **Update Noteworthie** on the Desktop, then re-run the step (no app restart needed). When reporting a problem, read Joshua the `version …` line shown at the end of the completion dialog.

- [ ] **Step 2: Update CLAUDE.md**

In `CLAUDE.md`, near the installer/distribution notes, add one line: pipelines print a four-state version signal (`✓ up to date` / `⚠ update available` / `⚠ stale` / omitted) sourced from `~/Library/Application Support/Noteworthie/update-status.txt`, written by `installer/update.sh`; helper `readVersionStatus`/`formatVersionStatus` in ps/ai utils.

- [ ] **Step 3: Commit**

```bash
git add docs/installer-artist-instructions.md CLAUDE.md
git commit -m "docs(version): artist update command + version-signal notes"
```

---

## Self-Review

**Spec coverage:**
- update.sh version-aware sync → Task 1 ✓
- Hourly timer → Task 2 (StartInterval) ✓
- Desktop force-update command → Task 2 ✓
- Shared helper (readVersionStatus/formatVersionStatus, 4 states, fail-safe) → Task 3 ✓
- Per-pipeline banner + alert line, Log: only on errors → Task 4 ✓
- Message wording (all four states) → Global Constraints + Task 3 ✓
- SUPPORT_DIR survives rsync --delete → Task 1 (file in parent) + Task 3 (File(_root).parent) ✓
- Testing (bash update.sh, helper states, integration) → Tasks 1/3/4 tests ✓
- Docs → Task 5 ✓

**Placeholder scan:** none — every code/step block is complete. Task 4 Step 4 uses a `...` only inside a *quoted example of pre-existing code* to stand for that pipeline's own unchanged message body, with the exact transformation shown around it.

**Type consistency:** `readVersionStatus(rootPath)` returns the `{installedSha, latestSha, checkedEpoch, ok, state}` object used in Task 4 (`_ver.installedSha`); `formatVersionStatus(_ver)` matches the Task 3 signature; status-file keys (`installed/latest/checked/ok`) written in Task 1 match those parsed in Task 3. `_ver`/`_vline`/`_vshort` names consistent across Task 4 steps and the wiring test.
