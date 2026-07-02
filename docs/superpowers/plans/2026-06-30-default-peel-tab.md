# Default Peel Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every element that does not get a caption (`!needsCaption`) automatically gets a default peel tab — placed roughly in Pipeline 1 for artist review, then seated/cut/half-cut in Pipeline 2 through the existing caption machinery.

**Architecture:** Mirror the named-caption path. A new `pickTabEdge` chooses the longest near-straight edge; `placeTabAsset` pastes one of two asset files (PEEL HERE / semi-circle) as a loose `[name] tab` group in Pipeline 1 (Step 6). In Pipeline 2, `buildDefaultTab` feeds the tab's **cutline** (as the plate) and **fill** (as a ride-along) into the existing `seatPlateToOutline` → `deriveCutline` → `assembleElementGroup` → `syncHalfcut` primitives. `buildCaption` is left untouched.

**Tech Stack:** ExtendScript (ES3 — no `let`/`const`/arrow/template-literals), Adobe Illustrator DOM, node (pure-geometry unit tests via function extraction), osascript (Adobe integration tests).

## Global Constraints

- ExtendScript ES3 only: `var` only, no arrow functions, no template literals, no `Array.prototype` ES5 niceties beyond what aiUtils already uses. Wrap each pipeline phase in try/catch that logs `e.line`.
- Step files export exactly one phase function, assume `CONFIG` + utils in scope, log prefix `[stepN]`. Utils/step files have NO `#target`, NO `CONFIG`, NO `main()`.
- Trigger rule is the single predicate `elementGetsCaption(styleCode)` (added in Task 1) — never a literal `=== "ST"` check.
- Tab structure: **only the cutline enters the sticker cut**; the **fill is a ride-along printed-ink member** that never affects the cut shape.
- No fallback for unseated geometry: an unseated tab is a HARD ERROR that names the element and aborts before export (mirror the caption rule).
- mm↔pt: `mmToPoints(mm)` exists in aiUtils; 1 pt = `0.352777778` mm (use the constant `25.4/72`, matching the repo's `/2.834645` convention).
- Asset paths resolve via `_root + "/assets/FileName.ai"` where `_root = new File($.fileName).parent.parent.fsName`.
- Assets: `assets/Peel_Tab_B.ai` = "PEEL HERE" (preferred), `assets/Peel_Tab_A.ai` = semi-circle (fallback).

---

### Task 1: `elementGetsCaption()` single source of truth

**Files:**
- Modify: `utils/aiUtils.jsx` (add helper near `parseLayerName`, ~line 30)
- Modify: `illustrator/Step6_CreateCutlines.jsx:173` (the WC/GC branch)
- Modify: `pipelines/AI_BuildAndExportCutlines.jsx:62` (the skip line)
- Test: `tests/integration/unit/test-element-gets-caption.js` (new) + `tests/integration/unit/run-test-element-gets-caption.sh` (new)

**Interfaces:**
- Produces: `elementGetsCaption(styleCode) -> Boolean` (true for "WC"/"GC"). Consumed by Step 6 and Pipeline 2 to decide caption-vs-tab.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/unit/test-element-gets-caption.js`:
```javascript
// Pure unit test for elementGetsCaption (aiUtils.jsx). The default peel tab fires
// for every styleCode where this returns false.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '[\\s\\S]*?\\n}');
    var m = src.match(re);
    if (!m) throw new Error('could not extract ' + name);
    return m[0];
}
eval(extract('elementGetsCaption'));

var fails = 0;
function check(cond, msg) { if (!cond) { console.log('FAIL: ' + msg); fails++; } }

check(elementGetsCaption('WC') === true,  'WC gets a caption');
check(elementGetsCaption('GC') === true,  'GC gets a caption');
check(elementGetsCaption('ST') === false, 'ST gets a default tab');
check(elementGetsCaption('')   === false, 'unparsed/blank gets a default tab');
check(elementGetsCaption(null) === false, 'null gets a default tab');

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
```

Create `tests/integration/unit/run-test-element-gets-caption.sh`:
```bash
#!/bin/bash
set -euo pipefail
STEP="element-gets-caption-unit"
DIR="$(cd "$(dirname "$0")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "SKIP [$STEP]: node not found."; exit 0; }
if node "$DIR/test-element-gets-caption.js"; then echo "PASS [$STEP]"; else echo "FAIL [$STEP]"; exit 1; fi
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/integration/unit/run-test-element-gets-caption.sh`
Expected: FAIL — `could not extract elementGetsCaption` (function not yet defined).

- [ ] **Step 3: Add the helper to aiUtils.jsx**

Insert after `parseLayerName` (the function ends around line 30, just before `function isCaption`):
```javascript
// Single source of truth for "does this element get a named caption?" — its inverse
// is exactly the set that gets a DEFAULT PEEL TAB. Used by Step 6 (Pipeline 1) and
// AI_BuildAndExportCutlines (Pipeline 2). Mirrors psUtils.needsCaption on the AI side.
function elementGetsCaption(styleCode) {
    return styleCode === "WC" || styleCode === "GC";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/integration/unit/run-test-element-gets-caption.sh`
Expected: `PASS [element-gets-caption-unit]`.

- [ ] **Step 5: Adopt the helper at the two call sites**

In `illustrator/Step6_CreateCutlines.jsx:173`, change:
```javascript
        if (matched.styleCode === "WC" || matched.styleCode === "GC") {
```
to:
```javascript
        if (elementGetsCaption(matched.styleCode)) {
```

In `pipelines/AI_BuildAndExportCutlines.jsx:62`, change:
```javascript
        if (el.styleCode !== "WC" && el.styleCode !== "GC") continue;   // ST / uncaptioned
```
to:
```javascript
        if (!elementGetsCaption(el.styleCode)) {
            // Default peel tab (Task 6 fills this branch); for now keep prior behaviour.
            continue;
        }
```

- [ ] **Step 6: Commit**

```bash
git add utils/aiUtils.jsx illustrator/Step6_CreateCutlines.jsx pipelines/AI_BuildAndExportCutlines.jsx tests/integration/unit/test-element-gets-caption.js tests/integration/unit/run-test-element-gets-caption.sh
git commit -m "feat(peel-tab): elementGetsCaption predicate as the caption/tab trigger"
```

---

### Task 2: `pickTabEdge()` — longest near-straight edge + outward normal

**Files:**
- Modify: `utils/aiUtils.jsx` (add `pointsToMm`, `_angDiff180`, `_polyCentroid`, `pickTabEdge` near the geometry helpers, after `samplePathToPolygons` ~line 2510)
- Test: `tests/integration/unit/test-pick-tab-edge.js` (new) + `tests/integration/unit/run-test-pick-tab-edge.sh` (new)

**Interfaces:**
- Consumes: `samplePathToPolygons(item, steps) -> [[{x,y},...]]` and `_largestPoly(polys)` (existing).
- Produces:
  `pickTabEdge(outline, opts) -> { ok:true, midX, midY, dirAngle, outwardAngle, lengthMm } | { ok:false, reason }`
  where `dirAngle`/`outwardAngle` are radians (y-up), `lengthMm` is the chord length of the chosen run. `opts = { steps?, straightToleranceDeg? }`.
- `pointsToMm(pt) -> Number`, `_angDiff180(a,b) -> Number` (0..π/2), `_polyCentroid(poly) -> {x,y}`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/unit/test-pick-tab-edge.js`:
```javascript
// Pure-geometry unit test for pickTabEdge + helpers (aiUtils.jsx). y-UP coords, AI points.
// pickTabEdge calls samplePathToPolygons, which needs the Adobe DOM — so the test injects a
// fake samplePathToPolygons that returns a supplied polygon, isolating the pure edge logic.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '[\\s\\S]*?\\n}');
    var m = src.match(re);
    if (!m) throw new Error('could not extract ' + name);
    return m[0];
}
eval(extract('pointsToMm'));
eval(extract('_angDiff180'));
eval(extract('_polyCentroid'));
eval(extract('_largestPoly'));
eval(extract('pickTabEdge'));

// Fakes used by pickTabEdge's body:
var FAKE_POLY = null;
function samplePathToPolygons() { return [FAKE_POLY]; }
var mmToPoints = function (mm) { return mm * 2.834645; }; // only for tolerance math if referenced

var fails = 0;
function check(cond, msg) { if (!cond) { console.log('FAIL: ' + msg); fails++; } }
function approx(a, b, t) { return Math.abs(a - b) <= (t == null ? 1e-6 : t); }
var HALF_PI = Math.PI / 2;

// ── Wide rectangle: longest edges are the two horizontals (length 100 vs 40). ──
// Bottom edge y=0 (y-up), top y=40, centroid at y=20. The chosen edge is horizontal
// (dirAngle 0 or π) and the outward normal points away from centroid (down = -π/2 for
// the bottom edge, up = +π/2 for the top edge). Either horizontal edge is acceptable;
// assert the edge is horizontal and the outward normal is vertical & points away.
(function () {
    FAKE_POLY = [{x:0,y:0},{x:100,y:0},{x:100,y:40},{x:0,y:40}];
    var e = pickTabEdge({}, { steps: 1, straightToleranceDeg: 5 });
    check(e.ok, 'rect: ok');
    check(approx(e.lengthMm, pointsToMm(100), 0.01), 'rect: longest edge is 100pt, got ' + e.lengthMm);
    check(approx(_angDiff180(e.dirAngle, 0), 0, 1e-6), 'rect: chosen edge is horizontal');
    // outward normal vertical:
    check(approx(_angDiff180(e.outwardAngle, HALF_PI), 0, 1e-6), 'rect: outward normal is vertical');
    // outward points away from centroid (y=20): midY<20 -> sin<0 ; midY>20 -> sin>0
    var away = (e.midY < 20) ? (Math.sin(e.outwardAngle) < 0) : (Math.sin(e.outwardAngle) > 0);
    check(away, 'rect: outward normal points away from centroid');
})();

// ── Diagonal edge is the longest. Right triangle with hypotenuse from (0,0)->(120,120)
// (length ~169) vs legs 120. Chosen edge dir ~45deg. ──
(function () {
    FAKE_POLY = [{x:0,y:0},{x:120,y:0},{x:120,y:120}];
    // edges: (0,0)-(120,0)=120 ; (120,0)-(120,120)=120 ; (120,120)-(0,0)=169.7 (hypotenuse)
    var e = pickTabEdge({}, { steps: 1, straightToleranceDeg: 5 });
    check(e.ok, 'tri: ok');
    check(approx(e.lengthMm, pointsToMm(Math.sqrt(120*120+120*120)), 0.05), 'tri: longest is hypotenuse');
    check(approx(_angDiff180(e.dirAngle, Math.PI/4), 0, 1e-6), 'tri: edge dir ~45deg');
})();

// ── Collinear run across multiple samples merges into one edge ──
(function () {
    // bottom split into 3 collinear samples; should still measure ~150 total span.
    FAKE_POLY = [{x:0,y:0},{x:50,y:0},{x:100,y:0},{x:150,y:0},{x:150,y:30},{x:0,y:30}];
    var e = pickTabEdge({}, { steps: 1, straightToleranceDeg: 5 });
    check(e.ok, 'collinear: ok');
    check(approx(e.lengthMm, pointsToMm(150), 0.01), 'collinear: merged span is 150pt, got ' + e.lengthMm);
})();

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
```

Create `tests/integration/unit/run-test-pick-tab-edge.sh`:
```bash
#!/bin/bash
set -euo pipefail
STEP="pick-tab-edge-unit"
DIR="$(cd "$(dirname "$0")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "SKIP [$STEP]: node not found."; exit 0; }
if node "$DIR/test-pick-tab-edge.js"; then echo "PASS [$STEP]"; else echo "FAIL [$STEP]"; exit 1; fi
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/integration/unit/run-test-pick-tab-edge.sh`
Expected: FAIL — `could not extract pointsToMm` (helpers not yet defined).

- [ ] **Step 3: Implement the helpers in aiUtils.jsx**

Insert after `samplePathToPolygons` (and its cache helper), near the other geometry utilities:
```javascript
// Points → millimetres (inverse of mmToPoints). 1pt = 25.4/72 mm.
function pointsToMm(pt) { return pt * (25.4 / 72); }

// Smallest angle between two directions treated as UNORIENTED lines (a straight edge may be
// sampled in either direction). Returns 0..π/2.
function _angDiff180(a, b) {
    var d = Math.abs(a - b) % Math.PI;       // 0..π
    if (d > Math.PI / 2) d = Math.PI - d;     // fold to 0..π/2
    return d;
}

// Simple vertex-average centroid (good enough to decide which side is "outward").
function _polyCentroid(poly) {
    var sx = 0, sy = 0, i;
    for (i = 0; i < poly.length; i++) { sx += poly[i].x; sy += poly[i].y; }
    return { x: sx / poly.length, y: sy / poly.length };
}

// Chooses the longest near-straight run of the outline perimeter and returns the tab seat:
//   { ok, midX, midY, dirAngle, outwardAngle, lengthMm }
// dirAngle  = direction of the chord (radians, y-up).
// outwardAngle = perpendicular to dirAngle pointing AWAY from the polygon centroid (the tab body
//   points this way).
// lengthMm = straight chord length of the run (what must clear the PEEL HERE tab width).
// A "run" accumulates consecutive perimeter edges whose direction stays within
// straightToleranceDeg of the run's anchor direction (unoriented), so diagonal/vertical edges
// qualify — generalises the old horizontal-only _findLongestHorizontalSeg.
function pickTabEdge(outline, opts) {
    opts = opts || {};
    var steps = (opts.steps != null) ? opts.steps : (CONFIG.peelTabEdgeSampleSteps || 12);
    var tolRad = ((opts.straightToleranceDeg != null) ? opts.straightToleranceDeg
                 : (CONFIG.peelTabEdgeStraightToleranceDeg != null ? CONFIG.peelTabEdgeStraightToleranceDeg : 8))
                 * Math.PI / 180;

    var poly = _largestPoly(samplePathToPolygons(outline, steps));
    if (!poly || poly.length < 3) return { ok: false, reason: "degenerate outline polygon" };

    var n = poly.length;
    var best = null;          // { sx, sy, ex, ey, lenPt }
    var i, j;

    // Try each vertex as a run start; extend while edges stay within tolerance of the anchor dir.
    for (i = 0; i < n; i++) {
        var ax = poly[i].x, ay = poly[i].y;
        var bx = poly[(i + 1) % n].x, by = poly[(i + 1) % n].y;
        var anchor = Math.atan2(by - ay, bx - ax);
        var endIdx = (i + 1) % n;
        for (j = i + 1; j < i + n; j++) {
            var c0 = poly[j % n], c1 = poly[(j + 1) % n];
            var ed = Math.atan2(c1.y - c0.y, c1.x - c0.x);
            if (_angDiff180(ed, anchor) > tolRad) break;
            endIdx = (j + 1) % n;
        }
        var ex = poly[endIdx].x, ey = poly[endIdx].y;
        var dx = ex - ax, dy = ey - ay;
        var lenPt = Math.sqrt(dx * dx + dy * dy);   // straight chord span of the run
        if (!best || lenPt > best.lenPt) best = { sx: ax, sy: ay, ex: ex, ey: ey, lenPt: lenPt };
    }
    if (!best || best.lenPt <= 0) return { ok: false, reason: "no straight edge found" };

    var midX = (best.sx + best.ex) / 2, midY = (best.sy + best.ey) / 2;
    var dirAngle = Math.atan2(best.ey - best.sy, best.ex - best.sx);
    var c = _polyCentroid(poly);

    // Two perpendicular candidates; pick the one whose small step increases distance from centroid.
    var cand1 = dirAngle + Math.PI / 2, cand2 = dirAngle - Math.PI / 2;
    var probe = 1.0;
    var d1 = Math.pow(midX + Math.cos(cand1) * probe - c.x, 2) + Math.pow(midY + Math.sin(cand1) * probe - c.y, 2);
    var d2 = Math.pow(midX + Math.cos(cand2) * probe - c.x, 2) + Math.pow(midY + Math.sin(cand2) * probe - c.y, 2);
    var outwardAngle = (d1 >= d2) ? cand1 : cand2;

    return { ok: true, midX: midX, midY: midY, dirAngle: dirAngle, outwardAngle: outwardAngle,
             lengthMm: pointsToMm(best.lenPt) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/integration/unit/run-test-pick-tab-edge.sh`
Expected: `PASS [pick-tab-edge-unit]`.

- [ ] **Step 5: Commit**

```bash
git add utils/aiUtils.jsx tests/integration/unit/test-pick-tab-edge.js tests/integration/unit/run-test-pick-tab-edge.sh
git commit -m "feat(peel-tab): pickTabEdge — longest near-straight edge + outward normal"
```

---

### Task 3: `placeTabAsset()` — paste the chosen asset as a loose `[name] tab` group

**Files:**
- Modify: `utils/aiUtils.jsx` (add `_tabAssetItems`, `placeTabAsset` after `pickTabEdge`)
- Test: deferred to Task 9 (Adobe-only paste/transform — verified by the Pipeline 2 integration runner + the validation checklist). Add a `node`-extractable pure helper `_tabAssetItems` classification test inline below.

**Interfaces:**
- Consumes: `pickTabEdge(...)` result (Task 2).
- Produces:
  `placeTabAsset(doc, layer, assetFile, edge, displayName) -> { ok:true, group, cutline, fill } | { ok:false, reason }`
  The returned `group` is named `displayName + " tab"`, with members `displayName + " tab cutline"` and `displayName + " tab fill"`, rotated to `edge.dirAngle` and translated so the tab's inner edge sits on the chosen art edge, body pointing along `edge.outwardAngle`. Loose — not seated.
  `_tabAssetItems(items) -> { cutline, fill } | null` classifies an asset's two paths by paint attributes.

- [ ] **Step 1: Write the failing classification test**

Create `tests/integration/unit/test-tab-asset-items.js`:
```javascript
// Pure unit test for _tabAssetItems: given two path-like objects, identify which is the
// CUTLINE (stroked, unfilled) and which is the FILL (filled, unstroked).
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '[\\s\\S]*?\\n}');
    var m = src.match(re); if (!m) throw new Error('could not extract ' + name); return m[0];
}
eval(extract('_tabAssetItems'));

var fails = 0;
function check(c, m) { if (!c) { console.log('FAIL: ' + m); fails++; } }

var cut  = { filled: false, stroked: true,  typename: 'PathItem' };
var fill = { filled: true,  stroked: false, typename: 'PathItem' };

var r1 = _tabAssetItems([cut, fill]);
check(r1 && r1.cutline === cut && r1.fill === fill, 'identifies cutline + fill (cut first)');
var r2 = _tabAssetItems([fill, cut]);
check(r2 && r2.cutline === cut && r2.fill === fill, 'order-independent');
var r3 = _tabAssetItems([fill, fill]);
check(r3 === null, 'ambiguous (two fills) -> null');

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
```

Create `tests/integration/unit/run-test-tab-asset-items.sh`:
```bash
#!/bin/bash
set -euo pipefail
STEP="tab-asset-items-unit"
DIR="$(cd "$(dirname "$0")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "SKIP [$STEP]: node not found."; exit 0; }
if node "$DIR/test-tab-asset-items.js"; then echo "PASS [$STEP]"; else echo "FAIL [$STEP]"; exit 1; fi
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/integration/unit/run-test-tab-asset-items.sh`
Expected: FAIL — `could not extract _tabAssetItems`.

- [ ] **Step 3: Implement `_tabAssetItems` + `placeTabAsset` in aiUtils.jsx**

```javascript
// Classifies an asset's two paths: the CUTLINE is stroked & unfilled, the FILL is filled &
// (typically) unstroked. Returns { cutline, fill } or null when it cannot tell them apart
// (caller treats null as a hard error naming the element — no silent guess).
function _tabAssetItems(items) {
    if (!items || items.length !== 2) return null;
    var a = items[0], b = items[1];
    function isCut(it)  { return it.stroked && !it.filled; }
    function isFill(it) { return it.filled; }
    if (isCut(a) && isFill(b)) return { cutline: a, fill: b };
    if (isCut(b) && isFill(a)) return { cutline: b, fill: a };
    return null;
}

// Opens the asset file (reusing it if already open), copies its two paths into `layer` as a
// group named "{displayName} tab", then rotates the group to edge.dirAngle and translates it so
// the group's inner edge sits on the chosen art edge midpoint with the body pointing outward.
// Returns { ok, group, cutline, fill } or { ok:false, reason }.
function placeTabAsset(doc, layer, assetFile, edge, displayName) {
    if (!assetFile || !assetFile.exists) return { ok: false, reason: "tab asset not found: " + (assetFile ? assetFile.fsName : "(null)") };

    var assetDoc = null, i;
    for (i = 0; i < app.documents.length; i++) {
        try { if (app.documents[i].fullName.fsName === assetFile.fsName) { assetDoc = app.documents[i]; break; } }
        catch (e2) {}
    }
    if (!assetDoc) assetDoc = app.open(assetFile);

    // Collect the asset's drawable paths (single "Layer 1", two paths).
    var assetItems = [];
    var al = assetDoc.layers[0];
    for (i = 0; i < al.pageItems.length; i++) {
        var t = al.pageItems[i].typename;
        if (t === "PathItem" || t === "CompoundPathItem") assetItems.push(al.pageItems[i]);
    }
    var cls = _tabAssetItems(assetItems);
    if (!cls) { try { app.activeDocument = doc; } catch (eA) {} return { ok: false, reason: "tab asset has ambiguous cutline/fill: " + assetFile.name }; }

    // Copy both into the working doc inside a fresh group (DOM duplicate across docs is unreliable
    // for live styles; copy/paste preserves appearance).
    app.activeDocument = assetDoc;
    app.selection = null;
    cls.cutline.selected = true; cls.fill.selected = true;
    app.executeMenuCommand("copy");
    app.activeDocument = doc;
    app.executeMenuCommand("paste");
    var pasted = app.selection;
    if (!pasted || pasted.length !== 2) return { ok: false, reason: "tab paste returned " + (pasted ? pasted.length : 0) + " items" };

    var group = layer.groupItems.add();
    group.name = displayName + " tab";
    var pCls = _tabAssetItems([pasted[0], pasted[1]]);
    if (!pCls) return { ok: false, reason: "pasted tab ambiguous cutline/fill" };
    pCls.fill.move(group, ElementPlacement.PLACEATEND);
    pCls.cutline.move(group, ElementPlacement.PLACEATEND);
    pCls.cutline.name = displayName + " tab cutline";
    pCls.fill.name    = displayName + " tab fill";

    // Orient: the asset is authored body-pointing-up (outwardAngle = +π/2). Rotate by the delta
    // between the desired outward direction and the authored one. translate so the group's outward-
    // facing inner edge midpoint lands on the chosen art-edge midpoint.
    var authoredOutward = Math.PI / 2;
    var rotDeg = (edge.outwardAngle - authoredOutward) * 180 / Math.PI;
    try { group.rotate(rotDeg); } catch (eR) {}

    var gb = group.geometricBounds;                  // [l,t,r,b] y-up
    var gcx = (gb[0] + gb[2]) / 2, gcy = (gb[1] + gb[3]) / 2;
    group.translate(edge.midX - gcx, edge.midY - gcy);

    log("[step6] tab placed | " + group.name + " | edge " + _r1(edge.lengthMm)
        + "mm dir " + _r1(edge.dirAngle * 180 / Math.PI) + "deg outward "
        + _r1(edge.outwardAngle * 180 / Math.PI) + "deg");
    return { ok: true, group: group, cutline: pCls.cutline, fill: pCls.fill };
}
```

- [ ] **Step 4: Run the classification test to verify it passes**

Run: `bash tests/integration/unit/run-test-tab-asset-items.sh`
Expected: `PASS [tab-asset-items-unit]`.

- [ ] **Step 5: Commit**

```bash
git add utils/aiUtils.jsx tests/integration/unit/test-tab-asset-items.js tests/integration/unit/run-test-tab-asset-items.sh
git commit -m "feat(peel-tab): placeTabAsset — paste+orient asset as a loose [name] tab group"
```

---

### Task 4: Pipeline 1 — Step 6 places the default tab + CONFIG knobs

**Files:**
- Modify: `pipelines/AI_BuildCutlines.jsx` (CONFIG: add peel-tab knobs in the block ~line 50; resolve asset paths after `_root`)
- Modify: `illustrator/Step6_CreateCutlines.jsx` (the else-branch ~line 196 → name outline + `_placeDefaultTab`; add `_placeDefaultTab` private helper)

**Interfaces:**
- Consumes: `pickTabEdge`, `placeTabAsset` (Tasks 2–3), `CONFIG.peelTabAssetPathPeelHere`, `CONFIG.peelTabAssetPathSemiCircle`, `CONFIG.peelHereTabWidthMm`, `CONFIG.peelTabEdgeFitMarginMm`.
- Produces (in the working doc, for Pipeline 2 to read): for each uncaptioned element, a named `[Display Name] outline` path **and** a loose `[Display Name] tab` group. `_placeDefaultTab(layer, displayName, outlinePath) -> Boolean` (true placed, false flagged — logs reason).

- [ ] **Step 1: Add CONFIG knobs to AI_BuildCutlines.jsx**

In the CONFIG object (after the half-cut block ~line 50), add:
```javascript
    // ── Default peel tab (Pipeline 1 rough placement for uncaptioned elements) ──
    // Resolved to File objects below (after _root). peelHereTabWidthMm is the authored width of
    // the PEEL HERE tab; when the chosen edge >= that + the fit margin, use PEEL HERE, else the
    // semi-circle. straightTolerance generalises the old horizontal-only edge search.
    peelHereTabWidthMm:              40.0,   // FIRST GUESS — re-measure from Peel_Tab_B.ai, then tune
    peelTabEdgeFitMarginMm:          2.0,
    peelTabEdgeStraightToleranceDeg: 8,
    peelTabEdgeSampleSteps:          12,
```
After the `CONFIG.logPath = ...` line (~line 115), add:
```javascript
CONFIG.peelTabAssetPathPeelHere   = _root + "/assets/Peel_Tab_B.ai";
CONFIG.peelTabAssetPathSemiCircle = _root + "/assets/Peel_Tab_A.ai";
```

- [ ] **Step 2: Replace Step 6's else-branch**

In `illustrator/Step6_CreateCutlines.jsx`, the current else-branch reads:
```javascript
        } else {
            // ST and any uncaptioned element: bare named cutline path.
            setStrokeStyle(path, CONFIG.cutlineStrokePt, blackCmyk());
            path.name = matched.displayName;
            log("[step6] named | " + path.name);
            named++;
        }
```
Replace with:
```javascript
        } else {
            // Uncaptioned element: name the trace as a separable outline, then place a loose
            // default peel tab (PEEL HERE or semi-circle) for the artist to review/reposition.
            // Pipeline 2 seats + cuts + half-cuts it via the same machinery as captions.
            setStrokeStyle(path, CONFIG.cutlineStrokePt, blackCmyk());
            path.name = matched.displayName + " outline";
            if (_placeDefaultTab(cutlinesLayer, matched.displayName, path)) {
                named++;
            } else {
                unmatched++;   // flagged: artist resolves before Pipeline 2 (hard-error path)
            }
        }
```

- [ ] **Step 3: Add the `_placeDefaultTab` private helper**

Add near the other Step 6 private helpers (e.g. after `_placeCaptionText`):
```javascript
// Pipeline 1 rough placement of a default peel tab for an uncaptioned element. Picks the longest
// near-straight edge, chooses PEEL HERE vs semi-circle by edge length, and places the asset as a
// loose "{displayName} tab" group. Returns true on success; false (logged) flags the element so
// the artist resolves it (e.g. an element with no straight edge) before Pipeline 2.
function _placeDefaultTab(cutlinesLayer, displayName, outlinePath) {
    var edge = pickTabEdge(outlinePath, {
        steps: CONFIG.peelTabEdgeSampleSteps,
        straightToleranceDeg: CONFIG.peelTabEdgeStraightToleranceDeg
    });
    if (!edge.ok) {
        log("[step6] TAB FLAG | " + displayName + " | " + edge.reason);
        return false;
    }
    var usePeelHere = edge.lengthMm >= (CONFIG.peelHereTabWidthMm + CONFIG.peelTabEdgeFitMarginMm);
    var assetFile = new File(usePeelHere ? CONFIG.peelTabAssetPathPeelHere : CONFIG.peelTabAssetPathSemiCircle);
    log("[step6] tab choice | " + displayName + " | edge " + Math.round(edge.lengthMm * 10) / 10
        + "mm -> " + (usePeelHere ? "PEEL HERE" : "semi-circle"));
    var res = placeTabAsset(cutlinesLayer.parent /*doc*/, cutlinesLayer, assetFile, edge, displayName);
    if (!res.ok) {
        log("[step6] TAB FLAG | " + displayName + " | " + res.reason);
        return false;
    }
    return true;
}
```
Note: `cutlinesLayer.parent` is the document for a top-level layer; `placeTabAsset` only uses it for `app.activeDocument` switching.

- [ ] **Step 4: Syntax-check via the existing Pipeline 1 integration runner (Adobe required)**

Run: `bash tests/integration/ps-build-elements/run.sh` is PS-only; the AI half is exercised by the two-phase Pipeline 1 runner. If Illustrator is available:
Run: `bash tests/integration/ai-build-and-export-cutlines/run.sh`
Expected at this stage: the fixture is post-Step-6 already, so this does not re-run Step 6; it WILL exercise Task 6 once done. For now, verify no syntax break by opening Illustrator and running Pipeline 1 on a stamp-bearing SKU, confirming `[step6] tab placed` lines appear and a `[name] tab` group exists. (Captured as a checklist item in Task 9.)

- [ ] **Step 5: Commit**

```bash
git add pipelines/AI_BuildCutlines.jsx illustrator/Step6_CreateCutlines.jsx
git commit -m "feat(peel-tab): Pipeline 1 Step 6 places a loose default tab for uncaptioned elements"
```

---

### Task 5: `buildDefaultTab()` — Pipeline 2 seat → unite → half-cut for the tab

**Files:**
- Modify: `utils/aiUtils.jsx` (add `buildDefaultTab` after `buildCaption`, ~line 1030)

**Interfaces:**
- Consumes: `findGroupMember`-style member lookup by name, `seatPlateToOutline`, `deriveCutline`, `assembleElementGroup`, `strokeRecursive`, `blackCmyk`, `_capNoteFormat`, `syncHalfcut` (all existing).
- Produces:
  `buildDefaultTab(doc, layer, tabGroup, outline, opts) -> { ok:true, group, needsReview, halfcut } | { ok:false, reason, needsReview? }`
  where `opts = { name, strokePt }`. The tab's cutline becomes the plate; the fill rides along.

- [ ] **Step 1: Implement `buildDefaultTab`**

```javascript
// Pipeline-2 build for a DEFAULT PEEL TAB (uncaptioned element). Mirrors buildCaption minus the
// pill/text build: the loose "{name} tab" group (placed in Pipeline 1, possibly repositioned by
// the artist) supplies a CUTLINE (the plate) and a FILL (a ride-along printed member). Seats the
// cutline into the traced outline, unites into the fused cut, bundles the separable members, and
// derives the half-cut from the submerged tab arc. An unseated tab returns { ok:false } for the
// caller to surface as a hard error (no fallback).
function buildDefaultTab(doc, layer, tabGroup, outline, opts) {
    opts = opts || {};
    var name = opts.name || tabGroup.name.replace(/ tab$/, "");

    // Extract the two tab members by name (placeTabAsset named them).
    var cutline = null, fill = null, i;
    for (i = 0; i < tabGroup.pageItems.length; i++) {
        var it = tabGroup.pageItems[i];
        if (it.name === name + " tab cutline") cutline = it;
        else if (it.name === name + " tab fill") fill = it;
    }
    if (!cutline) return { ok: false, reason: "tab cutline member not found" };

    // Promote the tab members out of the loose wrapper onto the layer (seat/derive operate on
    // layer-level items, like the caption pill/text). Keep the fill as the ride-along.
    cutline.move(layer, ElementPlacement.PLACEATEND);
    if (fill) fill.move(layer, ElementPlacement.PLACEATEND);
    try { tabGroup.remove(); } catch (eT) {}

    // Seat the cutline (plate) into the outline; the fill rides rigidly.
    var seat = seatPlateToOutline(name, outline, cutline, fill, { polyCache: {} });
    if (!seat.ok) {
        return { ok: false, needsReview: !!seat.needsReview, reason: seat.reason };
    }

    // Unite outline + tab cutline into the fused cut; bundle the separable members.
    var cut = deriveCutline(outline, cutline);
    strokeRecursive(cut, (opts.strokePt != null ? opts.strokePt : 0.25), blackCmyk());
    var group = assembleElementGroup(layer, name, outline, cutline, cut);

    // The fill is a PRINTED ride-along member (never part of the cut). Move it into the group and
    // keep it visible; it is NOT named "{name} plate" so it never enters reuniteCutline/halfcut.
    if (fill) {
        fill.move(group, ElementPlacement.PLACEATBEGINNING);
        fill.name = name + " tab fill";
        fill.hidden = false;
    }

    // Note marks a default-tab group: styleCode "ST", lines 0 (tab, not text), + plate area.
    var plateArea = 0;
    try { plateArea = Math.abs(cutline.area); } catch (ePA) {}
    group.note = _capNoteFormat("ST", 0, plateArea, !!seat.needsReview);

    var hc = syncHalfcut(doc, group, { polyCache: {} });
    return { ok: true, group: group, needsReview: !!seat.needsReview,
             halfcut: !!(hc && hc.ok), reason: hc ? hc.reason : null };
}
```

Note: `assembleElementGroup(layer, name, outline, cutline, cut)` names the second arg's item `name + " plate"` — so the **tab cutline becomes the group's `plate` member**, exactly what `syncHalfcut`/`reuniteCutline` expect. The fill is added separately and is never named `plate`, so it stays out of every boolean op.

- [ ] **Step 2: Verify it parses by extracting under node**

Run:
```bash
node -e 'var s=require("fs").readFileSync("utils/aiUtils.jsx","utf8"); if(!/function buildDefaultTab[\s\S]*?\n}/.test(s)){console.log("MISSING");process.exit(1)} console.log("found buildDefaultTab")'
```
Expected: `found buildDefaultTab`.

- [ ] **Step 3: Commit**

```bash
git add utils/aiUtils.jsx
git commit -m "feat(peel-tab): buildDefaultTab — seat+unite+half-cut a tab via caption primitives"
```

---

### Task 6: Pipeline 2 — wire the default-tab branch + CONFIG

**Files:**
- Modify: `pipelines/AI_BuildAndExportCutlines.jsx` (CONFIG: add `cutlineStrokePt` already present; the branch at line 62; the summary log)

**Interfaces:**
- Consumes: `buildDefaultTab` (Task 5), `elementGetsCaption` (Task 1), `_findItemByName` (existing).
- Produces: built default tabs counted alongside captions; failed tabs join `failed[]` (hard-error gate already present in `main()`).

- [ ] **Step 1: Replace the skip branch with the tab branch**

The branch currently (after Task 1) reads:
```javascript
        if (!elementGetsCaption(el.styleCode)) {
            // Default peel tab (Task 6 fills this branch); for now keep prior behaviour.
            continue;
        }
```
Replace with:
```javascript
        if (!elementGetsCaption(el.styleCode)) {
            // Default peel tab: find the loose "{name} tab" group Pipeline 1 placed (artist may
            // have repositioned it) and run it through the same seat/unite/half-cut machinery.
            var tabGroup = _findItemByName(layer, el.displayName + " tab");
            var tabOutline = _findItemByName(layer, el.displayName + " outline");
            if (!tabGroup || !tabOutline) {
                skipped.push(el.displayName + (tabOutline ? "" : " [no outline]") + (tabGroup ? "" : " [no tab]"));
                continue;
            }
            var tres;
            try { tres = buildDefaultTab(doc, layer, tabGroup, tabOutline,
                                         { name: el.displayName, strokePt: CONFIG.cutlineStrokePt }); }
            catch (eT) { failed.push(el.displayName + " tab (line " + eT.line + ": " + eT.message + ")"); continue; }
            if (tres && tres.ok) {
                built++;
                log("[ai-pipeline] tab built | " + el.displayName + " halfcut=" + tres.halfcut
                    + (tres.needsReview ? " REVIEW" : ""));
            } else {
                failed.push(el.displayName + " tab" + (tres ? " (" + tres.reason + ")" : ""));
            }
            continue;
        }
```

- [ ] **Step 2: Verify the file still parses (extract-check the new branch)**

Run:
```bash
grep -n "buildDefaultTab(doc, layer, tabGroup" pipelines/AI_BuildAndExportCutlines.jsx
```
Expected: one match.

- [ ] **Step 3: Commit**

```bash
git add pipelines/AI_BuildAndExportCutlines.jsx
git commit -m "feat(peel-tab): Pipeline 2 builds default tabs for uncaptioned elements"
```

---

### Task 7: Half-cut for tab groups — extend `syncHalfcut` + Step 9A collector

**Files:**
- Modify: `utils/aiUtils.jsx:1704` (`syncHalfcut` style-code guard)
- Modify: `illustrator/Step9A_Halfcut.jsx:69` (`_collectHalfcutItems` filter + the count log)

**Interfaces:**
- Consumes: a default-tab group has note styleCode `"ST"` with members `{name}` (cutline), `{name} outline`, `{name} plate` (the tab cutline). A wrap-only stamp group (legacy) has note `"ST|0"` but NO `plate` member.
- Produces: `syncHalfcut` and Step 9A process `"ST"` groups that have a `plate` member; wrap-only groups still return `{ok:false}` (gracefully, via the existing missing-member guards).

- [ ] **Step 1: Extend the `syncHalfcut` guard**

`utils/aiUtils.jsx` currently:
```javascript
    var note = parseNote(group.note);
    if (!note || (note.styleCode !== "GC" && note.styleCode !== "WC")) {
        return { ok: false, reason: "not GC/WC" };
    }
```
Change to:
```javascript
    var note = parseNote(group.note);
    if (!note || (note.styleCode !== "GC" && note.styleCode !== "WC" && note.styleCode !== "ST")) {
        return { ok: false, reason: "not GC/WC/tab" };
    }
```
(The existing `if (!plate) return {ok:false, reason:"plate subpath not found in group"};` below already rejects a wrap-only stamp safely.)

- [ ] **Step 2: Extend the Step 9A collector**

`illustrator/Step9A_Halfcut.jsx` `_collectHalfcutItems`:
```javascript
        note = parseNote(item.note);
        if (note && (note.styleCode === "GC" || note.styleCode === "WC")) {
            out.push({ name: item.name, group: item });
        }
```
Change the condition to include tab groups that actually have a plate member (so legacy wrap-only stamps, which have no plate, are not flagged as failures):
```javascript
        note = parseNote(item.note);
        var isCapStyle = note && (note.styleCode === "GC" || note.styleCode === "WC");
        var isTab = note && note.styleCode === "ST" && findGroupMember(item, " plate") !== null;
        if (isCapStyle || isTab) {
            out.push({ name: item.name, group: item });
        }
```
Also update the count log text just below the collector call (`found ... GC/WC item(s)`) to:
```javascript
    log("[step9a] found " + items.length + " GC/WC/tab item(s) for half-cut.");
```

- [ ] **Step 3: Verify both edits are present**

Run:
```bash
grep -n '!== "ST"' utils/aiUtils.jsx; grep -n 'isTab' illustrator/Step9A_Halfcut.jsx
```
Expected: one match each.

- [ ] **Step 4: Commit**

```bash
git add utils/aiUtils.jsx illustrator/Step9A_Halfcut.jsx
git commit -m "feat(peel-tab): half-cut tab groups (ST note + plate member) in syncHalfcut + Step 9A"
```

---

### Task 8: Reconcile stamp wrap/unwrap with permanent tab groups

**Files:**
- Modify: `utils/aiUtils.jsx` (`unwrapStampGroups` ~line 1922; `wrapStampsInGroups` ~line 1874 defensive guard)

**Interfaces:**
- Consumes: a real default-tab group has a `plate` member; a wrap-only halo group does not.
- Produces: `unwrapStampGroups` only unwraps halo-only groups, never a real tab group (which must ship as a group with its fused cut + half-cut).

- [ ] **Step 1: Guard `unwrapStampGroups` against real tab groups**

Current loop that collects groups to unwrap:
```javascript
        note = parseNote(g.note);
        if (note && note.styleCode === "ST") groups.push(g);
```
Change to skip groups that have a `plate` member (a real tab group, not a halo-only wrapper):
```javascript
        note = parseNote(g.note);
        // Only unwrap HALO-ONLY wrappers (no plate member). A real default-tab group has a
        // "{name} plate" member (the tab cutline) and must ship as a group — never unwrap it.
        if (note && note.styleCode === "ST" && findGroupMember(g, " plate") === null) groups.push(g);
```

- [ ] **Step 2: Defensive guard in `wrapStampsInGroups`**

`wrapStampsInGroups` only collects bare direct-child PathItems/CompoundPathItems, so a tab group (a `GroupItem`) is already skipped. No code change needed, but add a clarifying comment above the `bare` collection:
```javascript
    // NOTE: a default-tab element is a GroupItem (not a bare path), so it is naturally skipped
    // here — only genuinely bare stamp cutlines (no tab) are wrapped for a halo.
```

- [ ] **Step 3: Verify the guard is present**

Run:
```bash
grep -n 'findGroupMember(g, " plate") === null' utils/aiUtils.jsx
```
Expected: one match.

- [ ] **Step 4: Commit**

```bash
git add utils/aiUtils.jsx
git commit -m "fix(peel-tab): never unwrap a real tab group (only halo-only stamp wrappers)"
```

---

### Task 9: Pipeline 2 integration coverage + validation checklist

**Files:**
- Modify: `tests/integration/ai-build-and-export-cutlines/run.sh` (assert tab build + half-cut for the ST elements)
- Modify: `tests/integration/ai-build-and-export-cutlines/expected.txt` (regenerated golden)
- Create: `docs/default-peel-tab-validation.md` (the in-Illustrator checklist for the Adobe-only steps)
- Possibly regenerate: `tests/integration/ai-build-and-export-cutlines/fixtures/traced-cutlines.ai` + sidecar (so the 2 ST elements carry a `[name] tab` group from Pipeline 1)

**Interfaces:**
- Consumes: the full pipeline (Tasks 1–8).
- Produces: a green Pipeline 2 run where the 2 ST elements become seated, cut, half-cut tab groups, plus the recorded validation checklist.

- [ ] **Step 1: Regenerate the fixture so ST elements carry a tab**

The committed fixture `traced-cutlines.ai` predates Pipeline-1 tab placement, so its 2 ST elements are bare paths with no `[name] tab` group. Regenerate it by running Pipeline 1 (Build Elements → buildDocAndImport) on the Slovakia SKU in Illustrator and saving the post-Step-6 doc + sidecar over the fixture. Per the repo fixture discipline: drive the REAL entry point, set up the fixture manually, run twice for determinism. Document the regen command used in the test header comment.

- [ ] **Step 2: Add tab assertions to the runner**

In `tests/integration/ai-build-and-export-cutlines/run.sh`, after the existing caption-summary assertions, add:
```bash
# Default tabs: the ST elements must build as tabs with a half-cut (built > 0, failed = 0).
if grep -qE "\[ai-pipeline\] tab built \| .* halfcut=true" "$LOG"; then
    echo "  PASS: at least one default tab built with a half-cut."
else
    echo "FAIL [$STEP]: no default tab built with a half-cut."
    grep -E "\[ai-pipeline\] tab built|tab \(" "$LOG" || true; FAIL=1
fi
```

- [ ] **Step 3: Run the integration test (Adobe required); first run prints golden NOTE**

Run: `bash tests/integration/ai-build-and-export-cutlines/run.sh`
Expected: PASS lines for caption build, the new tab assertion, and both SVGs. If the golden diff fails because new `tab built` / `tab placed` lines were added, review the diff and refresh the golden:
```bash
cp /tmp/AI_BuildAndExportCutlines.log tests/integration/ai-build-and-export-cutlines/expected.txt
```

- [ ] **Step 4: Write the in-Illustrator validation checklist**

Create `docs/default-peel-tab-validation.md` capturing the Adobe-only items that node tests cannot cover (per the repo's guard+log+checklist convention):
```markdown
# Default Peel Tab — In-Illustrator Validation Checklist

Run Pipeline 1 then Pipeline 2 on a stamp-bearing SKU and confirm:

- [ ] Pipeline 1: each uncaptioned element gets a `[name] tab` group on the chosen longest
      straight edge, body pointing OUTWARD (away from the art), correct A/B asset by edge length.
- [ ] Concave outline: outward normal points away from the art body (not into a notch).
- [ ] Artist reposition: move/rotate a `[name] tab`; Pipeline 2 seats it at the NEW pose.
- [ ] Pipeline 2: tab cutline is seated into the art (real overlap), fused cut united,
      `[name] tab fill` rides along and bleeds slightly past the cut (printed, not cut).
- [ ] Half-cut endpoints meet the fused cut at both ends; straight for a flat edge, curved for a
      curved/tilted edge. Peel test: grabbing the tab separates cleanly.
- [ ] Steep/diagonal/vertical edge: seat does NOT shear or float (seatPlateToOutline was only
      validated on bottom-ish captions — record the result here and tune seat knobs if needed).
- [ ] `peelHereTabWidthMm` re-measured from `Peel_Tab_B.ai`; A/B threshold tuned with the artist.
- [ ] Final file (Step 11): tab groups ship as groups (NOT unwrapped to bare paths); no QA/halo
      layers leak into print.
```

- [ ] **Step 5: Commit**

```bash
git add tests/integration/ai-build-and-export-cutlines/run.sh tests/integration/ai-build-and-export-cutlines/expected.txt docs/default-peel-tab-validation.md
# include the fixture if regenerated:
git add tests/integration/ai-build-and-export-cutlines/fixtures/traced-cutlines.ai tests/integration/ai-build-and-export-cutlines/fixtures/traced-cutlines_elements.json 2>/dev/null || true
git commit -m "test(peel-tab): Pipeline 2 asserts default tab build+half-cut; add validation checklist"
```

---

## Self-Review

**Spec coverage:**
- Scope `!needsCaption` → Task 1 (`elementGetsCaption`). ✓
- Edge choice (longest near-straight, outward) → Task 2 (`pickTabEdge`). ✓
- A-vs-B by edge length, fixed size → Task 4 (`_placeDefaultTab` threshold). ✓
- Asset cutline/fill identification → Task 3 (`_tabAssetItems`). ✓
- Fill is ride-along, only cutline cuts → Task 5 (`buildDefaultTab`, fill never named `plate`). ✓
- Pipeline 1 rough placement + artist reposition → Task 4 (place) + Task 6 (reads current pose). ✓
- Pipeline 2 seat→unite→half-cut → Task 5. ✓
- Note `ST|0|a<area>` lines:0 marker → Task 5. ✓
- `wrapStampsInGroups`/`unwrapStampGroups` reconciliation → Task 8. ✓
- Step 9A includes tab groups → Task 7. ✓
- Hard-error on unseated tab → Task 5 returns `{ok:false}` + existing `main()` gate (Task 6 routes to `failed[]`). ✓
- Validation watch-items (arbitrary-edge seat, concave normal, tab width) → Task 9 checklist. ✓
- Testing (unit + integration + golden) → Tasks 1,2,3 (unit), Task 9 (integration). ✓

**Placeholder scan:** No TBD/TODO in steps; every code step shows complete code. The `peelHereTabWidthMm: 40.0` is an explicit first-guess constant with a re-measure note, not a placeholder.

**Type consistency:** `elementGetsCaption(styleCode)`, `pickTabEdge(outline,opts)→{ok,midX,midY,dirAngle,outwardAngle,lengthMm}`, `placeTabAsset(doc,layer,assetFile,edge,displayName)→{ok,group,cutline,fill}`, `_tabAssetItems(items)→{cutline,fill}|null`, `buildDefaultTab(doc,layer,tabGroup,outline,opts)→{ok,group,needsReview,halfcut}` — names/shapes used consistently across Tasks 4, 5, 6. The tab cutline is consistently the group `plate` member (Task 5 via `assembleElementGroup`), which Tasks 7–8 key off (`findGroupMember(g," plate")`).

**Gaps:** None blocking. The fixture regen in Task 9 Step 1 is manual (Adobe), consistent with repo fixture discipline.
