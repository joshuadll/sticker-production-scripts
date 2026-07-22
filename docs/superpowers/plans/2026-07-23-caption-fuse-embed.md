# Caption Fuse-Embed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a caption that fails to fuse (Tatra) join, by nudging only that caption toward the art in small steps and re-uniting until the boolean fuses — leaving every already-fusing caption at zero embed (no bump).

**Architecture:** A shared `fuseCaptionCutline` wraps the two caption-unite sites. It calls the unchanged boolean `deriveCutline`; if a pure detector finds the caption is still a separate leaf, it translates the caption assembly `STEP` mm toward the art (direction from `_aiSeatGeometry`) and re-unites, iterating until fused or a cap is hit (hard error). The detached-caption detector is pure and node-tested.

**Tech Stack:** ExtendScript (ES3) for Illustrator; Node.js (no framework) for the pure detector test; bash + osascript for live integration.

## Global Constraints

- **ES3 only** in `utils/aiUtils.jsx`: no `let`/`const`, no arrow functions, no template literals. Match surrounding style.
- `utils/aiUtils.jsx` has no `#target`/`CONFIG`/`main`; `CONFIG` and `log` are runtime globals — guard `CONFIG` with `typeof CONFIG !== "undefined"`.
- **`captionSeatOverlapMm` stays 0** — the seat (`seatPlateToOutline`) is NOT modified. This is a post-seat rescue. Do not add any seat embed.
- **STEP = 0.02 mm** (`captionFuseStepMm`), **CAP = 0.3 mm** (`captionFuseCapMm`).
- **Detached-caption detector tolerances:** a fused-cut leaf matches the plate iff its bbox-centroid is within **10 pt** of the plate's centroid AND its bbox area is within **0.75–1.25×** the plate's bbox area.
- **Hard error, no silent bad cutline:** reaching the cap without fusing → `buildCaption` returns `{ ok:false }` (as it already does for a failed seat); `reuniteCutline` throws (surfaced by the pipeline's per-phase try/catch).
- **`deriveCutline` is unchanged** (boolean + the blob-removal already on this branch). Only a caption that fails to fuse ever moves.
- **Only the caption path** uses `fuseCaptionCutline`. The default peel-tab path keeps calling `deriveCutline` directly.
- Reuse: `boundsCenter`, `_aiSeatGeometry`, `_translateItems`, `mmToPoints`, `_r1`, `strokeRecursive`, `blackRgb`, `findGroupMember`, `deriveCutline`.
- aiUtils log prefix for this feature: `[fuse]`.
- Node test: read `utils/aiUtils.jsx` as text, regex-`extract` the function, `eval`, test on plain arrays. Model on `tests/integration/unit/test-halfcut-tail-dir.js`.

---

### Task 1: Pure detached-caption detector (`_captionLeafDetached`) — node TDD

**Files:**
- Modify: `utils/aiUtils.jsx` (add near `boundsCenter`, ~line 65)
- Test: `tests/integration/unit/test-caption-fused.js` (create)
- Runner: `tests/integration/unit/run-test-caption-fused.sh` (create)

**Interfaces:**
- Produces: `_captionLeafDetached(leafMetrics, plate) -> Boolean`, where `leafMetrics = [{ c:{x,y}, area:Number }, ...]` (the fused cut's leaves) and `plate = { c:{x,y}, area:Number }`. Returns true iff some leaf's centroid is within 10 pt of `plate.c` AND its area is within 0.75–1.25× `plate.area`. Pure.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/unit/test-caption-fused.js`:

```javascript
// Pure-geometry unit test for _captionLeafDetached in aiUtils.jsx: is a fused-cut leaf actually
// the (un-fused) caption plate? centroid within 10pt AND area within 0.75-1.25x of the plate.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name){var re=new RegExp('function '+name+'\\s*\\([\\s\\S]*?\\n}');var m=src.match(re);if(!m)throw new Error('could not extract '+name);return m[0];}
eval(extract('_captionLeafDetached'));

var fails=0;
function check(c,m){if(!c){console.log('FAIL: '+m);fails++;}}

var PLATE = { c:{x:50,y:10}, area:50 };

// Detached: a leaf coincident with the plate (centroid + area match) alongside the big contour.
check(_captionLeafDetached([{c:{x:50,y:50},area:16000},{c:{x:50,y:10.2},area:49}], PLATE) === true,
  'plate-matching leaf => detached');

// Fused: single contour, no plate-matching leaf.
check(_captionLeafDetached([{c:{x:50,y:50},area:16000}], PLATE) === false,
  'single contour => fused');

// Fused: a real art hole (small leaf, but far from the plate centroid) is NOT the plate.
check(_captionLeafDetached([{c:{x:50,y:50},area:16000},{c:{x:50,y:70},area:40}], PLATE) === false,
  'real hole far from plate => not detached');

// Fused: a leaf at the plate location but wrong area (ratio 4) is not the plate.
check(_captionLeafDetached([{c:{x:50,y:50},area:16000},{c:{x:50,y:10},area:200}], PLATE) === false,
  'wrong-area leaf at plate location => not detached');

// Guard: zero-area plate never matches.
check(_captionLeafDetached([{c:{x:50,y:10},area:0}], {c:{x:50,y:10},area:0}) === false,
  'zero-area plate => not detached (guard)');

if(fails===0)console.log('PASS: caption-fused'); else {console.log(fails+' FAIL');process.exit(1);}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/integration/unit/test-caption-fused.js`
Expected: `Error: could not extract _captionLeafDetached`.

- [ ] **Step 3: Implement**

In `utils/aiUtils.jsx`, immediately AFTER `function boundsCenter(...) {...}` (~line 70), add:

```javascript
// True iff some fused-cut leaf IS the caption plate — i.e. the caption failed to fuse and remains
// a separate piece. A leaf matches the plate when its bbox-centroid is within 10pt of the plate's
// AND its bbox area is within 0.75-1.25x the plate's. leafMetrics = [{c:{x,y},area}], plate =
// {c:{x,y},area}. A single contour, or a real art-hole leaf (off the plate centroid), is NOT
// flagged. Pure; node-testable.
function _captionLeafDetached(leafMetrics, plate) {
    if (!leafMetrics || !plate || plate.area <= 0) return false;
    var DIST2 = 100;   // (10pt)^2
    var i, dx, dy, ratio;
    for (i = 0; i < leafMetrics.length; i++) {
        dx = leafMetrics[i].c.x - plate.c.x; dy = leafMetrics[i].c.y - plate.c.y;
        if (dx * dx + dy * dy > DIST2) continue;
        ratio = leafMetrics[i].area / plate.area;
        if (ratio >= 0.75 && ratio <= 1.25) return true;
    }
    return false;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/integration/unit/test-caption-fused.js`
Expected: `PASS: caption-fused`

- [ ] **Step 5: Runner + commit**

Create `tests/integration/unit/run-test-caption-fused.sh`:

```bash
#!/bin/bash
set -euo pipefail
STEP="caption-fused-unit"; DIR="$(cd "$(dirname "$0")" && pwd)"
echo "[$STEP] Running _captionLeafDetached unit tests (node)..."
if ! command -v node >/dev/null 2>&1; then echo "SKIP [$STEP]: node not found."; exit 0; fi
if node "$DIR/test-caption-fused.js"; then echo "PASS [$STEP]"; exit 0; else echo "FAIL [$STEP]"; exit 1; fi
```

Then:
```bash
chmod +x tests/integration/unit/run-test-caption-fused.sh
git add utils/aiUtils.jsx tests/integration/unit/test-caption-fused.js tests/integration/unit/run-test-caption-fused.sh
git commit -m "feat(cutline): _captionLeafDetached — detect a caption that didn't fuse (pure)"
```

---

### Task 2: `fuseCaptionCutline` + wire both call sites + CONFIG

**Files:**
- Modify: `utils/aiUtils.jsx` — add `_fusedLeafMetrics`, `_plateMetrics`, `fuseCaptionCutline` (before `deriveCutline`); rewire `buildCaption` and `reuniteCutline`.
- Modify: `pipelines/AI_BuildAndExportCutlines.jsx`, `pipelines/AI_NormaliseCaptions.jsx`, `pipelines/AI_BuildCutlines.jsx` — add CONFIG knobs.

**Interfaces:**
- Consumes: `_captionLeafDetached` (Task 1); `boundsCenter`, `_aiSeatGeometry`, `_translateItems`, `mmToPoints`, `_r1`, `strokeRecursive`, `blackRgb`, `findGroupMember`, `deriveCutline`.
- Produces: `fuseCaptionCutline(outline, plate, moveItems, strokePt, opts) -> { cut, embeddedMm, ok, reason }`. `moveItems` = the caption assembly items to translate on a rescue. `opts` = `{ name, stepMm, capMm }` (stepMm/capMm default to CONFIG then 0.02/0.3). On success returns the stroked fused cut; on failure `{ cut:null, ok:false, reason }`.

- [ ] **Step 1: Add the helpers**

In `utils/aiUtils.jsx`, immediately BEFORE `function deriveCutline`, add:

```javascript
// Leaf metrics [{c,area}] of a fused-cut item (PathItem / CompoundPathItem / GroupItem).
function _fusedLeafMetrics(item) {
    var acc = [];
    (function walk(it) {
        var t = it.typename, i;
        if (t === "PathItem") acc.push(it);
        else if (t === "CompoundPathItem") { for (i = 0; i < it.pathItems.length; i++) acc.push(it.pathItems[i]); }
        else if (t === "GroupItem") { for (i = 0; i < it.pageItems.length; i++) walk(it.pageItems[i]); }
    })(item);
    var out = [], i, b;
    for (i = 0; i < acc.length; i++) {
        b = acc[i].geometricBounds;
        out.push({ c: boundsCenter(b), area: Math.abs((b[2] - b[0]) * (b[1] - b[3])) });
    }
    return out;
}

// {c,area} of a single item's bbox.
function _plateMetrics(plate) {
    var b = plate.geometricBounds;
    return { c: boundsCenter(b), area: Math.abs((b[2] - b[0]) * (b[1] - b[3])) };
}

// Unite outline + plate via the boolean deriveCutline; if the caption fused, return the stroked
// cut. If it did NOT fuse (caption is a separate leaf), nudge every item in moveItems stepMm toward
// the art (direction from _aiSeatGeometry) and re-unite, iterating until fused or capMm is reached
// (hard error). The seat is untouched; only a non-fusing caption moves. Returns
// { cut, embeddedMm, ok, reason }.
function fuseCaptionCutline(outline, plate, moveItems, strokePt, opts) {
    opts = opts || {};
    var name   = opts.name || "(caption)";
    var stepMm = (opts.stepMm != null) ? opts.stepMm
               : ((typeof CONFIG !== "undefined" && CONFIG.captionFuseStepMm != null) ? CONFIG.captionFuseStepMm : 0.02);
    var capMm  = (opts.capMm != null) ? opts.capMm
               : ((typeof CONFIG !== "undefined" && CONFIG.captionFuseCapMm != null) ? CONFIG.captionFuseCapMm : 0.3);
    var geom = _aiSeatGeometry(plate, outline);
    var step = mmToPoints(stepMm);
    var embeddedMm = 0;

    var cut = deriveCutline(outline, plate);
    while (_captionLeafDetached(_fusedLeafMetrics(cut), _plateMetrics(plate))) {
        if (embeddedMm + stepMm > capMm + 1e-9) {
            try { cut.remove(); } catch (e0) {}
            return { cut: null, embeddedMm: embeddedMm, ok: false,
                     reason: "caption '" + name + "' won't fuse within " + capMm + "mm" };
        }
        var tx = geom.travelIsX ? geom.sign * step : 0;
        var ty = geom.travelIsX ? 0 : geom.sign * step;
        _translateItems(moveItems, tx, ty);
        embeddedMm += stepMm;
        try { cut.remove(); } catch (e1) {}
        cut = deriveCutline(outline, plate);
    }
    strokeRecursive(cut, strokePt, blackRgb());
    if (embeddedMm > 0) log("[fuse] " + name + " | embedded " + _r1(embeddedMm) + "mm to fuse caption");
    return { cut: cut, embeddedMm: embeddedMm, ok: true, reason: null };
}
```

- [ ] **Step 2: Rewire `buildCaption`**

Find in `buildCaption` (search for `var cut = deriveCutline(outline, pill);`):

```javascript
    // Unite outline + pill into the fused cut; bundle the separable members.
    var cut = deriveCutline(outline, pill);
    strokeRecursive(cut, (opts.strokePt != null ? opts.strokePt : 0.25), blackRgb());
    var group = assembleElementGroup(layer, name, outline, pill, cut);
```

Replace those three lines with:

```javascript
    // Unite outline + pill into the fused cut (fuse-rescue a caption that won't join at zero embed).
    var moveItems = [pill, rideGroup];
    var fuse = fuseCaptionCutline(outline, pill, moveItems,
        (opts.strokePt != null ? opts.strokePt : 0.25), { name: name });
    if (!fuse.ok) {
        try { textFrame.move(layer, ElementPlacement.PLACEATEND); } catch (e1) {}
        try { if (plateRaster) plateRaster.move(layer, ElementPlacement.PLACEATEND); } catch (e2) {}
        try { rideGroup.remove(); } catch (e3) {}
        log("[fuse] " + name + " | " + fuse.reason);
        return { ok: false, needsReview: true, reason: fuse.reason };
    }
    var cut = fuse.cut;
    var group = assembleElementGroup(layer, name, outline, pill, cut);
```

(`fuseCaptionCutline` already strokes `cut`, so the separate `strokeRecursive` is gone. `moveItems` uses `rideGroup` — it still holds the text + raster at this point, so nudging it moves the printed caption with the pill, exactly as the seat did.)

- [ ] **Step 3: Rewire `reuniteCutline`**

Replace the whole `reuniteCutline` body with:

```javascript
function reuniteCutline(group, outline, plate, strokePt) {
    var outlineHidden = outline.hidden;
    var plateHidden   = plate.hidden;
    outline.hidden = false;
    plate.hidden   = false;

    var oldCutline = findGroupMember(group, "");

    var moveItems = [plate];
    var capText   = findGroupMember(group, " caption text");
    var capRaster = findGroupMember(group, " caption plate");
    if (capText)   moveItems.push(capText);
    if (capRaster) moveItems.push(capRaster);
    var fuse = fuseCaptionCutline(outline, plate, moveItems, strokePt, { name: group.name });
    if (!fuse.ok) {
        outline.hidden = outlineHidden;
        plate.hidden   = plateHidden;
        throw new Error(fuse.reason);   // surfaced by the pipeline's per-phase try/catch
    }
    var newCutline = fuse.cut;

    if (oldCutline) oldCutline.remove();
    newCutline.name = group.name;
    newCutline.move(group, ElementPlacement.PLACEATBEGINNING);

    outline.hidden = outlineHidden;
    plate.hidden   = plateHidden;
    return newCutline;
}
```

- [ ] **Step 4: Add CONFIG knobs to the three AI pipelines**

In EACH of `pipelines/AI_BuildAndExportCutlines.jsx`, `pipelines/AI_NormaliseCaptions.jsx`, `pipelines/AI_BuildCutlines.jsx`, add these two lines to the CONFIG object, immediately after the `captionSeatOverlapMm:` line:

```javascript
    captionFuseStepMm:   0.02,   // fuse-rescue: nudge a non-fusing caption this far/step toward art
    captionFuseCapMm:    0.3,    // fuse-rescue: give up (hard error) past this total embed
```

- [ ] **Step 5: Syntax check + node unit sweep**

```bash
cp utils/aiUtils.jsx /tmp/aiUtils-check.js && node --check /tmp/aiUtils-check.js && echo OK
node tests/integration/unit/test-caption-fused.js
```
Expected: `OK`, then `PASS: caption-fused`.

- [ ] **Step 6: Commit**

```bash
git add utils/aiUtils.jsx pipelines/AI_BuildAndExportCutlines.jsx pipelines/AI_NormaliseCaptions.jsx pipelines/AI_BuildCutlines.jsx
git commit -m "feat(cutline): fuseCaptionCutline — nudge a non-fusing caption until it joins

Wrap the caption unite at buildCaption + reuniteCutline: fuse at zero embed if it
joins; else nudge the caption assembly captionFuseStepMm toward the art and re-unite
until fused, cap at captionFuseCapMm (hard error). Seat/captionSeatOverlapMm untouched."
```

---

### Task 3: Live validation + golden regeneration

**Files:**
- Modify (regenerate): `tests/integration/ai-build-and-export-cutlines/expected.txt`, `tests/integration/ai-normalise-captions/expected.txt` (and check `ai-import-nesting`, `ai-export-final`).

- [ ] **Step 1: Build-export live run (needs Illustrator)**

Run: `tests/integration/ai-build-and-export-cutlines/run.sh`
Then the join-scan:
```bash
osascript -e 'tell application "Adobe Illustrator" to do javascript file (POSIX file "/tmp/join-scan.jsx")'
```
Confirm: runner PASSES `28 caption(s) built, 0 failed`; join-scan reports `caption NOT joined (pill is a separate leaf): 0`; classification line `16 regular, 12 irregular` unchanged; the log has exactly ONE `[fuse] Tatra chamois | embedded <X>mm to fuse caption` line (record X — the empirical minimum) and NO `[fuse]` line for any other element. If Tatra logs the cap value or the runner reports a failed caption, STOP and inspect (the cap may be too small, or the detector mis-fired).

> If `/tmp/join-scan.jsx` is absent, recreate it: for each `GroupItem` in the `Cutlines` layer with a `"<name> plate"` member, compare the plate's bbox-centroid+area to each leaf of the `"<name>"` fused member; a leaf within 10 pt and area-ratio 0.75–1.25 of the plate = detached; print the count and names.

- [ ] **Step 2: Verify the golden diff is benign, then regenerate**

The golden diff WILL fail (a `[fuse]` line appears + Tatra's cut geometry changed). Confirm the ONLY differences are: the added `[fuse] Tatra chamois` line, and Tatra's own `[step7a]`/geometry lines. No OTHER element's seat/classification/counts changed. If clean:
```bash
cp /tmp/AI_BuildAndExportCutlines.log tests/integration/ai-build-and-export-cutlines/expected.txt
```
Re-run; confirm `PASS ... log matches golden`. If any other element changed, STOP and investigate.

- [ ] **Step 3: Normalise — idempotency + golden**

Run: `tests/integration/ai-normalise-captions/run.sh`
Confirm reset + idempotency PASS, and that run #2 does NOT re-nudge an already-fused caption (no growing embed; a caption fused in run #1 stays fused at the same position → no `[fuse]` line in run #2 for it, or the same embed value — never increasing). Then regenerate:
```bash
cp /tmp/normalise-captions-run1.log tests/integration/ai-normalise-captions/expected.txt
```
Re-run; confirm PASS.

- [ ] **Step 4: Import-nesting + export-final — run, regen only if benign**

```bash
tests/integration/ai-import-nesting/run.sh
tests/integration/ai-export-final/run.sh
```
For any whose golden diff is purely the fuse-rescue change (Tatra only; no new failures, same counts), regenerate its golden per its runner and re-run to green. Any NEW failure (a caption that no longer builds, classification flip, half-cut off the line) → STOP and investigate.

- [ ] **Step 5: Full suite + commit**

```bash
tests/integration/run-all.sh
```
Expected: all PASS / SKIP (SKIP only where an Adobe app is unavailable), no FAIL.
```bash
git add tests/integration/*/expected.txt tests/integration/*/expected 2>/dev/null || true
git commit -m "test: regenerate goldens for caption fuse-embed

Tatra fuses via a <X>mm nudge (empirical minimum); 27 others at zero embed;
classification unchanged; normalise idempotent."
```

---

## Self-Review

**Spec coverage:**
- Wrap the two unite sites, keep the boolean → Task 2 (`fuseCaptionCutline` + rewire). ✓
- Detect detached (10 pt / 0.75–1.25) → Task 1 (`_captionLeafDetached`). ✓
- Nudge only non-fusers, iterate until fused → Task 2 `fuseCaptionCutline` loop. ✓
- STEP 0.02 mm / CAP 0.3 mm as CONFIG → Task 2 Step 4. ✓
- `captionSeatOverlapMm` stays 0 (seat untouched) → no seat change in any task. ✓
- Hard error (buildCaption `ok:false`, reuniteCutline throws) → Task 2 Steps 2–3. ✓
- Runs at birth + normalise → Task 2 rewires both. ✓
- Detector node-tested; live join/classification/idempotency/goldens → Tasks 1 + 3. ✓
- Tab path unchanged → only the caption sites are rewired (tab path still calls `deriveCutline`). ✓

**Placeholder scan:** none — all steps carry literal code/commands. `<X>` is a value to be filled from the live run (Task 3), not a code placeholder.

**Type consistency:** `_captionLeafDetached(leafMetrics, plate)` signature identical across Task 1 (def + test) and Task 2 (`fuseCaptionCutline` call passing `_fusedLeafMetrics(cut)` and `_plateMetrics(plate)`, both `{c,area}` shaped). `fuseCaptionCutline(outline, plate, moveItems, strokePt, opts) -> {cut, embeddedMm, ok, reason}` used consistently at both rewired call sites. `_aiSeatGeometry` → `{travelIsX, sign}` matches the translate direction logic.
