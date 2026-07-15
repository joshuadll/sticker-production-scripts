# Half-cut: validate at export, don't re-derive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make export *verify* the half-cut instead of re-deriving it, add advisory Layout QA flags for missing/undershooting half-cuts, and remove the seat-review QA badge (relocating that signal to the seating pipelines).

**Architecture:** A pure geometry checker in `aiUtils` (`_halfcutEndsReachCut`) wrapped by `validateHalfcut(doc, group)`. Step 9A calls it as a hard gate (no more `syncHalfcut` at export). A new advisory step file `StepQA_Halfcut` draws blue flags on the shared Layout QA overlay. The seat-review badge is deleted from Step 8c and its `|R` signal is surfaced as a completion-dialog line in the two pipelines that seat.

**Tech Stack:** ExtendScript (ES3) for Adobe Illustrator; bash + `osascript` integration/unit test runners; log-golden diffing.

## Global Constraints

- **Language: ExtendScript ES3** — no `let`/`const`, no arrow functions, no template literals. (`CLAUDE.md`)
- **Colours are RGB (sRGB), never CMYK.** (`memory/rgb_color_pipeline`)
- **`halfcutExtendMm = 1.0`** — the playbook figure; the undershoot tolerance is `mmToPoints(1)`.
- **Undershoot = an endpoint SHORT of the cut line by ≥ 1 mm.** An endpoint on/outside the contour, or inside by < 1 mm, passes. Never "1 mm past the line."
- **Step files** export exactly one named function, log prefix `[stepN]`/`[stepQA-...]`, assume `CONFIG` + utils in scope, no `#target`/`CONFIG`/`main()`.
- **QA marks** go only on the shared `"Layout QA"` layer (`CONFIG.qaLayerName`), in mm (scale-invariant); advisory, never gating.
- **Never hand-author golden coordinates; run each integration test twice to confirm determinism before committing a golden.** (`memory/feedback_test_fixtures`) `*.ai` fixtures are local-only (gitignored).
- **Worktree:** all paths are under `/Users/joshuadelallana/sticker-production-scripts/.claude/worktrees/investigate-halfcut-error/`. Run `git status` after the first edit of each task to confirm it landed in the worktree, not the main checkout. (`memory/worktree_edit_wrong_tree`)

---

### Task 1: `validateHalfcut` + pure geometry core in `aiUtils`

**Files:**
- Modify: `utils/aiUtils.jsx` (add functions near `syncHalfcut`, ~line 2208)
- Create: `tests/integration/unit/test-halfcut-validate.jsx`
- Create: `tests/integration/unit/run-test-halfcut-validate.sh`

**Interfaces:**
- Consumes (existing aiUtils): `pointInPolygon(pt, poly)`, `samplePathToPolygons(item, steps)`, `_largestPoly(polys)`, `findGroupMember(group, suffix)`, `getOrCreateHalfcutLayer(doc)`, `mmToPoints(mm)`, `parseNote(note)`.
- Produces:
  - `_distPointToSegment(p, a, b) -> Number` (pure)
  - `_distPointToPolygon(p, poly) -> Number` (pure)
  - `_halfcutEndsReachCut(endPts, cutPoly, minGapPt) -> { ok, reason }` (pure; reason `null` | `"undershoot"`)
  - `_halfcutCutPolyForGroup(group, steps) -> poly | null` (resolves the element's cut contour to its largest sampled polygon)
  - `validateHalfcut(doc, group) -> { ok, reason }` (reason `null` | `"missing"` | `"undershoot"`)

- [ ] **Step 1: Write the failing unit test**

Create `tests/integration/unit/test-halfcut-validate.jsx`:

```javascript
// Unit test for the PURE half-cut end-reach check (utils/aiUtils.jsx).
// No document needed — exercises _halfcutEndsReachCut with plain arrays.
// Writes [halfcut-validate] PASS|/FAIL| lines to the log the runner polls.
#include "../../../utils/aiUtils.jsx"

var LOG = new File(Folder("~/Desktop").fsName + "/test-halfcut-validate.log");
function out(s) { LOG.open("a"); LOG.writeln(s); LOG.close(); }
function check(name, got, want) {
    out("[halfcut-validate] " + (got === want ? "PASS" : "FAIL") + " | " + name
        + " got=" + got + " want=" + want);
}

LOG.open("w"); LOG.writeln("=== test-halfcut-validate ==="); LOG.close();

// A 40x40 pt square cut contour centred at origin (0,0)..(40,40).
var sq = [ {x:0,y:0}, {x:40,y:0}, {x:40,y:40}, {x:0,y:40} ];
var mm1 = mmToPoints(1);   // ~2.83pt

// Both ends outside the contour → ok.
check("both-outside",
    _halfcutEndsReachCut([{x:-5,y:20},{x:45,y:20}], sq, mm1).reason, null);
// One end deep inside (20pt from every edge >> 1mm) → undershoot.
check("one-deep-inside",
    _halfcutEndsReachCut([{x:-5,y:20},{x:20,y:20}], sq, mm1).reason, "undershoot");
// One end just inside by < 1mm (0.5pt from the right edge) → ok (slop).
check("inside-under-1mm",
    _halfcutEndsReachCut([{x:-5,y:20},{x:39.5,y:20}], sq, mm1).reason, null);
// One end inside by > 1mm (10pt from nearest edge) → undershoot.
check("inside-over-1mm",
    _halfcutEndsReachCut([{x:-5,y:20},{x:30,y:20}], sq, mm1).reason, "undershoot");
// Fewer than 2 endpoints → undershoot (cannot connect two ends).
check("too-few-points",
    _halfcutEndsReachCut([{x:-5,y:20}], sq, mm1).reason, "undershoot");
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /Users/joshuadelallana/sticker-production-scripts/.claude/worktrees/investigate-halfcut-error
cat > tests/integration/unit/run-test-halfcut-validate.sh <<'SH'
#!/bin/bash
set -euo pipefail
STEP="halfcut-validate"; APP="Adobe Illustrator"
DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$DIR/test-halfcut-validate.jsx"
LOG="$HOME/Desktop/test-halfcut-validate.log"
rm -f "$LOG"
osascript -e 'with timeout of 120 seconds' -e "tell application \"$APP\"" \
  -e "do javascript file (POSIX file \"$SCRIPT\")" -e 'end tell' -e 'end timeout'
T=60; E=0
until { [ -f "$LOG" ] && grep -qE "\[halfcut-validate\] (PASS|FAIL) \|" "$LOG"; } || [ "$E" -ge "$T" ]; do sleep 2; E=$((E+2)); done
echo "--- log ---"; cat "$LOG"; echo "-----------"
FAILS=$(grep -c "\[halfcut-validate\] FAIL |" "$LOG" || true)
PASSES=$(grep -c "\[halfcut-validate\] PASS |" "$LOG" || true)
if [ "${FAILS:-0}" -gt 0 ] || [ "${PASSES:-0}" -eq 0 ]; then echo "FAIL [$STEP]: $FAILS failing"; exit 1; fi
echo "PASS [$STEP]"; exit 0
SH
chmod +x tests/integration/unit/run-test-halfcut-validate.sh
./tests/integration/unit/run-test-halfcut-validate.sh
```
Expected: FAIL — `_halfcutEndsReachCut is undefined` (function not added yet).

- [ ] **Step 3: Add the pure geometry + DOM wrapper to `utils/aiUtils.jsx`**

Insert immediately after `syncHalfcut` (after line 2208, before the SPACING BUFFER section):

```javascript
// ─── HALF-CUT VALIDATION (export gate + Layout QA; no re-derivation) ───────────
// Distance from point p to segment a-b (all {x,y}); pure.
function _distPointToSegment(p, a, b) {
    var vx = b.x - a.x, vy = b.y - a.y;
    var wx = p.x - a.x, wy = p.y - a.y;
    var len2 = vx * vx + vy * vy;
    var t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var dx = p.x - (a.x + t * vx), dy = p.y - (a.y + t * vy);
    return Math.sqrt(dx * dx + dy * dy);
}

// Min distance from p to the polygon's edges (closed ring); pure.
function _distPointToPolygon(p, poly) {
    var best = 1e15, i, j, d;
    for (i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        d = _distPointToSegment(p, poly[j], poly[i]);
        if (d < best) best = d;
    }
    return best;
}

// Do BOTH endpoints of a half-cut reach the element's cut contour? endPts = the two
// end anchors [{x,y},{x,y}]; cutPoly = the largest sampled polygon of the cut contour;
// minGapPt = max tolerated shortfall (mmToPoints(1)). An end CONNECTS when it is on/outside
// the contour OR inside it by < minGapPt. An end inside by >= minGapPt is a short end
// (undershoot). < 2 finite endpoints → undershoot. Pure — unit-tested with plain arrays.
function _halfcutEndsReachCut(endPts, cutPoly, minGapPt) {
    if (!endPts || endPts.length < 2 || !cutPoly || cutPoly.length < 3) {
        return { ok: false, reason: "undershoot" };
    }
    var i, p;
    for (i = 0; i < endPts.length; i++) {
        p = endPts[i];
        if (!p || !isFinite(p.x) || !isFinite(p.y)) return { ok: false, reason: "undershoot" };
        if (pointInPolygon(p, cutPoly) && _distPointToPolygon(p, cutPoly) >= minGapPt) {
            return { ok: false, reason: "undershoot" };
        }
    }
    return { ok: true, reason: null };
}

// Largest sampled polygon of a Cutlines group's cut contour (the member named group.name),
// drilling through the Pathfinder-Unite wrapper group like Step 10 does. null if unresolved.
function _halfcutCutPolyForGroup(group, steps) {
    var cut = findGroupMember(group, "");
    if (!cut) return null;
    // Drill a GroupItem cut member down to its first path (the united contour).
    var probe = cut, guard = 0;
    while (probe && probe.typename === "GroupItem" && guard < 8) {
        probe = probe.pageItems.length ? probe.pageItems[0] : null; guard++;
    }
    if (!probe || (probe.typename !== "PathItem" && probe.typename !== "CompoundPathItem")) return null;
    return _largestPoly(samplePathToPolygons(probe, steps));
}

// Verify (never derive) one element's half-cut. Returns { ok, reason }:
//   reason "missing"    — no "{group.name} halfcut" path on the Halfcut layer.
//   reason "undershoot" — an endpoint falls short of the element's cut line by >= 1mm.
//   reason null         — a valid half-cut exists and both ends reach the cut line.
function validateHalfcut(doc, group) {
    var steps = CONFIG.halfcutSeamSteps || 16;
    var hcLayer = getOrCreateHalfcutLayer(doc);
    var want = group.name + " halfcut", hc = null, i;
    for (i = 0; i < hcLayer.pathItems.length; i++) {
        if (hcLayer.pathItems[i].name === want) { hc = hcLayer.pathItems[i]; break; }
    }
    if (!hc) return { ok: false, reason: "missing" };

    var cutPoly = _halfcutCutPolyForGroup(group, steps);
    if (!cutPoly) return { ok: true, reason: null };   // can't sample the cut → don't false-fail

    var pts = hc.pathPoints, ends = [];
    if (pts && pts.length >= 2) {
        ends.push({ x: pts[0].anchor[0], y: pts[0].anchor[1] });
        ends.push({ x: pts[pts.length - 1].anchor[0], y: pts[pts.length - 1].anchor[1] });
    }
    return _halfcutEndsReachCut(ends, cutPoly, mmToPoints(1));
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

```bash
./tests/integration/unit/run-test-halfcut-validate.sh
```
Expected: `PASS [halfcut-validate]` — all five checks PASS.

- [ ] **Step 5: Confirm the edit landed in the worktree, then commit**

```bash
git -C /Users/joshuadelallana/sticker-production-scripts/.claude/worktrees/investigate-halfcut-error status --short utils/ tests/
git add utils/aiUtils.jsx tests/integration/unit/test-halfcut-validate.jsx tests/integration/unit/run-test-halfcut-validate.sh
git commit -m "feat(halfcut): add validateHalfcut + pure end-reach check (no re-derive)"
```

---

### Task 2: Step 9A verifies (no re-derive) + export gate + golden

**Files:**
- Modify: `illustrator/Step9A_Halfcut.jsx` (rewrite `runHalfcut`, lines 16-56; **move** `_collectHalfcutItems` out to aiUtils — see Step 0)
- Modify: `utils/aiUtils.jsx` (Step 0: relocate `_collectHalfcutItems` here so `StepQA_Halfcut` in Task 4 can share it — `AI_LayoutQA` does not include `Step9A_Halfcut`)
- Modify: `pipelines/AI_ExportFinal.jsx:157-171` (gate message)
- Modify: `tests/integration/ai-export-final/expected.txt` (regenerate)

**Interfaces:**
- Consumes: `validateHalfcut(doc, group)` (Task 1).
- Produces: `_collectHalfcutItems(cutlinesLayer) -> [{ name, group }]` (moved to aiUtils, now shared); `runHalfcut(doc) -> { checked, flagged, flags }` where `flags = [{ name, reason }]`, `reason` ∈ `"missing"|"undershoot"`.

- [ ] **Step 0: Move `_collectHalfcutItems` from `Step9A_Halfcut.jsx` to `utils/aiUtils.jsx`**

Cut the entire `_collectHalfcutItems` function (currently `Step9A_Halfcut.jsx:63-77`) and paste it into `utils/aiUtils.jsx` next to `validateHalfcut` (added in Task 1). It is unchanged. `Step9A_Halfcut.jsx`'s `runHalfcut` (rewritten below) and `StepQA_Halfcut` (Task 4) both resolve it from aiUtils, which every pipeline includes first. Verify no other file defines it:
```bash
grep -rn "function _collectHalfcutItems" utils/ illustrator/
```
Expected: exactly one match, in `utils/aiUtils.jsx`.

- [ ] **Step 1: Rewrite `runHalfcut` in `illustrator/Step9A_Halfcut.jsx`**

Replace the body of `runHalfcut` (lines 16-56) with:

```javascript
function runHalfcut(doc) {
    if (CONFIG.dryRun) {
        log("[step9a] [DRY RUN] would verify half-cut lines for GC/WC/tab elements.");
        return { checked: 0, flagged: 0, flags: [] };
    }
    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        log("[step9a] ERROR | Cutlines layer not found: " + CONFIG.cutlinesLayerName);
        return { checked: 0, flagged: 0, flags: [] };
    }
    var items = _collectHalfcutItems(cutlinesLayer);
    log("[step9a] verifying " + items.length + " GC/WC/tab half-cut(s) — no re-derive.");

    var flags = [], i;
    for (i = 0; i < items.length; i++) {
        var res = validateHalfcut(doc, items[i].group);
        if (res.ok) {
            log("[step9a] ok | " + items[i].name);
        } else {
            flags.push({ name: items[i].name, reason: res.reason });
            log("[step9a] FLAG | " + items[i].name + " | " + res.reason);
        }
    }
    log("[step9a] done | checked=" + items.length + " flagged=" + flags.length);
    return { checked: items.length, flagged: flags.length, flags: flags };
}
```

- [ ] **Step 2: Update the export gate in `pipelines/AI_ExportFinal.jsx`**

Replace lines 157-171 (the `if (halfcutResult.flagged > 0)` block) with:

```javascript
    if (halfcutResult.flagged > 0) {
        var hcMsg = "Half-cut check failed — export halted.\n\n"
            + halfcutResult.flagged + " element(s) need attention:\n";
        var hi;
        for (hi = 0; hi < halfcutResult.flags.length; hi++) {
            var f = halfcutResult.flags[hi];
            var tail = (f.reason === "missing")
                ? ": no half-cut line — draw it"
                : ": half-cut doesn't reach the cut line — extend it";
            hcMsg += "  - " + f.name + tail + "\n";
        }
        hcMsg += "\nDraw / fix the half-cut(s), then re-run export.\n"
            + "No final file was written.\n\nSend this to Josh:\n"
            + copyLogBeside(filesFolder, "Noteworthie_ERROR.log");
        log("[pipeline] HALT | step 9a flagged " + halfcutResult.flagged + " element(s) — aborting before export.");
        scriptAlert(hcMsg);
        return;
    }
```

Also update line 152's success log to read `checked`:

```javascript
    log("[pipeline] step 9a complete | " + halfcutResult.checked + " half-cut(s) verified.");
```

- [ ] **Step 3: Regenerate the `ai-export-final` golden (requires Illustrator + local fixture)**

```bash
cd /Users/joshuadelallana/sticker-production-scripts/.claude/worktrees/investigate-halfcut-error
./tests/integration/ai-export-final/run.sh   # run once
```
Expected: the run reaches Step 10/11 (all fixture half-cuts are valid), and the log now shows
`[step9a] verifying N …`, `[step9a] ok | …` (no `[halfcut] … pts=`), `[step9a] done | checked=N flagged=0`.
Run it a **second** time and confirm the log is byte-identical (determinism), then:

```bash
cp "$HOME/.ai-export-final-test/../AI_ExportFinal.log" tests/integration/ai-export-final/expected.txt 2>/dev/null \
  || cp /tmp/AI_ExportFinal.log tests/integration/ai-export-final/expected.txt
git -C . diff --stat tests/integration/ai-export-final/expected.txt
```
(If the fixture is absent the runner prints `SKIP`; note that in the commit and regenerate on a machine that has it.)

- [ ] **Step 4: Commit**

```bash
git add illustrator/Step9A_Halfcut.jsx pipelines/AI_ExportFinal.jsx tests/integration/ai-export-final/expected.txt
git commit -m "feat(step9a): verify half-cut at export instead of re-deriving; clearer gate"
```

---

### Task 3: Remove the seat-review badge; rename `seatReviewRgb` → `halfcutFlagRgb`

**Files:**
- Modify: `utils/aiUtils.jsx:609-613` (rename `seatReviewRgb` → `halfcutFlagRgb`)
- Modify: `illustrator/Step8c_OffsetPathQA.jsx` (remove lines 90, 252-261, and the badge count at 266)
- Modify: `tests/integration/ai-layout-qa/expected.txt` and `tests/integration/ai-export-final/expected.txt` (regenerate — Step 8c log line changes)

**Interfaces:**
- Produces: `halfcutFlagRgb() -> RGBColor` (26,102,255) — consumed by Task 4.
- Removes: `seatReviewRgb`, `records[i].reviewFlag`, Step 8c "Channel 3".

- [ ] **Step 1: Rename the colour helper in `utils/aiUtils.jsx`**

At line 609, rename and re-comment:

```javascript
// The half-cut QA flag colour — a medium blue, distinct from red (spacing) and amber
// (margin) on the shared Layout QA overlay, and readable on the green Color Block.
function halfcutFlagRgb() {
    var c = new RGBColor();
    c.red = 26; c.green = 102; c.blue = 255;
    return c;
}
```

- [ ] **Step 2: Remove the seat-review plumbing in `illustrator/Step8c_OffsetPathQA.jsx`**

- Delete line 90 (`reviewFlag: clNote ? clNote.needsReview : false`). If it is the last field in the record literal, also remove the trailing comma on the line above.
- Delete the whole "Channel 3" block, lines 252-261 (from the `// Channel 3 …` comment through the closing `}` of the `for` loop and the `var reviews`/`reviewBlue` locals).
- In the overlay log line (originally line 263-266), delete the `+ reviews + " seat-review badge(s)"` fragment so the line ends after the prior count.

- [ ] **Step 3: Verify nothing else references the removed names**

```bash
cd /Users/joshuadelallana/sticker-production-scripts/.claude/worktrees/investigate-halfcut-error
grep -rn "seatReviewRgb\|reviewFlag\|reviewBlue\|seat-review badge" utils/ illustrator/ pipelines/
```
Expected: **no matches** (all references removed; `halfcutFlagRgb` is not yet called until Task 4 — an unused function is fine).

- [ ] **Step 4: Regenerate the two affected goldens (Illustrator + fixtures)**

```bash
./tests/integration/ai-layout-qa/run.sh      # run twice; confirm identical
cp /tmp/AI_LayoutQA.log tests/integration/ai-layout-qa/expected.txt
./tests/integration/ai-export-final/run.sh   # run twice; confirm identical
cp /tmp/AI_ExportFinal.log tests/integration/ai-export-final/expected.txt
```
Expected diff: the `[step8c] overlay | …` line no longer prints `… seat-review badge(s)`.

- [ ] **Step 5: Commit**

```bash
git add utils/aiUtils.jsx illustrator/Step8c_OffsetPathQA.jsx tests/integration/ai-layout-qa/expected.txt tests/integration/ai-export-final/expected.txt
git commit -m "refactor(qa): remove seat-review badge; rename seatReviewRgb -> halfcutFlagRgb"
```

---

### Task 4: `StepQA_Halfcut` advisory overlay + wire into `AI_LayoutQA`

**Files:**
- Create: `illustrator/StepQA_Halfcut.jsx`
- Modify: `pipelines/AI_LayoutQA.jsx` (`#include` line ~4; call after NQI ~line 121; alert line ~150)
- Modify: `tests/integration/ai-layout-qa/expected.txt` (regenerate)

**Interfaces:**
- Consumes: `validateHalfcut(doc, group)`, `_collectHalfcutItems(cutlinesLayer)`, `_halfcutCutPolyForGroup`, `_distPointToPolygon`, `pointInPolygon` (all in aiUtils after Tasks 1-2); `halfcutFlagRgb()` (Task 3); `getOrCreateQALayer(doc, name, false)`, `qaHaloElement`, `qaDrawDot`, `qaDrawSegment`, `getOrCreateHalfcutLayer`, `findGroupMember`, `mmToPoints` (existing).
- Produces: `runHalfcutQA(doc) -> { checked, flagged, flags }`.

- [ ] **Step 1: Create `illustrator/StepQA_Halfcut.jsx`**

```javascript
// StepQA_Halfcut.jsx — Phase function only. #included by AI_LayoutQA.jsx.
// Requires: aiUtils.jsx, CONFIG in scope. Advisory ONLY (never gates export).
//
// APPENDS blue marks to the shared "Layout QA" overlay (Step 8c reset it first, StepQA
// appends). Per GC/WC/tab element it calls validateHalfcut and draws:
//   missing    → a translucent blue halo of the element's cut contour + a blue badge dot
//   undershoot → a blue dot on the short endpoint + a connector to the nearest cut point
// Real half-cut / cut geometry is never touched. Returns { checked, flagged, flags }.

function runHalfcutQA(doc) {
    if (CONFIG.dryRun) {
        log("[stepQA-halfcut] [DRY RUN] would flag missing/undershoot half-cuts.");
        return { checked: 0, flagged: 0, flags: [] };
    }
    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) { log("[stepQA-halfcut] ERROR | Cutlines layer not found."); return { checked: 0, flagged: 0, flags: [] }; }

    var items = _collectHalfcutItems(cutlinesLayer);   // shared with Step 9A (same file set)
    var overlay = getOrCreateQALayer(doc, CONFIG.qaLayerName, false);   // append, don't reset
    var blue = halfcutFlagRgb();
    var steps = CONFIG.halfcutSeamSteps || 16;

    var flags = [], i;
    for (i = 0; i < items.length; i++) {
        var group = items[i].group;
        var res = validateHalfcut(doc, group);
        if (res.ok) { log("[stepQA-halfcut] ok | " + items[i].name); continue; }
        flags.push({ name: items[i].name, reason: res.reason });
        if (res.reason === "missing") {
            _qaHalfcutMissing(overlay, group, blue);
        } else {
            _qaHalfcutUndershoot(doc, overlay, group, blue, steps);
        }
        log("[stepQA-halfcut] FLAG | " + items[i].name + " | " + res.reason);
    }
    log("[stepQA-halfcut] done | checked=" + items.length + " flagged=" + flags.length);
    return { checked: items.length, flagged: flags.length, flags: flags };
}

// MISSING: translucent halo of the cut contour + a badge dot at its top-centre.
function _qaHalfcutMissing(overlay, group, blue) {
    var cut = findGroupMember(group, "");
    if (!cut) return;
    qaHaloElement(overlay, cut, blue, 16);
    var b = cut.geometricBounds;   // [l, t, r, b] (AI y-up)
    qaDrawDot(overlay, (b[0] + b[2]) / 2, b[1], mmToPoints(2.5), blue, 90);
}

// UNDERSHOOT: dot on each short endpoint + a connector to the nearest cut-contour vertex.
function _qaHalfcutUndershoot(doc, overlay, group, blue, steps) {
    var hcLayer = getOrCreateHalfcutLayer(doc);
    var want = group.name + " halfcut", hc = null, i;
    for (i = 0; i < hcLayer.pathItems.length; i++) {
        if (hcLayer.pathItems[i].name === want) { hc = hcLayer.pathItems[i]; break; }
    }
    if (!hc || !hc.pathPoints || hc.pathPoints.length < 2) return;
    var cutPoly = _halfcutCutPolyForGroup(group, steps);
    if (!cutPoly) return;

    var pts = hc.pathPoints, minGap = mmToPoints(1);
    var ends = [ { x: pts[0].anchor[0], y: pts[0].anchor[1] },
                 { x: pts[pts.length - 1].anchor[0], y: pts[pts.length - 1].anchor[1] } ];
    var e;
    for (e = 0; e < ends.length; e++) {
        var p = ends[e];
        if (!(pointInPolygon(p, cutPoly) && _distPointToPolygon(p, cutPoly) >= minGap)) continue;
        var near = _qaNearestPolyVertex(p, cutPoly);
        qaDrawSegment(overlay, p.x, p.y, near.x, near.y, blue, mmToPoints(0.35), 100);
        qaDrawDot(overlay, p.x, p.y, mmToPoints(1.2), blue, 90);
    }
}

// Nearest polygon VERTEX to p (a cheap stand-in for the nearest contour point).
function _qaNearestPolyVertex(p, poly) {
    var best = poly[0], bd = 1e15, i, dx, dy, d;
    for (i = 0; i < poly.length; i++) {
        dx = poly[i].x - p.x; dy = poly[i].y - p.y; d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = poly[i]; }
    }
    return best;
}
```

- [ ] **Step 2: Wire into `pipelines/AI_LayoutQA.jsx`**

Add the include after the StepQA_NestingQuality include (~line 4):

```javascript
#include "../illustrator/StepQA_Halfcut.jsx"
```

After the NQI phase (after line 129, before `log("[pipeline] === AI_LayoutQA done ===")`), add:

```javascript
    // ── Phase 3: Half-cut check (advisory) ─────────────────────────────────────
    log("[pipeline] --- Half-cut check ---");
    var hcQaResult;
    try {
        hcQaResult = runHalfcutQA(doc);
    } catch (e) {
        log("[pipeline] ERROR | half-cut QA line " + e.line + ": " + e.message);
        hcQaResult = { checked: 0, flagged: 0, flags: [] };
    }
```

In the combined alert (after the NQI block, ~line 163), add:

```javascript
    if (hcQaResult.flagged > 0) {
        msg += "\nHalf-cut: " + hcQaResult.flagged + " of " + hcQaResult.checked
            + " FLAGGED (blue) — missing or short of the cut line.\n"
            + "  Fix before exporting — AI_ExportFinal will halt on these.\n";
    } else {
        msg += "\nHalf-cut: all " + hcQaResult.checked + " OK.\n";
    }
```

- [ ] **Step 3: Regenerate the `ai-layout-qa` golden**

```bash
cd /Users/joshuadelallana/sticker-production-scripts/.claude/worktrees/investigate-halfcut-error
./tests/integration/ai-layout-qa/run.sh   # run twice; confirm identical
```
Expected: new `[stepQA-halfcut] …` lines; `[pipeline] --- Half-cut check ---`. Then:

```bash
cp /tmp/AI_LayoutQA.log tests/integration/ai-layout-qa/expected.txt
```

- [ ] **Step 4: Commit**

```bash
git add illustrator/StepQA_Halfcut.jsx pipelines/AI_LayoutQA.jsx tests/integration/ai-layout-qa/expected.txt
git commit -m "feat(layout-qa): advisory blue flags for missing/undershoot half-cuts"
```

---

### Task 5: Relocate the seat-review signal to the seating pipelines

**Files:**
- Modify: `utils/aiUtils.jsx` (add `collectSeatReviewNames`)
- Modify: `pipelines/AI_NormaliseCaptions.jsx` (append advisory line to completion alert)
- Modify: `pipelines/AI_BuildAndExportCutlines.jsx` (append advisory line to completion alert)
- Modify: `tests/integration/ai-normalise-captions/expected.txt` + `tests/integration/ai-build-and-export-cutlines/expected.txt` (regenerate if the added log line appears in them)

**Interfaces:**
- Consumes: `findLayer`, `parseNote` (existing).
- Produces: `collectSeatReviewNames(doc) -> [displayName, …]` (elements whose Cutlines-group note carries `needsReview`).

- [ ] **Step 1: Write the failing unit test**

Append to `tests/integration/unit/test-halfcut-validate.jsx` (reuses the same runner/log):

```javascript
// collectSeatReviewNames: parseNote must treat "WC|1|a10|R" as review, "WC|1|a10" as not.
check("note-R-is-review",   parseNote("WC|1|a10|R").needsReview, true);
check("note-noR-not-review", parseNote("WC|1|a10").needsReview,   false);
```

- [ ] **Step 2: Run to verify it passes for parseNote and defines the contract**

```bash
./tests/integration/unit/run-test-halfcut-validate.sh
```
Expected: PASS for `note-R-is-review` / `note-noR-not-review` (parseNote already supports `R`). This pins the contract `collectSeatReviewNames` relies on.

- [ ] **Step 3: Add `collectSeatReviewNames` to `utils/aiUtils.jsx`**

```javascript
// Display names of every Cutlines-group element whose note carries the seat-review flag
// ("|R"). Consumed by the seating pipelines' completion dialogs (the seat-review badge was
// removed from the QA overlay). Returns [] when none.
function collectSeatReviewNames(doc) {
    var out = [], layer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!layer) return out;
    var i, g, note;
    for (i = 0; i < layer.pageItems.length; i++) {
        g = layer.pageItems[i];
        if (g.parent !== layer || g.typename !== "GroupItem") continue;
        note = parseNote(g.note);
        if (note && note.needsReview) out.push(g.name);
    }
    return out;
}
```

- [ ] **Step 4: Append the advisory line in both seating pipelines**

In `pipelines/AI_NormaliseCaptions.jsx`, just before its completion `scriptAlert(...)`, add:

```javascript
    var _seatReview = collectSeatReviewNames(doc);
    if (_seatReview.length > 0) {
        msg += "\n⚠ " + _seatReview.length + " caption(s) may need a seating check:\n  "
            + _seatReview.join(", ") + "\n";
    }
```
Do the same in `pipelines/AI_BuildAndExportCutlines.jsx` before its completion alert (match the local variable name that holds the alert text there; if it builds the string inline, concatenate the same block onto it). Confirm the alert-text variable name first:

```bash
grep -n "scriptAlert\|var msg\|+= \"" pipelines/AI_NormaliseCaptions.jsx pipelines/AI_BuildAndExportCutlines.jsx | head
```

- [ ] **Step 5: Regenerate any affected pipeline goldens**

```bash
cd /Users/joshuadelallana/sticker-production-scripts/.claude/worktrees/investigate-halfcut-error
./tests/integration/ai-normalise-captions/run.sh        # run twice; confirm identical
cp /tmp/AI_NormaliseCaptions.log tests/integration/ai-normalise-captions/expected.txt
./tests/integration/ai-build-and-export-cutlines/run.sh # run twice; confirm identical
# copy its log to that suite's expected.txt (see its run.sh for the log path)
```
(The advisory line is only logged if a fixture element carries `|R`; if none do, the goldens are unchanged — note that in the commit.)

- [ ] **Step 6: Commit**

```bash
git add utils/aiUtils.jsx pipelines/AI_NormaliseCaptions.jsx pipelines/AI_BuildAndExportCutlines.jsx tests/
git commit -m "feat(captions): surface seat-review (|R) in normalise + build completion dialogs"
```

---

## Self-Review

**Spec coverage:** Component 1 → Task 1; Component 2 (Step 9A + gate) → Task 2; Component 3 (StepQA_Halfcut) → Task 4; Component 4 (remove badge + relocate) → Tasks 3 + 5. Undershoot rule (short ≥ 1 mm), blue reuse, "draw" remedy, no file recovery — all covered.

**Type consistency:** `validateHalfcut(doc, group) -> {ok, reason}` used identically in Task 2 (Step 9A) and Task 4 (StepQA). `_halfcutCutPolyForGroup` / `_distPointToPolygon` / `pointInPolygon` defined in Task 1, reused in Task 4. `halfcutFlagRgb()` defined in Task 3, consumed in Task 4. `runHalfcut` returns `{checked, flagged, flags}` (Task 2) — matches AI_ExportFinal's `halfcutResult.checked/.flagged/.flags` usage.

**Ordering:** Task 1 (validator, no callers) → Task 2 (export uses it) → Task 3 (remove badge, free blue) → Task 4 (StepQA uses validator + blue) → Task 5 (relocate signal). Each commit leaves the tree green (`halfcutFlagRgb` is an unused-but-valid function between Tasks 3 and 4).

**Golden note:** Tasks 2/3/4/5 each regenerate goldens live in Illustrator against local-only `*.ai` fixtures; the undershoot integration case needs a hand-made fixture (one element's half-cut endpoint dragged ≥ 1 mm inside its cut) — create it manually per `memory/feedback_test_fixtures`.
