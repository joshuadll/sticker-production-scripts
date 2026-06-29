# Native-Caption Builder (Illustrator) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, in Illustrator, the white caption pill around a native (artist-shaped) text frame — straight or curved — then seat it into the white-edge cut and unite it, reusing the existing AI seat/unite/half-cut. This is the genuine new code of the native-captions change; it ports the proven PS spine-sampler to vector input.

**Architecture:** One new aiUtils module: `buildCaptionPill(textFrame)` → pill PathItem, composed from (a) a ported pure spine-fit (node-testable), (b) a new vector text-outline column sampler, (c) the existing `buildCapsuleFromSpine`. Plus a ported `elongateCaptionPlate` for the GC-LM decorative bar, and a `buildCaption(...)` that wires pill → `seatPlateToOutline` → `deriveCutline`/`assembleElementGroup` → `syncHalfcut`. Validated by running in Illustrator on the spike's real traced cuts + an inspection checklist (ExtendScript geometry has no headless test).

**Tech Stack:** Adobe Illustrator 2026 ExtendScript (ES3); existing `utils/aiUtils.jsx`; node for unit-testing pure geometry; osascript runner for in-app integration.

**Scope note (per writing-plans scope check):** this plan builds the *builder* and tests it standalone on a setup doc. **Wiring it into the live pipeline** (replace Step 6's caption-rebuild, slim the handoff, strip PS Steps 3A/3B, fix the normalise scale-ref + nest binding) is a **separate follow-on plan** once the builder is proven.

## Global Constraints

- ExtendScript ES3 only: no `let`/`const`, no arrow functions, no template literals. Wrap any `main()` in try/catch alerting `e.line`.
- New code lives in `utils/aiUtils.jsx` (shared helpers); no `#target`/`CONFIG`/`main()` in utils.
- AI coordinate space is **y-up** (PS was y-down). The spine-fit math is coordinate-agnostic (fits y as a function of x); `buildCapsuleFromSpine` offsets ±r along local normals, so it accepts whatever spine sign results.
- Constants (mm; converted from the PS px@300DPI values): slice step **1.0 mm**, pen pad **1.69 mm**, straight-snap tolerance **0.5 mm**, curved-height percentile **0.9**. Caption text: Kalam-Regular 8 pt, tracking −20.
- Pill seats **into the white-edge contour** (the traced cut), submerged by `seatOverlapMm` (0.1) — the overlap IS the attachment. Never seat against raw art.
- ExtendScript geometry is not headless-testable. Pure functions → node unit test. DOM geometry → run in Illustrator + walk the inspection checklist. Run integration 2× for determinism.
- Reuse, do not reinvent: `buildCapsuleFromSpine`, `_capsulePolygon`, `samplePathToPolygons`, `segmentsIntersect`, `seatPlateToOutline`, `deriveCutline`, `assembleElementGroup`, `syncHalfcut`, `mmToPoints`, `whiteCmyk`, `strokeRecursive` already exist in aiUtils.

---

### Task 1: Port the pure spine-fit geometry into aiUtils (node-tested)

**Files:**
- Modify: `utils/aiUtils.jsx` (add `_capQuadFitSpine`, `_capStraightSpine`, `_capPercentile`, `_capSolve3`)
- Test: `tests/integration/test-caption-spinefit.js` (node)

**Interfaces:**
- Produces: `_capQuadFitSpine(pts, x0, x1, snapTolPt)` → `{ spine:[{x,y}…], straight:Bool }`; `_capStraightSpine(x0,x1,y)` → `[{x,y},{x,y}]`; `_capPercentile(arr, p)` → Number; `_capSolve3(...9 coeffs, b1,b2,b3)` → `[x,y,z]|null`.
- Consumed by: Task 3 (`buildCaptionPill`).

- [ ] **Step 1: Write the failing node test**

```javascript
// tests/integration/test-caption-spinefit.js
// Pure-geometry unit test (ES3 fns are node-compatible). Loads the functions by
// evaluating the relevant aiUtils slice in a sandbox is overkill — instead we paste-import
// via require of a tiny extraction is also overkill; simplest: eval the function sources.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../utils/aiUtils.jsx', 'utf8');
// Expose the four _cap* functions to this scope by evaluating their declarations.
eval(src.match(/function _capSolve3[\s\S]*?\n}\n/)[0]);
eval(src.match(/function _capPercentile[\s\S]*?\n}\n/)[0]);
eval(src.match(/function _capStraightSpine[\s\S]*?\n}\n/)[0]);
eval(src.match(/function _capQuadFitSpine[\s\S]*?\n}\n/)[0]);

function approx(a, b, t) { return Math.abs(a - b) <= t; }
var fails = 0;

// Straight points (flat line) → straight=true, 2-point spine at the mean y.
var flat = [];
for (var i = 0; i <= 10; i++) flat.push({ x: i, y: 5 });
var r1 = _capQuadFitSpine(flat, 0, 10, 0.5);
if (!r1.straight) { console.log('FAIL: flat not detected straight'); fails++; }

// Arc points (parabola, sagitta ~3 >> 0.5 snap) → straight=false, spine follows.
var arc = [];
for (var j = 0; j <= 10; j++) { var x = j; arc.push({ x: x, y: 0.12 * (x - 5) * (x - 5) }); }
var r2 = _capQuadFitSpine(arc, 0, 10, 0.5);
if (r2.straight) { console.log('FAIL: arc wrongly snapped straight'); fails++; }
if (r2.spine.length < 10) { console.log('FAIL: arc spine too coarse'); fails++; }

// Percentile sanity.
if (!approx(_capPercentile([1,2,3,4,5,6,7,8,9,10], 0.9), 9, 0.0001)) { console.log('FAIL: pctile'); fails++; }

console.log(fails === 0 ? 'PASS spinefit' : ('FAIL spinefit (' + fails + ')'));
process.exit(fails === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node tests/integration/test-caption-spinefit.js`
Expected: FAIL (functions not defined yet — the `src.match(...)` returns null → throws).

- [ ] **Step 3: Add the ported functions to aiUtils**

Add near the other geometry helpers in `utils/aiUtils.jsx` (ported verbatim from PS `Step3B`, coordinate-agnostic):

```javascript
// ─── CAPTION SPINE FIT (ported from PS Step3B — pure geometry, node-testable) ───
// Least-squares quadratic through sampled centre points; snaps to a straight 2-point
// spine when the fit stays within snapTolPt of flat. Returns { spine, straight }.
function _capQuadFitSpine(pts, x0, x1, snapTolPt) {
    var n = pts.length, i;
    var xm = 0, ym = 0;
    for (i = 0; i < n; i++) { xm += pts[i].x; ym += pts[i].y; }
    xm /= n; ym /= n;
    var S0 = n, S1 = 0, S2 = 0, S3 = 0, S4 = 0, Ty = 0, Txy = 0, Tx2y = 0;
    for (i = 0; i < n; i++) {
        var dx = pts[i].x - xm, y = pts[i].y, dx2 = dx * dx;
        S1 += dx; S2 += dx2; S3 += dx2 * dx; S4 += dx2 * dx2;
        Ty += y; Txy += dx * y; Tx2y += dx2 * y;
    }
    var a = 0, b = 0, c = ym;
    var sol = _capSolve3(S4, S3, S2, S3, S2, S1, S2, S1, S0, Tx2y, Txy, Ty);
    if (sol) { a = sol[0]; b = sol[1]; c = sol[2]; }
    function yAt(px) { var d = px - xm; return a * d * d + b * d + c; }
    var flat = ym, maxDev = 0, probes = 16, p;
    for (p = 0; p <= probes; p++) {
        var px = x0 + (x1 - x0) * (p / probes);
        var dev = Math.abs(yAt(px) - flat);
        if (dev > maxDev) maxDev = dev;
    }
    if (maxDev <= snapTolPt) return { spine: _capStraightSpine(x0, x1, flat), straight: true };
    var out = [], M = 40;
    for (p = 0; p <= M; p++) { var sx = x0 + (x1 - x0) * (p / M); out.push({ x: sx, y: yAt(sx) }); }
    return { spine: out, straight: false };
}

function _capStraightSpine(x0, x1, y) { return [{ x: x0, y: y }, { x: x1, y: y }]; }

function _capPercentile(arr, p) {
    var a = arr.slice(0);
    a.sort(function (x, y) { return x - y; });
    var idx = Math.floor(p * (a.length - 1));
    if (idx < 0) idx = 0;
    if (idx > a.length - 1) idx = a.length - 1;
    return a[idx];
}

function _capSolve3(a11, a12, a13, a21, a22, a23, a31, a32, a33, b1, b2, b3) {
    function det3(m11, m12, m13, m21, m22, m23, m31, m32, m33) {
        return m11 * (m22 * m33 - m23 * m32) - m12 * (m21 * m33 - m23 * m31) + m13 * (m21 * m32 - m22 * m31);
    }
    var D = det3(a11, a12, a13, a21, a22, a23, a31, a32, a33);
    if (Math.abs(D) < 1e-9) return null;
    var Dx = det3(b1, a12, a13, b2, a22, a23, b3, a32, a33);
    var Dy = det3(a11, b1, a13, a21, b2, a23, a31, b3, a33);
    var Dz = det3(a11, a12, b1, a21, a22, b2, a31, a32, b3);
    return [Dx / D, Dy / D, Dz / D];
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `node tests/integration/test-caption-spinefit.js`
Expected: `PASS spinefit`

- [ ] **Step 5: Commit**

```bash
git add utils/aiUtils.jsx tests/integration/test-caption-spinefit.js
git commit -m "feat(captions): port pure spine-fit geometry to aiUtils (node-tested)"
```

---

### Task 2: Vector text-outline column sampler

**Files:**
- Modify: `utils/aiUtils.jsx` (add `_capSampleTextOutline`)
- Test: in-app via Task 5's runner; this task's check is the logged spine + a visual probe.

**Interfaces:**
- Produces: `_capSampleTextOutline(textFrame, sliceMm)` → `{ pts:[{x,y}…], heights:[Number…], bounds:[l,t,r,b] }` (AI y-up, points), or `null` if no ink. Mirrors PS `_sampleTextSpine`.
- Consumes: `mmToPoints`, `samplePathToPolygons`.

- [ ] **Step 1: Implement the sampler**

Approach: duplicate the text, `createOutline()` it, sample the outline polygons in vertical columns; per column the filled vertical span (max−min y of the column's intersections with the outline edges) gives the spine point + height. Remove the temp outline.

```javascript
// ─── CAPTION TEXT SAMPLER (AI vector analog of PS _sampleTextSpine) ───
// Outlines a COPY of the text and samples its filled vertical extent in columns of width
// sliceMm. Returns column centres (spine) + per-column heights + bounds (AI points, y-up).
function _capSampleTextOutline(textFrame, sliceMm) {
    var dup = textFrame.duplicate();
    var outlined = dup.createOutline();          // GroupItem of glyph outlines (replaces dup)
    var polys = samplePathToPolygons(outlined, 16);
    var gb = outlined.geometricBounds;           // [l, t, r, b]  (t > b, y-up)
    try { outlined.remove(); } catch (e) {}
    if (!polys || polys.length === 0) return null;

    var L = gb[0], T = gb[1], R = gb[2], B = gb[3];
    if (R - L <= 0 || T - B <= 0) return null;
    var step = mmToPoints(sliceMm);
    var pts = [], heights = [], x;
    for (x = L + step / 2; x < R; x += step) {
        var span = _capColumnSpan(polys, x, B, T);   // {lo, hi} filled y-range at this x, or null
        if (!span) continue;
        pts.push({ x: x, y: (span.lo + span.hi) / 2 });
        heights.push(span.hi - span.lo);
    }
    if (pts.length === 0) return null;
    return { pts: pts, heights: heights, bounds: [L, T, R, B] };
}

// Filled vertical span of a polygon set at vertical line x (between yMin..yMax): the min and
// max y of all crossings of the line x with the polygons' edges. Returns {lo,hi} or null.
function _capColumnSpan(polys, x, yMin, yMax) {
    var lo = null, hi = null, p, k, A, Bp, ys;
    for (p = 0; p < polys.length; p++) {
        var poly = polys[p];
        for (k = 0; k < poly.length; k++) {
            A = poly[k]; Bp = poly[(k + 1) % poly.length];
            if ((A.x <= x && Bp.x > x) || (Bp.x <= x && A.x > x)) {   // edge straddles x
                ys = A.y + (Bp.y - A.y) * ((x - A.x) / (Bp.x - A.x));
                if (lo === null || ys < lo) lo = ys;
                if (hi === null || ys > hi) hi = ys;
            }
        }
    }
    if (lo === null) return null;
    return { lo: lo, hi: hi };
}
```

- [ ] **Step 2: Defer verification to Task 5**

This sampler is DOM-bound (createOutline) — it can't be unit-tested headlessly. Its correctness is checked in Task 5's run: the logged spine points must track the text's centerline (flat for straight text, arced for curved). No separate run here.

- [ ] **Step 3: Commit**

```bash
git add utils/aiUtils.jsx
git commit -m "feat(captions): vector text-outline column sampler (AI _sampleTextSpine port)"
```

---

### Task 3: `buildCaptionPill(textFrame, opts)`

**Files:**
- Modify: `utils/aiUtils.jsx` (add `buildCaptionPill`)

**Interfaces:**
- Produces: `buildCaptionPill(layer, textFrame, opts)` → `{ pill:PathItem, spine:[{x,y}…], radius:Number }`. `opts`: `{ sliceMm:1.0, padMm:1.69, snapMm:0.5, pctile:0.9 }` (defaults). Pill is white-filled, unstroked.
- Consumes: `_capSampleTextOutline`, `_capQuadFitSpine`, `_capPercentile`, `buildCapsuleFromSpine`, `mmToPoints`, `whiteCmyk`.

- [ ] **Step 1: Implement**

```javascript
// Builds the white caption pill around a native (artist-shaped) text frame: sample the text
// centreline -> fit/snap a spine -> radius from text height + pad -> sweep a capsule. One path
// for straight, multi-line, and curved text (no type branch), matching PS createWhiteFromText.
function buildCaptionPill(layer, textFrame, opts) {
    opts = opts || {};
    var sliceMm = opts.sliceMm != null ? opts.sliceMm : 1.0;
    var padPt   = mmToPoints(opts.padMm  != null ? opts.padMm  : 1.69);
    var snapPt  = mmToPoints(opts.snapMm != null ? opts.snapMm : 0.5);
    var pctile  = opts.pctile != null ? opts.pctile : 0.9;

    var s = _capSampleTextOutline(textFrame, sliceMm);
    var bb = s ? s.bounds : textFrame.geometricBounds;   // [l,t,r,b] y-up
    var boxH = bb[1] - bb[3];

    var spine, radius, straight;
    if (!s || s.pts.length < 3) {                         // degenerate -> bbox stadium
        radius = boxH / 2 + padPt / 2;
        spine  = _capStraightSpine(bb[0], bb[2], (bb[1] + bb[3]) / 2);
    } else {
        var fit = _capQuadFitSpine(s.pts, bb[0], bb[2], snapPt);
        if (_capIsMultiLine(textFrame)) {                // multi-line -> flat tall stadium
            fit = { spine: _capStraightSpine(bb[0], bb[2], (bb[1] + bb[3]) / 2), straight: true };
        }
        var penH = fit.straight ? boxH : _capPercentile(s.heights, pctile);
        radius = penH / 2 + padPt / 2;
        spine  = fit.spine;
    }
    var pill = buildCapsuleFromSpine(layer, spine, radius);  // existing: filled, unstroked
    pill.filled = true; pill.fillColor = whiteCmyk();
    pill.stroked = false;
    return { pill: pill, spine: spine, radius: radius };
}

// Multi-line if the text has >= 2 lines. Point text -> a line per hard return.
function _capIsMultiLine(textFrame) {
    try {
        var s = String(textFrame.contents).split(/[\r\n]+/), n = 0, i;
        for (i = 0; i < s.length; i++) if (s[i].replace(/^\s+|\s+$/g, "").length > 0) n++;
        return n >= 2;
    } catch (e) { return false; }
}
```

- [ ] **Step 2: Verify in Task 5's run** (DOM-bound; checked there). Commit.

```bash
git add utils/aiUtils.jsx
git commit -m "feat(captions): buildCaptionPill — pill around native text (straight/curved/multiline)"
```

---

### Task 4: Port `elongateCaptionPlate` (GC-LM decorative bar) to AI

**Files:**
- Modify: `utils/aiUtils.jsx` (add `elongateCaptionPlateAI`)

**Interfaces:**
- Produces: `elongateCaptionPlateAI(plateGroup, targetWidthPt)` — stretches the center, fixed L/R caps. `plateGroup` is a GroupItem with child PathItems/Groups named `"L"`, `"C"`, `"R"`. Mutates in place.
- Consumes: nothing new (uses `geometricBounds`, `.resize`, `.translate`).

- [ ] **Step 1: Implement** (AI y-up; horizontal scale only, so y is unaffected)

```javascript
// Elongates a GC-LM caption-plate ARTWORK group by scaling only its center piece (C); the
// L/R end caps keep their size; R slides to abut the stretched C. Mirror of PS elongateCaptionPlate.
function elongateCaptionPlateAI(plateGroup, targetWidthPt) {
    var L = null, C = null, R = null, i, ch;
    for (i = 0; i < plateGroup.pageItems.length; i++) {
        ch = plateGroup.pageItems[i];
        if (ch.name === "L") L = ch; else if (ch.name === "C") C = ch; else if (ch.name === "R") R = ch;
    }
    if (!L || !C || !R) return false;                    // caller logs "use as-is"
    function w(it) { var b = it.geometricBounds; return b[2] - b[0]; }
    var lW = w(L), rW = w(R), cW = w(C);
    var cTarget = targetWidthPt - lW - rW;
    if (cTarget <= 0 || cW <= 0) return false;
    C.resize(cTarget / cW * 100, 100,                    // horizontal only, anchor left
        true, true, true, true, 100, Transformation.LEFT);
    var cRight = C.geometricBounds[2];
    R.translate(cRight - R.geometricBounds[0], 0);
    return true;
}
```

- [ ] **Step 2: Verify in Task 5's run** on a GC-LM element (or a stub plate group). Commit.

```bash
git add utils/aiUtils.jsx
git commit -m "feat(captions): port elongateCaptionPlate to AI (GC-LM decorative bar)"
```

---

### Task 5: `buildCaption(...)` integration + run on real traced cuts

**Files:**
- Modify: `utils/aiUtils.jsx` (add `buildCaption`)
- Create: `tests/spike/ai_caption_build_spike.jsx` (throwaway runner for inspection)

**Interfaces:**
- Produces: `buildCaption(layer, textFrame, outline, opts)` → `{ ok, group, needsReview, reason }`. Builds pill (+ optional GC plate via `opts.plateGroup`) → seats into `outline` → unites → bundles → half-cut.
- Consumes: `buildCaptionPill`, `elongateCaptionPlateAI`, `seatPlateToOutline`, `deriveCutline`/`assembleElementGroup`, `syncHalfcut`, `strokeRecursive`.

- [ ] **Step 1: Implement `buildCaption`**

```javascript
// Full native-caption build for one element: pill around the text -> (GC plate) -> seat into the
// white-edge outline -> unite into the cut -> bundle -> half-cut. `outline` = the traced
// white-edged element path. Returns status; ok:false leaves inputs untouched.
function buildCaption(layer, textFrame, outline, opts) {
    opts = opts || {};
    var name = opts.name || (textFrame.contents ? String(textFrame.contents) : "(caption)");
    var built = buildCaptionPill(layer, textFrame, opts);
    var pill = built.pill;

    var rigid = [textFrame, pill];
    if (opts.plateGroup) {
        elongateCaptionPlateAI(opts.plateGroup, built.radius * 2 + mmToPoints(opts.plateWidthPadMm || 1.69) * 2);
        rigid.push(opts.plateGroup);
    }

    // Seat the rigid {text, pill, plate} INTO the white-edge outline (authoritative seat).
    var seat = seatPlateToOutline(name, outline, pill,
        rigid.length > 2 ? opts.plateGroup : textFrame, { polyCache: {} });
    if (!seat.ok) return { ok: false, needsReview: !!seat.needsReview, reason: seat.reason };

    // Unite outline + pill into the fused cut; bundle the separable members.
    var cut = deriveCutline(outline, pill);
    strokeRecursive(cut, (opts.strokePt || 0.25), blackCmyk());
    var group = assembleElementGroup(layer, name, outline, pill, cut);
    group.note = (opts.styleCode || "WC") + "|" + _capLineCount(textFrame);

    // Derive the half-cut from the submerged pill arc.
    var hc = syncHalfcut(layer.parent || layer.layers ? null : null, group, { polyCache: {} });
    return { ok: true, group: group, needsReview: !!seat.needsReview,
             halfcut: hc ? hc.ok : false };
}

function _capLineCount(textFrame) {
    try { var s = String(textFrame.contents).split(/[\r\n]+/), n = 0, i;
          for (i = 0; i < s.length; i++) if (s[i].replace(/^\s+|\s+$/g, "").length > 0) n++;
          return n; } catch (e) { return 1; }
}
```

> Note: `syncHalfcut`'s exact `(doc, group, opts)` signature is in aiUtils — wire the real `doc`/group args during execution (the placeholder `null` above is resolved when `buildCaption` is called from a step that has `doc`). This is the one signature to confirm against aiUtils when implementing.

- [ ] **Step 2: Write the inspection runner**

```javascript
// tests/spike/ai_caption_build_spike.jsx — THROWAWAY. Builds a few traced cuts from the
// white-edged silhouettes, typesets a Kalam caption (one straight, one curved via warp/path),
// runs buildCaption, and lays out the results for inspection.
#target illustrator
#include "../../utils/aiUtils.jsx"
var CONFIG = { inFolder: "~/Desktop/spine-spike-we", cases: 4, cellMm: 70 };
// ... place silhouette -> trace -> outline; add a point-text caption (Kalam 8pt, name);
//     for one case curve the text (text-on-path) to exercise the curved branch;
//     call buildCaption(layer, text, outline, {name:..., styleCode:"WC"}); lay out in a grid.
// (Full body written at execution time against the real API, then run + inspect.)
```

- [ ] **Step 3: Run in Illustrator + inspect (the test)**

Run via osascript (`do javascript file`, alert neutralized). Inspection checklist per case:
- **Pill hugs the text** — straight text → straight/tilted pill; curved text → pill follows the arc; multi-line → tall flat stadium covering both rows.
- **Pill submerges into the white edge** (overlaps it), not merely touching; the fused cut is one closed contour with no gap at the junction.
- **Half-cut** present, spanning the submerged pill arc, **attached to the cut at both ends**.
- **GC-LM** (if exercised): the decorative bar's center stretched, caps unchanged, centered on the pill.
- Log line per case: `[caption] <name> seated=… needsReview=… halfcut=…`.
Iterate (fix the sampler/pill/seat) until all cases pass. Compare curved cases against the PS goldens' look.

- [ ] **Step 4: Commit**

```bash
git add utils/aiUtils.jsx tests/spike/ai_caption_build_spike.jsx
git commit -m "feat(captions): buildCaption integration (pill->seat->unite->half-cut) + inspection runner"
```

---

## Self-review

- **Spec coverage:** §4 reuse/port/delete — reuse (Tasks 3/5 call the existing capsule/seat/unite/half-cut), port spine-sampler (Tasks 1–3), port elongate (Task 4); §5 sampler (Task 2); §6 seat-into-white-edge + unite + half-cut (Task 5). The **delete** + **downstream touch-points** (§7) and **PS strip / handoff slim** are intentionally the follow-on plan (stated in Scope note).
- **Placeholders:** the only deferred specifics are the two DOM-bound bodies validated by running (Task 5 runner body; the `syncHalfcut` arg wiring) — explicitly flagged, not silent. Pure code (Task 1) is complete + node-tested.
- **Type consistency:** `buildCaptionPill` returns `{pill,spine,radius}` consumed by `buildCaption`; `_capSampleTextOutline` returns `{pts,heights,bounds}` consumed by `buildCaptionPill`; `_capQuadFitSpine` returns `{spine,straight}`. Names consistent across tasks.

## Outcome

A standalone, inspected `buildCaption(...)` that pills + seats + unites + half-cuts a native AI caption — straight or curved — reusing the existing geometry. Proven on the spike's real traced cuts. The follow-on plan then wires it into the live pipeline and removes the PS caption steps + sidecar.
