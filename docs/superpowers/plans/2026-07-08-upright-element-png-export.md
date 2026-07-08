# Upright Per-Element PNG Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export each per-element PNG in its upright design orientation (die-cut hugging, caption horizontal and below the art), regardless of nest rotation or the artist's manual per-piece rotation.

**Architecture:** In Step 10's per-element PNG path only, measure the element's current orientation from its caption reference geometry (the `" plate"` pill, else the `" tab cutline"`) via the farthest-apart anchor pair — a vector measurement that reflects nesting *and* every manual rotation, and sidesteps the `embed()` matrix sign-flip. Then rotate the assembled temporary clip group to upright with a document-space pivot matrix before export. Pure-geometry core lives in `aiUtils.jsx` and is node-unit-tested; DOM wrappers and wiring are integration-tested.

**Tech Stack:** Adobe Illustrator ExtendScript (ES3), node.js for pure-function unit tests, bash integration runners driving Illustrator.

## Global Constraints

- Language: ExtendScript ES3 — **no** `let`/`const`, **no** arrow functions, **no** template literals. (CLAUDE.md)
- Step files export phase functions only; no `#target`/`CONFIG`/`main()`. Shared helpers go in `utils/aiUtils.jsx`. (CLAUDE.md)
- Log every Step 10 line with the `[step10]` prefix. (CLAUDE.md)
- Warn-on-all: never silently drop; a missing/degenerate reference is logged. (working preferences)
- Do **not** modify Step 7B / nesting code (avoids re-validating the nest). Step 7B keeps its private `_nestPivotMatrix`/`_nestVisAngle`; aiUtils gets its own copies (intentional short-term duplication). (design doc)
- Rotate rasters with an **explicit matrix + `Transformation.DOCUMENTORIGIN`**, never `.rotate()` (a raster's `.rotate()` counter-rotates — Step7B:566-568).
- Coordinate frame: Illustrator document points are **y-up** (`geometricBounds` = `[left, top, right, bottom]` with `top > bottom`); angles are degrees, **+CCW**, matching `app.concatenateRotationMatrix`.

Design doc: `docs/superpowers/specs/2026-07-08-upright-element-png-export-design.md`

---

### Task 1: Pure-geometry orientation core (aiUtils) + unit test

Pure functions over `[{x,y}]` arrays: centroid, long-axis angle (farthest pair), and the full upright-rotation angle (long axis horizontal + 180° up/down resolution). No Illustrator DOM — node-unit-testable via the repo's extract-and-eval harness.

**Files:**
- Modify: `utils/aiUtils.jsx` (add three functions near the other geometry helpers, e.g. just after `boundsCenter` around line 65-75)
- Test: `tests/integration/unit/test-upright-rotation.js` (create)

**Interfaces:**
- Produces:
  - `_anchorCentroid(pts)` → `{x, y}` or `null` (empty input)
  - `_longAxisAngleDeg(pts)` → Number degrees (+CCW) or `null` (< 2 points / coincident)
  - `_uprightRotationDeg(refPts, artPts)` → Number degrees to rotate the element upright, or `null` (reference < 2 points). `artPts` may be `null` (skips the 180° up/down resolution).

- [ ] **Step 1: Write the failing unit test**

Create `tests/integration/unit/test-upright-rotation.js`:

```javascript
// Pure-geometry unit test for the upright-rotation core (aiUtils.jsx). y-UP coords.
// _uprightRotationDeg(refPts, artPts) returns the degrees to rotate an element so its
// caption reference is horizontal AND below the art (the Step-6 design orientation).
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '[\\s\\S]*?\\n}');
    var m = src.match(re); if (!m) throw new Error('could not extract ' + name); return m[0];
}
eval(extract('_anchorCentroid'));
eval(extract('_longAxisAngleDeg'));
eval(extract('_uprightRotationDeg'));

var fails = 0;
function check(c, m) { if (!c) { console.log('FAIL: ' + m); fails++; } }
function near(a, b, tol, m) { check(Math.abs(a - b) <= (tol || 1e-6), m + ' (got ' + a + ', want ' + b + ')'); }

// ── _anchorCentroid ──
(function () {
    check(_anchorCentroid([]) === null, 'centroid: empty -> null');
    var c = _anchorCentroid([{x:0,y:0},{x:10,y:20},{x:20,y:40}]);
    near(c.x, 10, 1e-9, 'centroid x'); near(c.y, 20, 1e-9, 'centroid y');
})();

// ── _longAxisAngleDeg (farthest pair direction, modulo sign of the pair order) ──
(function () {
    check(_longAxisAngleDeg([{x:0,y:0}]) === null, 'longaxis: <2 pts -> null');
    // Horizontal pill: ends at (-50,0),(50,0) with mid noise -> 0deg (or 180, same axis).
    var h = _longAxisAngleDeg([{x:-50,y:0},{x:0,y:3},{x:50,y:0}]);
    check(Math.abs(h) < 1e-6 || Math.abs(Math.abs(h) - 180) < 1e-6, 'longaxis: horizontal -> 0/180, got ' + h);
    // Vertical pill: ends at (0,-50),(0,50) -> 90 (or -90).
    var v = _longAxisAngleDeg([{x:0,y:-50},{x:3,y:0},{x:0,y:50}]);
    check(Math.abs(Math.abs(v) - 90) < 1e-6, 'longaxis: vertical -> +-90, got ' + v);
})();

// ── _uprightRotationDeg ──
// Case A: plate already horizontal, art already above plate -> ~0 rotation.
(function () {
    var ref = [{x:-50,y:0},{x:50,y:0}];      // plate long axis horizontal, centroid (0,0)
    var art = [{x:-20,y:100},{x:20,y:100}];  // art centroid (0,100) -> above plate
    var t = _uprightRotationDeg(ref, art);
    check(Math.abs(t) < 1e-6, 'upright A: already upright -> 0, got ' + t);
})();

// Case B: plate horizontal but art BELOW plate (upside down) -> 180.
(function () {
    var ref = [{x:-50,y:0},{x:50,y:0}];
    var art = [{x:-20,y:-100},{x:20,y:-100}];  // art below plate
    var t = _uprightRotationDeg(ref, art);
    check(Math.abs(Math.abs(t) - 180) < 1e-6, 'upright B: upside down -> 180, got ' + t);
})();

// Case C: plate vertical (ends (0,+-50)), art to the RIGHT (+x). Upright needs
// plate horizontal + below art. Correct answer rotates so art ends up ABOVE plate.
(function () {
    var ref = [{x:0,y:-50},{x:0,y:50}];       // centroid (0,0)
    var art = [{x:100,y:0}];                    // centroid (100,0), right of plate
    var t = _uprightRotationDeg(ref, art);
    // After rotating everything by t, art must be above plate. Verify by rotating the
    // art-minus-plate vector (100,0) by t and checking its y becomes > 0.
    var r = t * Math.PI / 180;
    var ry = 100 * Math.sin(r) + 0 * Math.cos(r);
    check(ry > 0, 'upright C: art ends above plate (ry>0), got t=' + t + ' ry=' + ry);
    // And the plate long axis becomes horizontal: rotate a plate end (0,50) by t -> y ~ 0.
    var py = 0 * Math.sin(r) + 50 * Math.cos(r);
    check(Math.abs(py) < 1e-6, 'upright C: plate horizontal after rotate, plate-end y=' + py);
})();

// Case D: null reference -> null.
(function () {
    check(_uprightRotationDeg([{x:0,y:0}], [{x:0,y:9}]) === null, 'upright D: <2 ref pts -> null');
})();

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/integration/unit/test-upright-rotation.js`
Expected: throws `could not extract _anchorCentroid` (functions don't exist yet).

- [ ] **Step 3: Implement the three pure helpers in aiUtils.jsx**

Insert after `boundsCenter` (around line 75) in `utils/aiUtils.jsx`:

```javascript
// Centroid ({x,y}) of an array of {x,y} points, or null when empty.
function _anchorCentroid(pts) {
    if (!pts || !pts.length) return null;
    var sx = 0, sy = 0, i;
    for (i = 0; i < pts.length; i++) { sx += pts[i].x; sy += pts[i].y; }
    return { x: sx / pts.length, y: sy / pts.length };
}

// Long-axis angle (degrees, +CCW, y-up) of a point cloud = the direction of its
// farthest-apart pair. The two ends of a pill/tab are its farthest points, so the
// pair direction is the long axis (robust on warped WC capsules: the end tips define
// the chord). Returns null for < 2 points or a degenerate (coincident) cloud. O(n^2)
// on the small reference-path anchor set.
function _longAxisAngleDeg(pts) {
    if (!pts || pts.length < 2) return null;
    var bi = 0, bj = 1, bd = -1, i, j, dx, dy, d;
    for (i = 0; i < pts.length; i++) {
        for (j = i + 1; j < pts.length; j++) {
            dx = pts[j].x - pts[i].x; dy = pts[j].y - pts[i].y;
            d = dx * dx + dy * dy;
            if (d > bd) { bd = d; bi = i; bj = j; }
        }
    }
    if (bd <= 0) return null;
    return Math.atan2(pts[bj].y - pts[bi].y, pts[bj].x - pts[bi].x) * 180 / Math.PI;
}

// Degrees (+CCW) to rotate an element into its upright design orientation for export:
// makes the reference feature's long axis horizontal AND places the reference BELOW the
// art. refPts = reference (plate/tab) anchors; artPts = outline (art) anchors, may be
// null (then the up/down resolution is skipped). Returns null when refPts has < 2
// points (caller falls back). Pure geometry — reflects the element's CURRENT orientation
// (nest + any manual rotation), independent of any item matrix.
function _uprightRotationDeg(refPts, artPts) {
    var phi = _longAxisAngleDeg(refPts);
    if (phi === null) return null;
    var theta = -phi;                              // long axis -> horizontal
    var cRef = _anchorCentroid(refPts);
    var cArt = _anchorCentroid(artPts);
    if (cRef && cArt) {
        // Rotate (cRef - cArt) by theta; in upright the reference sits BELOW the art
        // (negative y, y-up). If it lands above (y > 0), the element is upside down.
        var vx = cRef.x - cArt.x, vy = cRef.y - cArt.y;
        var r  = theta * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
        var ry = vx * sn + vy * cs;
        if (ry > 0) theta += 180;
    }
    return theta;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node tests/integration/unit/test-upright-rotation.js`
Expected: `all passed`

- [ ] **Step 5: Commit**

```bash
git add utils/aiUtils.jsx tests/integration/unit/test-upright-rotation.js
git commit -m "feat(aiUtils): pure-geometry upright-rotation core for element export

Farthest-pair long-axis angle + centroid + upright-rotation (horizontal
reference, below art) over {x,y} arrays. Node-unit-tested. Consumed by
Step 10's per-element PNG upright rotation.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: DOM wrappers (aiUtils) + wire upright rotation into Step 10

Add the Illustrator-DOM helpers (`_pathAnchors`, `pivotRotationMatrix`) and a `_s10RotateUpright` that measures the reference, resolves the angle (with note-stamp + WARN fallbacks), and rotates the temp clip group before the per-element PNG export. Sheet JPEG previews are untouched.

**Files:**
- Modify: `utils/aiUtils.jsx` (add `_pathAnchors`, `pivotRotationMatrix` near the new pure helpers)
- Modify: `illustrator/Step10_AssetExport.jsx` (add `_s10RotateUpright`; call it inside `_s10ExportElementPng`'s `if (cutlinePath)` block after `_s10ClipGroup(doc, grp);`, currently line ~247)

**Interfaces:**
- Consumes (Task 1): `_uprightRotationDeg(refPts, artPts)`, and existing aiUtils `findGroupMember`, `noteReadRotStamp`, `_aiNormalizeDeg`, `log`.
- Produces:
  - `_pathAnchors(item)` → `[{x,y}]` for a PathItem/CompoundPathItem, `[]` otherwise
  - `pivotRotationMatrix(angleDeg, px, py)` → Illustrator `Matrix` (rotation about `(px,py)`)
  - `_s10RotateUpright(doc, grp, entry)` → void (rotates `grp` in place; logs one `[step10]` line)

- [ ] **Step 1: Add the DOM helpers to aiUtils.jsx**

Insert immediately after `_uprightRotationDeg` in `utils/aiUtils.jsx`:

```javascript
// Flat array of {x,y} anchor points of a PathItem or CompoundPathItem (all sub-paths);
// [] for any other type. DOM-only (not unit-tested).
function _pathAnchors(item) {
    var out = [], i, j, pts;
    if (!item) return out;
    if (item.typename === "CompoundPathItem") {
        for (i = 0; i < item.pathItems.length; i++) {
            pts = item.pathItems[i].pathPoints;
            for (j = 0; j < pts.length; j++) out.push({ x: pts[j].anchor[0], y: pts[j].anchor[1] });
        }
    } else if (item.typename === "PathItem") {
        pts = item.pathPoints;
        for (j = 0; j < pts.length; j++) out.push({ x: pts[j].anchor[0], y: pts[j].anchor[1] });
    }
    return out;
}

// Rotation-about-pivot matrix (mirrors Step 7B's _nestPivotMatrix; kept here so Step 10,
// which does not #include Step 7B, can rotate its export group in the same +CCW,
// DOCUMENTORIGIN convention). Apply with item.transform(m, true,true,true,true,1,
// Transformation.DOCUMENTORIGIN).
function pivotRotationMatrix(angleDeg, px, py) {
    var m = app.getTranslationMatrix(-px, -py);
    m = app.concatenateRotationMatrix(m, angleDeg);
    m = app.concatenateTranslationMatrix(m, px, py);
    return m;
}
```

- [ ] **Step 2: Add `_s10RotateUpright` to Step10_AssetExport.jsx**

Add this function in `illustrator/Step10_AssetExport.jsx` in the PRIVATE HELPERS section (e.g. just after `_s10AddCaptionMembers`, around line 330):

```javascript
// Rotates the temp clip group `grp` to the element's upright design orientation before
// the per-element PNG export: the caption reference (plate, else peel-tab cutline) is
// laid horizontal and below the art — the Step-6 orientation, regardless of nesting or
// the artist's manual rotation. Angle comes from the reference GEOMETRY on the live
// cutline (matrix-independent, so it dodges the embed() sign-flip and reflects manual
// rotation). Falls back to the u<deg> note stamp, then to a no-op + WARN. The sheet
// JPEG previews do NOT call this — they must keep the nested layout.
function _s10RotateUpright(doc, grp, entry) {
    var cut = entry.cutline, theta = null;
    if (cut && cut.typename === "GroupItem") {
        var ref = findGroupMember(cut, " plate");
        if (!ref) ref = findGroupMember(cut, " tab cutline");
        var art = findGroupMember(cut, " outline");
        if (ref) theta = _uprightRotationDeg(_pathAnchors(ref), art ? _pathAnchors(art) : null);
    }
    if (theta === null && cut) {
        var u = noteReadRotStamp(cut.note);     // nest-time deviation; last resort
        if (u !== null) theta = -u;
    }
    if (theta === null) {
        log("[step10] WARN | no upright reference for '" + entry.displayName
            + "' — exported in nest orientation");
        return;
    }
    theta = _aiNormalizeDeg(theta);
    if (Math.abs(theta) < 0.05) {
        log("[step10] upright | " + entry.displayName + " | already upright");
        return;
    }
    var gb = grp.geometricBounds;               // [left, top, right, bottom]
    var cx = (gb[0] + gb[2]) / 2, cy = (gb[1] + gb[3]) / 2;
    grp.transform(pivotRotationMatrix(theta, cx, cy),
        true, true, true, true, 1, Transformation.DOCUMENTORIGIN);
    log("[step10] upright | " + entry.displayName + " | rotated " + Math.round(theta) + "°");
}
```

- [ ] **Step 3: Call `_s10RotateUpright` in `_s10ExportElementPng`**

In `illustrator/Step10_AssetExport.jsx`, inside `_s10ExportElementPng`, the `if (cutlinePath) { ... }` block ends with `_s10ClipGroup(doc, grp);` (line ~247). Add the upright call on the next line, still inside that block:

```javascript
        cutDupe.moveToBeginning(grp);   // re-assert the mask at pageItems[0]
        _s10ClipGroup(doc, grp);
        _s10RotateUpright(doc, grp, entry);   // upright for export (per-element PNG only)
    } else {
```

(Do NOT add it to the `else`/stamp white-rectangle branch — that path is dormant, and `entry.cutline` there is a PlacedItem with no reference members, so it would only ever hit the WARN fallback.)

- [ ] **Step 4: ES3 + syntax sanity check**

There is no node parser for `.jsx` (node --check rejects it). Verify by inspection:
- No `let`/`const`/arrow/template-literals introduced.
- `_uprightRotationDeg`, `_pathAnchors`, `pivotRotationMatrix`, `findGroupMember`, `noteReadRotStamp`, `_aiNormalizeDeg`, `log` are all defined in `utils/aiUtils.jsx` (in scope for Step 10 via AI_ExportFinal's `#include ../utils/aiUtils.jsx`).

Run: `node tests/integration/unit/test-upright-rotation.js`
Expected: `all passed` (confirms Task 1 core still parses/evaluates after the aiUtils edits).

- [ ] **Step 5: Commit**

```bash
git add utils/aiUtils.jsx illustrator/Step10_AssetExport.jsx
git commit -m "feat(step10): export each element PNG upright

Rotate the per-element clip group so the caption reference (plate, else
tab cutline) is horizontal and below the art — the Step-6 design
orientation — before the PNG export. Angle measured from reference
geometry (reflects nest + manual rotation, matrix-independent). Note-stamp
and WARN fallbacks. Sheet JPEG previews unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Regenerate the ai-export-final golden + manual Adobe validation

The new `[step10] upright | …` log lines change the integration golden. Regenerate it against the fixture, and run the manual Adobe checklist (the geometry can't be render-verified headless).

**Files:**
- Modify: `tests/integration/ai-export-final/expected.txt` (regenerate)
- Reference: `tests/integration/ai-export-final/run.sh`, `docs/superpowers/specs/2026-07-08-upright-element-png-export-design.md`

**Interfaces:**
- Consumes: the wired Step 10 from Task 2. No new code.

- [ ] **Step 1: Run the integration test (expect a golden diff)**

Requires Adobe Illustrator and the fixture `tests/integration/ai-export-final/fixtures/step8c-cutlines.ai`.

Run: `bash tests/integration/ai-export-final/run.sh`
Expected: the run completes, but the golden diff FAILS — the only differences are new `[step10] upright | <name> | rotated N°` / `already upright` lines (one per element), plus any `WARN | no upright reference` lines. Confirm there are **no** new ERROR lines and `pngCount` is unchanged from the prior golden.

- [ ] **Step 2: Inspect the exported PNGs in `/tmp`**

Open several `/tmp/<STK>_<name>.png` (pick a WC caption, a GC caption, and — if present — a stamp). Confirm each is **upright** (caption horizontal, reading left-to-right, sitting **below** the art), die-cut clean, caption still registered to the art, and the transparent bounding box hugs the sticker (little corner padding). Re-open the fixture, **manually rotate 2-3 pieces** by arbitrary angles, re-run, and confirm those PNGs also come out upright (this is the manual-rotation acceptance and the 180° up/down check).

- [ ] **Step 3: Update the golden**

Only after Step 2 looks correct:

```bash
cp /tmp/AI_ExportFinal.log tests/integration/ai-export-final/expected.txt
```

- [ ] **Step 4: Re-run to confirm the golden now matches**

Run: `bash tests/integration/ai-export-final/run.sh`
Expected: PASS (log matches the regenerated golden). Integration goldens are re-run to confirm determinism.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/ai-export-final/expected.txt
git commit -m "test(ai-export-final): regenerate golden for upright PNG log lines

Adds [step10] upright | … lines per element. Sheet geometry unchanged;
only per-element PNG orientation changed. PNGs manually verified upright
in Illustrator, including after manual per-piece rotation.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Upright via reference geometry (plate/tab, farthest-pair) → Task 1 (core) + Task 2 (wiring). ✓
- 180° up/down resolution → Task 1 `_uprightRotationDeg` + unit Case B/C. ✓
- Matrix-independent / embed sign-flip avoided → geometry measurement, document-space pivot; noted in Task 2. ✓
- Explicit-matrix rotation (no `.rotate()`) → `pivotRotationMatrix` + `.transform(…DOCUMENTORIGIN)` in `_s10RotateUpright`. ✓
- Fallbacks (note stamp, then WARN) → `_s10RotateUpright`. ✓
- Sheet JPEG previews unchanged → call added only in `_s10ExportElementPng`, not `_s10ExportJpegs`. ✓
- Stamp white-rectangle branch untouched → explicitly excluded in Task 2 Step 3. ✓
- Step 7B untouched → aiUtils gets its own `pivotRotationMatrix` copy. ✓
- Resolution already correct → no task (findings). ✓
- Testing: unit (Task 1) + golden regen + manual checklist (Task 3). ✓

**Placeholder scan:** none — all code and commands are concrete.

**Type consistency:** `_uprightRotationDeg(refPts, artPts)`, `_pathAnchors(item)`, `pivotRotationMatrix(angleDeg, px, py)`, `_s10RotateUpright(doc, grp, entry)` used with identical signatures in Tasks 1-2. `entry.cutline` / `entry.displayName` match the `clipData` shape built by `_s10BuildClipData`. ✓
