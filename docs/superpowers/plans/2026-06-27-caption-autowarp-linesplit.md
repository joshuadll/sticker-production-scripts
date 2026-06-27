# Caption Auto-Warp + Line-Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At caption birth (Illustrator Step 6, the final phase of Pipeline 1), split caption display names on `|` into stacked lines (WC+GC) and auto-warp WC captions to follow a genuinely curved art base, so the downstream white pill / plate / half-cut curve to match.

**Architecture:** Pure-geometry helpers in `utils/aiUtils.jsx` (node-testable, TDD): line split, bottom-edge profile sampler, and a conservative arc-fit decision (robust quadratic + three gates that keep wavy/ambiguous bases flat). DOM glue (guarded + logged, validated by a manual Illustrator checklist) applies a live Arc warp via `applyEffect` in Step 6 and bakes it for measurement in the Pipeline-2 pill sampler. New behavior is gated by CONFIG in `AI_BuildCutlines.jsx`.

**Tech Stack:** ExtendScript (ES3 — no `let`/`const`/arrows/template-literals), Adobe Illustrator DOM, Node.js for pure-geometry unit tests (regex-extract function bodies from `.jsx` and `eval`).

## Global Constraints

- ES3 only: `var`, `function`, no arrow functions, no template literals, no `const`/`let`.
- Step files export named phase functions; shared logic lives in `utils/aiUtils.jsx`; CONFIG lives only in pipeline scripts (`AI_BuildCutlines.jsx`).
- Log prefix `[step6]` for Step 6 lines; `[buffer]`/bare for util lines per existing style.
- Auto-warp applies to **WC only**. The `|` line-split applies to **WC + GC**.
- Conservative warp disposition: **default flat**; warp only when the base is confidently smooth, symmetric, and arc-like. A missed warp is acceptable (artist warps by hand); a wrong warp is not.
- Cutline group name and caption text-frame name keep the **full** display name (with `|`); only the visible text contents get newlines.
- Node unit tests extract ES3 function bodies via `function NAME[\s\S]*?\n}` — every new function must end with a column-0 `}`.
- Cannot run Illustrator in this environment: DOM code is `try/catch`-guarded, logs its decision, and degrades to the safe path (flat) on failure.

---

### Task 1: `_capSplitLines` — split a display name on `|`

**Files:**
- Modify: `utils/aiUtils.jsx` (add helper next to `_capStraightSpine`, ~line 558)
- Create: `tests/integration/unit/test-caption-linesplit.js`
- Create: `tests/integration/unit/run-test-caption-linesplit.sh`

**Interfaces:**
- Produces: `_capSplitLines(displayName) -> [String, ...]` (trimmed, non-empty segments; no `|` → single-element array; reused by Task 4).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/unit/test-caption-linesplit.js`:

```javascript
// tests/integration/unit/test-caption-linesplit.js
// Pure unit test for _capSplitLines (caption display name -> stacked lines on "|").
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '[\\s\\S]*?\\n}');
    var m = src.match(re);
    if (!m) throw new Error('could not extract ' + name + ' from aiUtils.jsx');
    return m[0];
}
eval(extract('_capSplitLines'));

var fails = 0;
function eq(a, b, msg) {
    var A = JSON.stringify(a), B = JSON.stringify(b);
    if (A !== B) { console.log('FAIL: ' + msg + ' got ' + A + ' want ' + B); fails++; }
}

eq(_capSplitLines('The Blue Church | Manila Cathedral'),
   ['The Blue Church', 'Manila Cathedral'], 'two lines, trimmed');
eq(_capSplitLines('A|B|C'), ['A', 'B', 'C'], 'three lines no spaces');
eq(_capSplitLines('Horseshoe Bend'), ['Horseshoe Bend'], 'no pipe -> single line');
eq(_capSplitLines('  A  |  B  '), ['A', 'B'], 'trims each segment');
eq(_capSplitLines('A || | B'), ['A', 'B'], 'drops empty segments');

console.log(fails === 0 ? 'PASS linesplit' : ('FAIL linesplit (' + fails + ' failure(s))'));
process.exit(fails === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/integration/unit/test-caption-linesplit.js`
Expected: throws `could not extract _capSplitLines from aiUtils.jsx` (non-zero exit).

- [ ] **Step 3: Write minimal implementation**

In `utils/aiUtils.jsx`, immediately after `_capStraightSpine` (~line 558), add:

```javascript
// Splits a caption display name into stacked lines on "|": "A | B" -> ["A","B"]. Trims each
// segment and drops empties; a name with no "|" returns a single-element array. The cutline
// group name and the text-frame name keep the FULL string — only the visible text uses these.
function _capSplitLines(displayName) {
    var whole = String(displayName == null ? "" : displayName);
    var raw = whole.split("|"), out = [], i, s;
    for (i = 0; i < raw.length; i++) {
        s = raw[i].replace(/^\s+|\s+$/g, "");
        if (s.length > 0) out.push(s);
    }
    if (out.length === 0) out.push(whole.replace(/^\s+|\s+$/g, ""));
    return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/integration/unit/test-caption-linesplit.js`
Expected: `PASS linesplit` (exit 0).

- [ ] **Step 5: Create the runner**

Create `tests/integration/unit/run-test-caption-linesplit.sh`:

```bash
#!/bin/bash
# Node unit test for _capSplitLines in aiUtils.jsx (pure string logic, no Adobe app required).
set -euo pipefail
STEP="caption-linesplit-unit"
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "[$STEP] Running caption line-split unit tests (node)..."
if ! command -v node >/dev/null 2>&1; then echo "SKIP [$STEP]: node not found on PATH."; exit 0; fi
if node "$DIR/test-caption-linesplit.js"; then echo "PASS [$STEP]"; exit 0; else echo "FAIL [$STEP]"; exit 1; fi
```

Then: `chmod +x tests/integration/unit/run-test-caption-linesplit.sh && bash tests/integration/unit/run-test-caption-linesplit.sh`
Expected: ends with `PASS [caption-linesplit-unit]`.

- [ ] **Step 6: Commit**

```bash
git add utils/aiUtils.jsx tests/integration/unit/test-caption-linesplit.js tests/integration/unit/run-test-caption-linesplit.sh
git commit -m "feat(captions): _capSplitLines — split display name on | into lines"
```

---

### Task 2: `_capBottomProfile` — lower-envelope of the outline over a span

**Files:**
- Modify: `utils/aiUtils.jsx` (add after `_capColumnSpan`, ~line 644)
- Create: `tests/integration/unit/test-caption-warpfit.js`
- Create: `tests/integration/unit/run-test-caption-warpfit.sh`

**Interfaces:**
- Consumes: `_capColumnSpan(polys, x) -> {lo,hi}|null` (existing).
- Produces: `_capBottomProfile(polys, x0, x1, stepPt) -> [{x,y}, ...]` (y-up; `lo` per column; skips empty columns). Used by Task 5's `warpTextToBaseArc` and by Task 3's test.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/unit/test-caption-warpfit.js`:

```javascript
// tests/integration/unit/test-caption-warpfit.js
// Pure-geometry unit tests for the caption auto-warp decision helpers in aiUtils:
//   _capBottomProfile  — lower envelope of a sampled outline over a span
//   _capBaseArcFit     — conservative warp decision (robust fit + 3 gates)
// Coordinates are AI points, y-UP (lower edge = smaller y).
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '[\\s\\S]*?\\n}');
    var m = src.match(re);
    if (!m) throw new Error('could not extract ' + name + ' from aiUtils.jsx');
    return m[0];
}
eval(extract('_capSolve3'));
eval(extract('_capPercentile'));
eval(extract('_capYAt'));
eval(extract('_capColumnSpan'));
eval(extract('_capRobustBaselineFit'));
eval(extract('_capBottomProfile'));
eval(extract('_capBaseArcFit'));

var fails = 0;
function check(cond, msg) { if (!cond) { console.log('FAIL: ' + msg); fails++; } }
function approx(a, b, t) { return Math.abs(a - b) <= t; }

// ── _capBottomProfile: a rectangle's lower edge is flat at its bottom y ──
(function () {
    var rect = [{x:0,y:10},{x:100,y:10},{x:100,y:40},{x:0,y:40}];
    var prof = _capBottomProfile([rect], 10, 90, 10);
    check(prof.length >= 7, 'rect profile should have ~8 columns, got ' + prof.length);
    var allFlat = true, i;
    for (i = 0; i < prof.length; i++) if (!approx(prof[i].y, 10, 0.001)) allFlat = false;
    check(allFlat, 'rect lower envelope should be flat at y=10');
})();

console.log(fails === 0 ? 'PASS warpfit' : ('FAIL warpfit (' + fails + ' failure(s))'));
process.exit(fails === 0 ? 0 : 1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/integration/unit/test-caption-warpfit.js`
Expected: throws `could not extract _capBottomProfile from aiUtils.jsx`.

- [ ] **Step 3: Write minimal implementation**

In `utils/aiUtils.jsx`, immediately after `_capColumnSpan` (~line 644), add:

```javascript
// Bottom-edge profile of a sampled outline (polys from samplePathToPolygons) over [x0,x1]:
// per column the LOWEST crossing y (lower envelope). Returns [{x,y}…] (y-up: lower = smaller y);
// columns with no ink are skipped. Pure geometry (reuses _capColumnSpan) — node-testable.
function _capBottomProfile(polys, x0, x1, stepPt) {
    var out = [], x, step = (stepPt > 0 ? stepPt : 1);
    for (x = x0; x <= x1 + 1e-6; x += step) {
        var sp = _capColumnSpan(polys, x);
        if (sp) out.push({ x: x, y: sp.lo });
    }
    return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/integration/unit/test-caption-warpfit.js`
Expected: `PASS warpfit` (exit 0).

- [ ] **Step 5: Create the runner**

Create `tests/integration/unit/run-test-caption-warpfit.sh`:

```bash
#!/bin/bash
# Node unit tests for the caption auto-warp decision helpers in aiUtils.jsx
# (_capBottomProfile / _capBaseArcFit — pure geometry, no Adobe app required).
set -euo pipefail
STEP="caption-warpfit-unit"
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "[$STEP] Running caption auto-warp unit tests (node)..."
if ! command -v node >/dev/null 2>&1; then echo "SKIP [$STEP]: node not found on PATH."; exit 0; fi
if node "$DIR/test-caption-warpfit.js"; then echo "PASS [$STEP]"; exit 0; else echo "FAIL [$STEP]"; exit 1; fi
```

Then: `chmod +x tests/integration/unit/run-test-caption-warpfit.sh && bash tests/integration/unit/run-test-caption-warpfit.sh`
Expected: ends with `PASS [caption-warpfit-unit]`.

- [ ] **Step 6: Commit**

```bash
git add utils/aiUtils.jsx tests/integration/unit/test-caption-warpfit.js tests/integration/unit/run-test-caption-warpfit.sh
git commit -m "feat(captions): _capBottomProfile — lower-envelope sampler for the art base"
```

---

### Task 3: `_capBaseArcFit` — conservative warp decision (the wavy-base core)

**Files:**
- Modify: `utils/aiUtils.jsx` (add after `_capBottomProfile`)
- Modify: `tests/integration/unit/test-caption-warpfit.js` (add cases)

**Interfaces:**
- Consumes: `_capRobustBaselineFit(pts,x0,x1,snapTolPt,minCols) -> {straight,bow,nIn,fit:{a,b,c,xm}}`, `_capYAt(fit,px)` (existing).
- Produces: `_capBaseArcFit(profilePts, x0, x1, opts) -> {warp:Bool, bend:Number, radius:Number, bow:Number, resid:Number, reason:String}`. `opts` (all points): `{minCols, minBowPt, maxResidPt, minRadPt, maxRadPt, gapPt, calib, maxBend}`. `bend` is the Arc-warp fraction (−1..1), sign from the parabola (a>0 valley/smile → positive). Used by Task 5.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/unit/test-caption-warpfit.js`, immediately **before** the final `console.log(...)`/`process.exit(...)` lines:

```javascript
// ── _capBaseArcFit gates. Span 0..120 (61 cols @ step 2), y-up. ──
function profile(fn) { var p = [], x; for (x = 0; x <= 120; x += 2) p.push({ x: x, y: fn(x) }); return p; }
var OPTS = { minCols: 8, minBowPt: 1.42, maxResidPt: 1.42, minRadPt: 28, maxRadPt: 1417, gapPt: 8.5, calib: 1.0, maxBend: 0.6 };

// 1. Flat base -> NO warp (bow ~0)
(function () {
    var r = _capBaseArcFit(profile(function (x) { return 100; }), 0, 120, OPTS);
    check(r.warp === false, 'flat base should not warp (' + r.reason + ')');
})();

// 2. Wavy-but-flat base (sine, amp 3pt) -> NO warp (residual gate)
(function () {
    var r = _capBaseArcFit(profile(function (x) { return 100 + 3 * Math.sin(x / 6); }), 0, 120, OPTS);
    check(r.warp === false, 'wavy-flat base should not warp (' + r.reason + ', resid ' + r.resid.toFixed(2) + ')');
})();

// 3. Clean symmetric arc (valley, vertex at x=60) -> WARP, positive bend
(function () {
    var r = _capBaseArcFit(profile(function (x) { return 100 + 0.0018 * (x - 60) * (x - 60); }), 0, 120, OPTS);
    check(r.warp === true, 'clean arc should warp (' + r.reason + ')');
    check(r.bend > 0, 'valley (a>0) should give positive bend, got ' + r.bend);
    check(r.radius > 100 && r.radius < 400, 'radius ~278pt expected, got ' + r.radius.toFixed(0));
})();

// 4. Central notch (2 sharp dips) -> NO warp (outliers rejected / residual)
(function () {
    var p = profile(function (x) { return 100; });
    p[29].y = 60; p[31].y = 60;   // sharp central spikes
    var r = _capBaseArcFit(p, 0, 120, OPTS);
    check(r.warp === false, 'central notch should not warp (' + r.reason + ')');
})();

// 5. Asymmetric lump (arc vertex near the left end) -> NO warp (symmetry gate)
(function () {
    var r = _capBaseArcFit(profile(function (x) { return 100 + 0.0018 * (x - 15) * (x - 15); }), 0, 120, OPTS);
    check(r.warp === false, 'off-centre arc should not warp (' + r.reason + ')');
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/integration/unit/test-caption-warpfit.js`
Expected: throws `could not extract _capBaseArcFit from aiUtils.jsx`.

- [ ] **Step 3: Write minimal implementation**

In `utils/aiUtils.jsx`, immediately after `_capBottomProfile`, add:

```javascript
// Decides whether a caption under this base should warp, and by how much. CONSERVATIVE: returns
// warp:false on anything wavy/ambiguous (default flat — artist warps by hand). Reuses
// _capRobustBaselineFit (robust quadratic + chord bow) then applies three gates:
//   A goodness-of-fit: residual RMS over ALL profile pts <= maxResidPt (wavy => high resid => flat)
//   B chord-bow deadband: bow >= minBowPt (flat-on-average base => ~0 bow => flat)
//   C sane geometry: radius in [minRadPt,maxRadPt] AND arc vertex near centre (symmetry)
// radius ~ 1/(2|a|) from y=a(x-xm)^2+...; bend sign from sign(a) (a>0 = valley = smile, the
// round-base case for a bottom edge in y-up). bend = clamp(calib * span/(radius+gapPt), maxBend).
// Pure geometry — node-testable. Returns {warp,bend,radius,bow,resid,reason}.
function _capBaseArcFit(profilePts, x0, x1, opts) {
    opts = opts || {};
    var minCols    = opts.minCols    != null ? opts.minCols    : 8;
    var minBowPt   = opts.minBowPt   != null ? opts.minBowPt   : 1.42;
    var maxResidPt = opts.maxResidPt != null ? opts.maxResidPt : 1.42;
    var minRadPt   = opts.minRadPt   != null ? opts.minRadPt   : 28;
    var maxRadPt   = opts.maxRadPt   != null ? opts.maxRadPt   : 1417;
    var gapPt      = opts.gapPt      != null ? opts.gapPt      : 0;
    var calib      = opts.calib      != null ? opts.calib      : 1.0;
    var maxBend    = opts.maxBend    != null ? opts.maxBend    : 0.6;
    function none(reason) { return { warp: false, bend: 0, radius: 0, bow: 0, resid: 0, reason: reason }; }
    if (!profilePts || profilePts.length < minCols) return none("too few columns");

    var fit = _capRobustBaselineFit(profilePts, x0, x1, minBowPt, minCols);
    var i, se = 0, n = profilePts.length;
    for (i = 0; i < n; i++) { var dy = profilePts[i].y - _capYAt(fit.fit, profilePts[i].x); se += dy * dy; }
    var resid = Math.sqrt(se / n);
    if (resid > maxResidPt) return none("base not arc-like (resid " + resid.toFixed(2) + ")");
    if (fit.bow < minBowPt) return none("base ~flat (bow " + fit.bow.toFixed(2) + ")");

    var a = fit.fit.a;
    if (a === 0) return none("no curvature");
    var radius = 1 / (2 * Math.abs(a));
    if (radius < minRadPt || radius > maxRadPt) return none("radius out of range (" + Math.round(radius) + "pt)");
    // The fit is y = a*(x-xm)^2 + b*(x-xm) + c, so its vertex is at xm - b/(2a) — NOT xm (which
    // is just the mean-x the quadratic is centred on). A true round base is symmetric: vertex near
    // the span centre. An off-centre lump fails here even though it fit an arc elsewhere.
    var xv = fit.fit.xm - fit.fit.b / (2 * a);
    var cx = (x0 + x1) / 2, halfSpan = (x1 - x0) / 2;
    if (halfSpan <= 0 || Math.abs(xv - cx) > 0.5 * halfSpan) return none("arc not centred");

    var span = x1 - x0;
    var bend = calib * (span / (radius + gapPt));
    if (bend > maxBend) bend = maxBend;
    if (a < 0) bend = -bend;   // a<0 = hill (cap-down); a>0 = valley (smile)
    return { warp: true, bend: bend, radius: radius, bow: fit.bow, resid: resid, reason: "warp" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/integration/unit/run-test-caption-warpfit.sh`
Expected: ends with `PASS [caption-warpfit-unit]`. If case 3 fails the radius bound, note the printed radius and confirm it is ~278pt; do not loosen a gate to force a pass without understanding why.

- [ ] **Step 5: Commit**

```bash
git add utils/aiUtils.jsx tests/integration/unit/test-caption-warpfit.js
git commit -m "feat(captions): _capBaseArcFit — conservative warp decision with wavy-base gates"
```

---

### Task 4: Wire line-split into `_placeCaptionText` (WC + GC)

**Files:**
- Modify: `illustrator/Step6_CreateCutlines.jsx:332-347` (`_placeCaptionText`)

**Interfaces:**
- Consumes: `_capSplitLines(displayName)` (Task 1).
- Produces: caption text frame contents joined by `\r`; frame `.name` unchanged (`displayName + " caption text"`). Returns the text frame (already does).

DOM glue — verified by the node suite (no regression) plus the manual checklist in Task 7. `node --check` rejects `.jsx`, so there is no automated syntax gate; review the diff carefully.

- [ ] **Step 1: Make the edit**

In `illustrator/Step6_CreateCutlines.jsx`, in `_placeCaptionText`, replace the line `tf.contents = displayName;` (currently line 334) with:

```javascript
    var _lines = _capSplitLines(displayName);   // split on "|" -> stacked lines (aiUtils)
    tf.contents = _lines.join("\r");
```

Leave everything else in the function unchanged — `tf.name = displayName + " caption text";` keeps the full name (with any `|`) for matching.

- [ ] **Step 2: Verify no unit-test regression**

Run: `bash tests/integration/unit/run-test-caption-linesplit.sh && bash tests/integration/unit/run-test-caption-warpfit.sh`
Expected: both end in `PASS`.

- [ ] **Step 3: Confirm the call site returns the frame**

Read `illustrator/Step6_CreateCutlines.jsx` around the WC/GC branch (~line 179) and confirm `_placeCaptionText(...)` is called and its return value will be captured in Task 5. No edit here yet.

- [ ] **Step 4: Commit**

```bash
git add illustrator/Step6_CreateCutlines.jsx
git commit -m "feat(captions): Step 6 splits caption display names on | into lines"
```

---

### Task 5: CONFIG knobs + `warpTextToBaseArc` + Step 6 WC warp call

**Files:**
- Modify: `pipelines/AI_BuildCutlines.jsx:30` (after `captionTextGapMm`)
- Modify: `utils/aiUtils.jsx` (add `warpTextToBaseArc` after `buildCaptionPill`, ~line 694)
- Modify: `illustrator/Step6_CreateCutlines.jsx:173-190` (WC branch of `runCreateCutlines`)

**Interfaces:**
- Consumes: `_capBottomProfile`, `_capBaseArcFit` (Tasks 2–3), `samplePathToPolygons(item, stepsPerSeg)`, `mmToPoints(mm)` (existing).
- Produces: `warpTextToBaseArc(textFrame, outline, opts) -> {warped:Bool, bend:Number, reason:String}`. `opts`: `{sampleSteps, minBowMm, maxResidFrac, minRadMm, maxRadMm, gapMm, calib, maxBend}`.

DOM glue — guarded + logged; validated in Task 7.

- [ ] **Step 1: Add CONFIG knobs**

In `pipelines/AI_BuildCutlines.jsx`, immediately after the `captionTextGapMm: 3.0,` line (line 30), add:

```javascript

    // ── Caption auto-warp (Step 6, WC only) — warp text to a curved art base ──
    // Conservative: warps ONLY a confidently smooth, symmetric, arc-like base; wavy/ambiguous
    // bases stay flat (artist warps by hand). See aiUtils._capBaseArcFit / warpTextToBaseArc.
    captionWarpEnabled:       true,
    captionWarpMinBowMm:      0.5,        // Gate B: min chord bow of the base trend to bother warping
    captionWarpMaxResidFrac:  0.5,        // Gate A: max fit residual RMS as a fraction of text height
    captionWarpRadiusRangeMm: [10, 500],  // Gate C: plausible fitted base radius [min, max]
    captionWarpMaxBend:       0.6,        // clamp on the applied Arc-warp bend fraction (-1..1)
    captionWarpBendCalib:     1.0,        // ⚠ KEY KNOB: bend = calib * span/(radius+gap). Tune on a
                                          //     real round SKU so the text curvature matches the base.
```

- [ ] **Step 2: Add `warpTextToBaseArc` to aiUtils**

In `utils/aiUtils.jsx`, immediately after `buildCaptionPill` (ends ~line 694), add:

```javascript
// Warps a caption text frame to follow its element's curved base — but ONLY when the base is a
// confidently smooth, symmetric arc (see _capBaseArcFit). Measures the outline's bottom profile
// over the TEXT's x-span, fits, and on a pass applies a LIVE Arc warp via applyEffect (editable;
// the Pipeline-2 pill sampler bakes it for measurement). DOM-only, guarded — degrades to flat
// (warped:false) on any failure. Returns { warped:Bool, bend:Number, reason:String }.
function warpTextToBaseArc(textFrame, outline, opts) {
    opts = opts || {};
    var steps = opts.sampleSteps != null ? opts.sampleSteps : 16;
    var tb = textFrame.geometricBounds;            // [l,t,r,b] y-up
    var x0 = tb[0], x1 = tb[2], textH = tb[1] - tb[3];
    if (x1 - x0 <= 0) return { warped: false, bend: 0, reason: "empty text bounds" };

    var polys;
    try { polys = samplePathToPolygons(outline, steps); }
    catch (e) { return { warped: false, bend: 0, reason: "sample failed (" + e.message + ")" }; }

    var stepPt = (x1 - x0) / 48;                    // ~48 columns across the text span
    var profile = _capBottomProfile(polys, x0, x1, stepPt);
    var dec = _capBaseArcFit(profile, x0, x1, {
        minBowPt:   mmToPoints(opts.minBowMm     != null ? opts.minBowMm     : 0.5),
        maxResidPt: (opts.maxResidFrac != null ? opts.maxResidFrac : 0.5) * textH,
        minRadPt:   mmToPoints(opts.minRadMm     != null ? opts.minRadMm     : 10),
        maxRadPt:   mmToPoints(opts.maxRadMm     != null ? opts.maxRadMm     : 500),
        gapPt:      mmToPoints(opts.gapMm        != null ? opts.gapMm        : 3.0),
        calib:      opts.calib   != null ? opts.calib   : 1.0,
        maxBend:    opts.maxBend != null ? opts.maxBend : 0.6
    });
    if (!dec.warp) return { warped: false, bend: 0, reason: dec.reason };

    // Adobe Warp live effect: style 1 = Arc, horizontal orientation, bend in -1..1.
    var xml = '<LiveEffect name="Adobe Warp"><Dict data="I styleVer 1 R bend '
        + dec.bend + ' I horizontal 1 R distortV 0 R distortH 0 I rotate 0 I style 1 "/></LiveEffect>';
    try { textFrame.applyEffect(xml); }
    catch (e2) { return { warped: false, bend: 0, reason: "warp effect rejected (" + e2.message + ")" }; }
    return { warped: true, bend: dec.bend, reason: "warped r=" + Math.round(dec.radius) + "pt" };
}
```

- [ ] **Step 3: Call it from Step 6 (WC only)**

In `illustrator/Step6_CreateCutlines.jsx`, in the `if (matched.styleCode === "WC" || matched.styleCode === "GC")` branch (~line 173-181), change the `_placeCaptionText` call to capture the frame and warp WC captions. Replace:

```javascript
            _placeCaptionText(cutlinesLayer, matched.displayName, path,
                CONFIG.captionFont, CONFIG.captionSizePt, CONFIG.captionTracking, CONFIG.captionTextGapMm);
            log("[step6] caption text | " + matched.displayName);
```

with:

```javascript
            var capTf = _placeCaptionText(cutlinesLayer, matched.displayName, path,
                CONFIG.captionFont, CONFIG.captionSizePt, CONFIG.captionTracking, CONFIG.captionTextGapMm);
            log("[step6] caption text | " + matched.displayName);
            if (matched.styleCode === "WC" && CONFIG.captionWarpEnabled) {
                var warpRes = warpTextToBaseArc(capTf, path, {
                    minBowMm:     CONFIG.captionWarpMinBowMm,
                    maxResidFrac: CONFIG.captionWarpMaxResidFrac,
                    minRadMm:     CONFIG.captionWarpRadiusRangeMm[0],
                    maxRadMm:     CONFIG.captionWarpRadiusRangeMm[1],
                    gapMm:        CONFIG.captionTextGapMm,
                    calib:        CONFIG.captionWarpBendCalib,
                    maxBend:      CONFIG.captionWarpMaxBend
                });
                log("[step6] caption warp | " + matched.displayName + " -> "
                    + (warpRes.warped ? ("bend " + warpRes.bend.toFixed(3) + " (" + warpRes.reason + ")")
                                      : ("flat (" + warpRes.reason + ")")));
            }
```

- [ ] **Step 4: Verify no unit-test regression**

Run: `bash tests/integration/unit/run-test-caption-warpfit.sh`
Expected: `PASS [caption-warpfit-unit]` (confirms the extracted helpers still parse/behave after the aiUtils edits).

- [ ] **Step 5: Commit**

```bash
git add pipelines/AI_BuildCutlines.jsx utils/aiUtils.jsx illustrator/Step6_CreateCutlines.jsx
git commit -m "feat(captions): Step 6 auto-warps WC captions to a curved base (live Arc warp)"
```

---

### Task 6: Pipeline-2 consumption — bake the warp for sampling + curved multi-line pill

**Files:**
- Modify: `utils/aiUtils.jsx:590-610` (`_capSampleTextOutline`)
- Modify: `utils/aiUtils.jsx:669-689` (`buildCaptionPill` gating)

**Interfaces:**
- No new exports. Behavior change: the pill sampler reads warped geometry; a genuinely curved multi-line caption produces a swept (not flat) pill.

DOM/behavior change — validated in Task 7. The risk to guard: a **flat** multi-line caption must still get a **flat** pill.

- [ ] **Step 1: Bake live appearance before sampling**

In `utils/aiUtils.jsx`, in `_capSampleTextOutline`, replace the first two lines of the body:

```javascript
    var dup = textFrame.duplicate();
    var outlined = dup.createOutline();          // GroupItem of glyph outlines (replaces dup)
```

with:

```javascript
    var dup = textFrame.duplicate();
    // Bake any live appearance (e.g. a Step-6 Arc warp) into geometry so the sampled baseline
    // reflects the warp. expandStyle is a no-op for a plain frame, which then still needs
    // createOutline; a warped frame expands to a group of warped paths we can sample directly.
    var outlined;
    try {
        app.selection = [dup];
        app.executeMenuCommand("expandStyle");
        var ex = (app.selection && app.selection.length) ? app.selection[0] : dup;
        outlined = (ex.typename === "TextFrame") ? ex.createOutline() : ex;
    } catch (eEx) {
        outlined = dup.createOutline();
    }
```

Leave the rest of `_capSampleTextOutline` unchanged (it already calls `samplePathToPolygons(outlined, 16)`, reads `outlined.geometricBounds`, and `outlined.remove()` — all valid for a GroupItem).

- [ ] **Step 2: Allow a curved multi-line pill**

In `utils/aiUtils.jsx`, in `buildCaptionPill`, replace the gating block (currently ~lines 669-689):

```javascript
    var spine, radius;
    if (!s || s.base.length < 3 || _capIsMultiLine(textFrame)) {   // degenerate / multi-line -> flat
        var fp0 = flatPill(); spine = fp0.spine; radius = fp0.radius;
    } else {
        var fit = _capRobustBaselineFit(s.base, bb[0], bb[2], snapPt, minCols);
        if (fit.straight) {
            var fp = flatPill(); spine = fp.spine; radius = fp.radius;
        } else {
            // Curved: the centreline is the baseline lifted by half the line height (parallel
            // under warp). Line height = a high percentile of per-band heights (one line, not the
            // arc-inflated bbox). radius covers that line + pad.
            var halfBody = _capPercentile(s.heights, pctile) / 2;
            radius = halfBody + padPt / 2;
            spine = [];
            var M = 40, p;
            for (p = 0; p <= M; p++) {
                var sx = bb[0] + (bb[2] - bb[0]) * (p / M);
                spine.push({ x: sx, y: _capYAt(fit.fit, sx) + halfBody });
            }
        }
    }
```

with (only the gating changes — multi-line no longer force-flattens; the baseline fit decides, and the curved branch covers the full two-line span because the band sampler already reports it):

```javascript
    var spine, radius;
    if (!s || s.base.length < 3) {                 // degenerate -> flat
        var fp0 = flatPill(); spine = fp0.spine; radius = fp0.radius;
    } else {
        var fit = _capRobustBaselineFit(s.base, bb[0], bb[2], snapPt, minCols);
        if (fit.straight) {                        // straight (single OR multi-line) -> flat bbox stadium
            var fp = flatPill(); spine = fp.spine; radius = fp.radius;
        } else {
            // Genuinely curved (single OR multi-line): the centreline is the bottom-of-ink baseline
            // lifted by half the body height (parallel under warp). For multi-line, the band sampler
            // reports the full two-line vertical span, so halfBody covers both lines + pad.
            var halfBody = _capPercentile(s.heights, pctile) / 2;
            radius = halfBody + padPt / 2;
            spine = [];
            var M = 40, p;
            for (p = 0; p <= M; p++) {
                var sx = bb[0] + (bb[2] - bb[0]) * (p / M);
                spine.push({ x: sx, y: _capYAt(fit.fit, sx) + halfBody });
            }
        }
    }
```

`_capIsMultiLine` stays defined and is still used in `buildCaption` for the note's line count — do not remove it.

- [ ] **Step 3: Verify no unit-test regression**

Run: `bash tests/integration/unit/run-test-caption-warpfit.sh && bash tests/integration/unit/run-test-caption-spinefit.sh`
Expected: both `PASS` (the spine-fit helpers `buildCaptionPill` depends on are unchanged).

- [ ] **Step 4: Commit**

```bash
git add utils/aiUtils.jsx
git commit -m "feat(captions): pill sampler bakes the warp + allows a curved multi-line pill"
```

---

### Task 7: Manual Illustrator validation + calibration (owner-run)

**Files:**
- Modify (as needed during tuning): `pipelines/AI_BuildCutlines.jsx` (CONFIG knobs)
- Modify (if goldens shift): affected `tests/integration/**/expected.txt`

**Interfaces:** none (validation gate for the DOM work that can't be node-tested).

This task is run by the owner in Adobe (cannot be automated here). It mirrors how the seat/half-cut reworks were landed: guard + log + visual checklist, then tune one constant.

- [ ] **Step 1: Run the full unit suite**

Run: `bash tests/integration/run-all.sh`
Expected: the three caption unit runners (`caption-linesplit-unit`, `caption-warpfit-unit`, `caption-spinefit-unit`) all `PASS`. (Adobe-dependent pipeline runners may SKIP/FAIL only if the apps/fixtures aren't present — note which.)

- [ ] **Step 2: Run Pipeline 1 on a real SKU with curved-base WC elements**

Open the source SKU, run `PS_BuildElements`, let it BridgeTalk into Illustrator. Inspect the placed captions and `pipelines/AI_BuildCutlines.log` (`[step6] caption warp |` lines).

- [ ] **Step 3: Walk the visual checklist**

  - A round/curved-base WC caption is warped to a smile arc that visually follows the base with a uniform gap.
  - A flat-bottomed WC element's caption stays flat (log: `flat (base ~flat …)`).
  - A wavy-but-flat watercolor base stays flat (log: `flat (base not arc-like …)`).
  - A `|` display name renders as two stacked lines; the cutline group + text-frame names keep the full string with `|`.
  - The warp is a LIVE effect (Appearance panel shows **Warp: Arc**, editable via Effect → Warp Options).

- [ ] **Step 4: Calibrate `captionWarpBendCalib`**

If the warped curvature is too strong/weak vs. the base, adjust `CONFIG.captionWarpBendCalib` (and, if the smile is inverted, confirm the sign in `_capBaseArcFit`'s `a<0` branch / flip `calib` sign). Re-run until a round SKU reads as concentric. Record the landed value.

- [ ] **Step 5: Validate Pipeline 2 builds the curved pill**

Run `AI_BuildAndExportCutlines` on the same doc. Confirm: WC pill follows the warped baseline for single- AND two-line captions; a flat two-line caption still gets a flat pill; the seat + half-cut succeed (no "unseated caption" hard error).

- [ ] **Step 6: Regenerate any shifted goldens**

If the new behavior changes a committed golden (e.g. the Pipeline-1/Pipeline-2 integration `expected.txt`), regenerate per `docs/testing.md`, **review each diff**, and commit.

```bash
git add -A
git commit -m "test(captions): re-baseline goldens + land captionWarpBendCalib after Illustrator validation"
```

---

## Self-Review

**Spec coverage:**
- Line split on `|` (WC+GC) → Tasks 1, 4. Name/group-name keep full string → Task 4 + Global Constraints.
- Auto-warp WC only → Task 5 (WC guard in Step 6).
- Measure & fit per element → Tasks 2, 3, 5.
- Conservative wavy-base disposition (3 gates) → Task 3 (+ tests for flat/wavy/notch/asymmetric).
- Live Arc warp via applyEffect (editable) → Task 5.
- Pill sampler bakes the warp → Task 6 Step 1.
- Curved multi-line pill → Task 6 Step 2.
- CONFIG knobs → Task 5 Step 1.
- bend↔curvature calibration risk + visual checklist → Task 7.
- Out of scope (GC warp, seat/half-cut engine, Photoshop) → untouched.

**Placeholder scan:** No TBD/TODO; every code step shows full code; every command has expected output.

**Type consistency:** `_capSplitLines` (Tasks 1↔4); `_capBottomProfile(polys,x0,x1,stepPt)` (Tasks 2↔5); `_capBaseArcFit(profilePts,x0,x1,opts){warp,bend,radius,bow,resid,reason}` (Tasks 3↔5); `warpTextToBaseArc(textFrame,outline,opts){warped,bend,reason}` (Task 5↔Step 6 call). `_capBaseArcFit` opts are point-based (`*Pt`); `warpTextToBaseArc` converts mm→pt before calling. `_capRobustBaselineFit`/`_capYAt`/`_capColumnSpan`/`samplePathToPolygons`/`mmToPoints` match existing signatures.
