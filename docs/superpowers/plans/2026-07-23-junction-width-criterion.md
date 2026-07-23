# Junction-Width Stop Criterion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fuse-rescue's too-weak topology stop-test with a junction-WIDTH test, so a caption that the boolean "fuses" through a zero-width tangent pinch (Tram) gets nudged into a real join.

**Architecture:** The junction ratio is measured directly from `plate` vs `outline` (span between the outermost plate∩art crossings ÷ plate width) — no boolean needed. `fuseCaptionCutline` measures, nudges while `ratio < captionMinJunctionRatio`, then runs `deriveCutline` ONCE. The old leaf-topology detector and its helpers are deleted as dead code.

**Tech Stack:** ExtendScript (ES3); Node.js (no framework) for the pure span math; bash + osascript for live validation.

## Global Constraints

- **ES3 only** in `utils/aiUtils.jsx`: no `let`/`const`, no arrow functions, no template literals.
- `CONFIG`/`log` are runtime globals — guard `CONFIG` with `typeof CONFIG !== "undefined"`.
- **`captionMinJunctionRatio` = 0.40**, **`captionFuseStepMm` = 0.01** (down from 0.02), `captionFuseCapMm` = 0.3.
- **`captionSeatOverlapMm` stays 0** — the seat is NOT modified.
- **`deriveCutline` unchanged** (boolean + blob removal); called ONCE per caption, after the nudge loop.
- Only the caption path uses `fuseCaptionCutline`; the tab path still calls `deriveCutline` directly.
- Hard error on cap: `buildCaption` returns `{ok:false}`; `reuniteCutline` throws.
- Junction sampling density: **48** steps (the density the live measurements used).
- Reuse: `_largestPoly`, `samplePathToPolygons`, `_pointInPolysEO`, `_segCrossArt`, `_aiSeatGeometry`, `_translateItems`, `mmToPoints`, `strokeRecursive`, `blackRgb`.
- Node test: read `utils/aiUtils.jsx` as text, regex-`extract` the function (column-0 closing brace), `eval`, test on plain arrays.

---

### Task 1: Pure farthest-pair span + delete the superseded detector

**Files:**
- Modify: `utils/aiUtils.jsx` — add `_farthestPairDist`; DELETE `_captionLeafDetached`, `_fusedLeafMetrics`, `_plateMetrics`.
- Delete: `tests/integration/unit/test-caption-fused.js`, `tests/integration/unit/run-test-caption-fused.sh`.
- Test: `tests/integration/unit/test-junction-span.js` (create)
- Runner: `tests/integration/unit/run-test-junction-span.sh` (create)

**Interfaces:**
- Produces: `_farthestPairDist(pts) -> Number` — the largest distance between any two points in `pts` (`[{x,y}]`); `0` for fewer than 2 points. Pure.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/unit/test-junction-span.js`:

```javascript
// Pure unit test for _farthestPairDist in aiUtils.jsx — the caption junction span is the
// largest distance between the outermost plate-art crossings.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name){var re=new RegExp('function '+name+'\\s*\\([\\s\\S]*?\\n}');var m=src.match(re);if(!m)throw new Error('could not extract '+name);return m[0];}
eval(extract('_farthestPairDist'));

var fails=0;
function check(c,m){if(!c){console.log('FAIL: '+m);fails++;}}
function near(a,b){return Math.abs(a-b)<1e-9;}

check(near(_farthestPairDist([{x:0,y:0},{x:3,y:4}]), 5), 'two points -> 5 (3-4-5)');
check(near(_farthestPairDist([{x:0,y:0},{x:1,y:0},{x:10,y:0}]), 10), 'picks the farthest pair, not adjacent');
check(near(_farthestPairDist([{x:0,y:0},{x:0,y:0}]), 0), 'coincident points -> 0 (tangent pinch)');
check(near(_farthestPairDist([{x:5,y:5}]), 0), 'single point -> 0');
check(near(_farthestPairDist([]), 0), 'empty -> 0');
check(near(_farthestPairDist(null), 0), 'null -> 0 (guard)');

if(fails===0)console.log('PASS: junction-span'); else {console.log(fails+' FAIL');process.exit(1);}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/integration/unit/test-junction-span.js`
Expected: `Error: could not extract _farthestPairDist`.

- [ ] **Step 3: Implement + delete the superseded code**

In `utils/aiUtils.jsx`, add (near the other pure geometry helpers, e.g. after `boundsCenter`):

```javascript
// Largest distance between any two points in a set ([{x,y}]). 0 for fewer than 2 points.
// The caption's junction span = this over the plate-art boundary crossings; 0 means the caption
// only touches tangentially (a pinch), which cuts as two pieces. Pure.
function _farthestPairDist(pts) {
    if (!pts || pts.length < 2) return 0;
    var best = 0, i, j, dx, dy, d;
    for (i = 0; i < pts.length; i++) {
        for (j = i + 1; j < pts.length; j++) {
            dx = pts[i].x - pts[j].x; dy = pts[i].y - pts[j].y;
            d = dx * dx + dy * dy;
            if (d > best) best = d;
        }
    }
    return Math.sqrt(best);
}
```

Then DELETE these three now-dead functions entirely (superseded by the junction-width criterion;
`_fusedLeafMetrics` was also a duplicate of the blob-removal's `_leafMetrics`):
- `_captionLeafDetached`
- `_fusedLeafMetrics`
- `_plateMetrics`

And delete their test + runner:
```bash
git rm tests/integration/unit/test-caption-fused.js tests/integration/unit/run-test-caption-fused.sh
```

Confirm nothing still references them:
```bash
grep -rn "_captionLeafDetached\|_fusedLeafMetrics\|_plateMetrics" utils/ illustrator/ pipelines/ tests/
```
Expected: no matches. (`fuseCaptionCutline` still references them at this point — that is Task 2's
rewrite; if the grep shows ONLY those `fuseCaptionCutline` lines, that is expected and Task 2 fixes
it. Do NOT leave the file in a state where the node test fails.)

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/integration/unit/test-junction-span.js`
Expected: `PASS: junction-span`

- [ ] **Step 5: Runner + commit**

Create `tests/integration/unit/run-test-junction-span.sh`:

```bash
#!/bin/bash
set -euo pipefail
STEP="junction-span-unit"; DIR="$(cd "$(dirname "$0")" && pwd)"
echo "[$STEP] Running _farthestPairDist unit tests (node)..."
if ! command -v node >/dev/null 2>&1; then echo "SKIP [$STEP]: node not found."; exit 0; fi
if node "$DIR/test-junction-span.js"; then echo "PASS [$STEP]"; exit 0; else echo "FAIL [$STEP]"; exit 1; fi
```

```bash
chmod +x tests/integration/unit/run-test-junction-span.sh
git add -A utils/aiUtils.jsx tests/integration/unit/
git commit -m "feat(cutline): _farthestPairDist; drop the superseded leaf-topology detector"
```

---

### Task 2: Junction-ratio criterion in `fuseCaptionCutline` + CONFIG + live validation

**Files:**
- Modify: `utils/aiUtils.jsx` — add `_captionJunctionRatio`; rewrite `fuseCaptionCutline`'s loop.
- Modify: `pipelines/AI_BuildAndExportCutlines.jsx`, `pipelines/AI_NormaliseCaptions.jsx`, `pipelines/AI_BuildCutlines.jsx` — CONFIG.
- Modify (regenerate): affected goldens.

**Interfaces:**
- Consumes: `_farthestPairDist` (Task 1).
- Produces: `_captionJunctionRatio(plate, outline, steps) -> { crossings, span, ratio }`; `fuseCaptionCutline(outline, plate, moveItems, strokePt, opts) -> { cut, embeddedMm, ok, reason, ratio }` (unchanged signature).

- [ ] **Step 1: Add `_captionJunctionRatio`**

In `utils/aiUtils.jsx`, immediately BEFORE `fuseCaptionCutline`, add:

```javascript
// The caption's JUNCTION with the art: the span between the outermost plate-art boundary
// crossings, and that span divided by the plate's width. ratio 0 means the caption only touches
// tangentially (or not at all) — the boolean may still pinch that into one contour, but it cuts
// as two pieces. Measured from plate vs outline directly (no boolean needed).
// NOTE: plate width uses the bbox; the seat's rotations are small (a few degrees) so this is a
// close proxy for the pill's length. Returns { crossings, span, ratio }.
function _captionJunctionRatio(plate, outline, steps) {
    var s = steps || 48;
    var pp = _largestPoly(samplePathToPolygons(plate, s));
    var artPolys = samplePathToPolygons(outline, s);
    if (!pp || pp.length < 3 || artPolys.length === 0) return { crossings: 0, span: 0, ratio: 0 };
    var inside = [], k, j;
    for (k = 0; k < pp.length; k++) inside[k] = _pointInPolysEO(pp[k], artPolys);
    var cross = [], a, b;
    for (k = 0; k < pp.length; k++) {
        j = (k + 1) % pp.length;
        if (inside[k] !== inside[j]) {
            a = inside[k] ? pp[j] : pp[k];
            b = inside[k] ? pp[k] : pp[j];
            cross.push(_segCrossArt(a, b, artPolys));
        }
    }
    var span = _farthestPairDist(cross);
    var bb = plate.geometricBounds;
    var pw = Math.abs(bb[2] - bb[0]);
    return { crossings: cross.length, span: span, ratio: (pw > 0 ? span / pw : 0) };
}
```

- [ ] **Step 2: Rewrite `fuseCaptionCutline`'s body**

Replace the whole body of `fuseCaptionCutline` (keep the signature) with:

```javascript
function fuseCaptionCutline(outline, plate, moveItems, strokePt, opts) {
    opts = opts || {};
    var name   = opts.name || "(caption)";
    var stepMm = (opts.stepMm != null) ? opts.stepMm
               : ((typeof CONFIG !== "undefined" && CONFIG.captionFuseStepMm != null) ? CONFIG.captionFuseStepMm : 0.01);
    var capMm  = (opts.capMm != null) ? opts.capMm
               : ((typeof CONFIG !== "undefined" && CONFIG.captionFuseCapMm != null) ? CONFIG.captionFuseCapMm : 0.3);
    var minRatio = (opts.minRatio != null) ? opts.minRatio
               : ((typeof CONFIG !== "undefined" && CONFIG.captionMinJunctionRatio != null) ? CONFIG.captionMinJunctionRatio : 0.40);
    if (stepMm <= 0) stepMm = 0.01;                      // never allow a non-advancing loop
    var geom = _aiSeatGeometry(plate, outline);
    var step = mmToPoints(stepMm);
    var embeddedMm = 0;

    var jr = _captionJunctionRatio(plate, outline, 48);
    while (jr.ratio < minRatio) {
        if (embeddedMm + stepMm > capMm + 1e-9) {
            return { cut: null, embeddedMm: embeddedMm, ok: false, ratio: jr.ratio,
                     reason: "caption '" + name + "' junction ratio " + jr.ratio.toFixed(3)
                             + " < " + minRatio + " even after " + capMm + "mm embed" };
        }
        var tx = geom.travelIsX ? geom.sign * step : 0;
        var ty = geom.travelIsX ? 0 : geom.sign * step;
        _translateItems(moveItems, tx, ty);
        embeddedMm += stepMm;
        jr = _captionJunctionRatio(plate, outline, 48);
    }

    var cut = deriveCutline(outline, plate);
    strokeRecursive(cut, strokePt, blackRgb());
    if (embeddedMm > 0) {
        log("[fuse] " + name + " | embedded " + (Math.round(embeddedMm * 1000) / 1000)
            + "mm -> junction ratio " + jr.ratio.toFixed(3));
    }
    return { cut: cut, embeddedMm: embeddedMm, ok: true, reason: null, ratio: jr.ratio };
}
```

- [ ] **Step 3: CONFIG in all three pipelines**

In EACH of `pipelines/AI_BuildAndExportCutlines.jsx`, `pipelines/AI_NormaliseCaptions.jsx`,
`pipelines/AI_BuildCutlines.jsx`: change `captionFuseStepMm` from `0.02` to `0.01`, and add
`captionMinJunctionRatio` beside it:

```javascript
    captionFuseStepMm:   0.01,   // fuse-rescue: nudge a weak-junction caption this far/step
    captionFuseCapMm:    0.3,    // fuse-rescue: give up (hard error) past this total embed
    captionMinJunctionRatio: 0.40, // required caption-art junction span / plate width
```

- [ ] **Step 4: Syntax + node sweep**

```bash
cp utils/aiUtils.jsx /tmp/aiUtils-check.js && node --check /tmp/aiUtils-check.js && echo OK
grep -rn "_captionLeafDetached\|_fusedLeafMetrics\|_plateMetrics" utils/ tests/ || echo "no dead refs"
for f in tests/integration/unit/run-test-*.sh; do bash "$f" 2>&1 | tail -1; done
```
Expected: `OK`; `no dead refs`; every unit runner PASS/SKIP.

- [ ] **Step 5: Live build-export + full junction scan**

Run: `tests/integration/ai-build-and-export-cutlines/run.sh`
Then re-run the junction scan over all 28:
```bash
osascript -e 'tell application "Adobe Illustrator" to do javascript file (POSIX file "/tmp/neck-all.jsx")'
```
REQUIRE: runner `28 caption(s) built, 0 failed`; classification `16 regular, 12 irregular`
unchanged; the junction scan shows **every** captioned element with `ratio >= 0.40` — in
particular **Tram is no longer 0.000** (expected ~0.647 after a 0.01mm nudge). Expect `[fuse]`
lines for Tram and Tatra only; none for the other 26. Record each `[fuse]` line's embed + ratio.
If any element still reports ratio < 0.40, or a new element needs nudging, STOP and report.

- [ ] **Step 6: Regenerate goldens**

Confirm the build-export golden diff is benign (the `[fuse]` lines + Tram/Tatra geometry only; no
other element's seat/classification/counts changed), then:
```bash
cp /tmp/AI_BuildAndExportCutlines.log tests/integration/ai-build-and-export-cutlines/expected.txt
```
Re-run to confirm it matches. Then run `tests/integration/ai-normalise-captions/run.sh`,
`tests/integration/ai-import-nesting/run.sh`, `tests/integration/ai-export-final/run.sh`;
regenerate any golden whose diff is purely this change; STOP on any new failure.

- [ ] **Step 7: Full suite + commit**

```bash
tests/integration/run-all.sh
```
Expected: all PASS/SKIP, no FAIL.
```bash
git add -A utils/aiUtils.jsx pipelines/ tests/integration/
git commit -m "feat(cutline): stop the fuse-rescue on junction WIDTH, not topology

Tram's caption touched the art at a single tangent point; the boolean pinched it
into one contour so the topology test passed it. Now nudge until the plate-art
junction spans >= captionMinJunctionRatio (0.40) of the plate width; step 0.01mm.
Measure-then-unite-once. Tram: 0.000 -> ~0.647 for a 0.01mm bump."
```

---

## Self-Review

**Spec coverage (the amendment):** junction-width criterion → Task 2 Step 2. Ratio 0.40 + step 0.01 as CONFIG → Task 2 Step 3. Measure-then-unite-once → Task 2 Step 2 (single `deriveCutline` after the loop). Delete superseded detector → Task 1 Step 3. Live: all 28 ≥0.40, Tram fixed → Task 2 Step 5. Goldens → Step 6. ✓

**Placeholder scan:** none — all steps carry literal code/commands.

**Type consistency:** `_farthestPairDist(pts)` (Task 1) consumed by `_captionJunctionRatio` (Task 2) on the `cross` array of `{x,y}` from `_segCrossArt`. `_captionJunctionRatio` returns `{crossings, span, ratio}`, used as `jr.ratio` in `fuseCaptionCutline`. `fuseCaptionCutline`'s signature and `{cut, embeddedMm, ok, reason}` contract unchanged for both existing call sites (adds `ratio`).
