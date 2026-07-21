# Caption seat — two-point contact — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the caption-pill seating in `seatPlateToOutline` so the pill's two inner-edge endpoints land exactly on the traced art border (killing the junction "bump"), via translate-nearest-to-contact then rotate-about-pivot-until-far-touches.

**Architecture:** Keep the existing geometry/inner-edge/overhang/bulge steps. Split the final placement: the TAB branch keeps today's rotate-then-kiss unchanged; the CAPTION branch is rewritten to (A) translate the nearer endpoint onto its border point at depth 0, (B) rotate about it until the far endpoint lands on the border — solved exactly as *circle(radius = chord length, center = near point) ∩ border* — and (C) an optional embed (default 0). New logic is factored into pure, headless-testable helpers; the DOM composition is validated live in Illustrator (matching this repo's convention that DOM-bound seat pieces are validated in-app, not headless).

**Tech Stack:** ExtendScript (ES3 — no `let`/`const`/arrow/template-literals), Adobe Illustrator DOM, `osascript`-driven unit + integration runners.

## Global Constraints

- **ES3 only:** `var`, `function` expressions, string concatenation. No `let`/`const`, arrow functions, template literals, or native `JSON`.
- **Step files own no CONFIG/main:** shared code lives in `utils/aiUtils.jsx`; tuneables live in the pipeline CONFIGs.
- **Log prefix:** seat logs use `[seat]` / `[seatdbg]` exactly as today.
- **`seatPlateToOutline` return contract is unchanged:** `{ ok, moved, rotDeg, needsReview, reason }`.
- **Design source of truth:** `docs/superpowers/specs/2026-07-21-caption-seat-two-point-contact-design.md`.
- **Live validation is authoritative** (per project practice); goldens are regenerated only after a clean live run, reviewing every diff.
- **Caption embed default = 0** via a new `captionSeatOverlapMm` knob; the existing `seatOverlapMm` stays the TAB embed, untouched.

---

### Task 1: Pure helper — circle ∩ border intersections

**Files:**
- Modify: `utils/aiUtils.jsx` (add `_dedupePoints` + `_circlePolyIntersections` near the other seat helpers, after `_aiKissVector`, ~`aiUtils.jsx:1914`)
- Test: `tests/integration/unit/test-ai-caption-seat.jsx` (append a section)
- Runner: `tests/integration/unit/run-test-ai-caption-seat.sh` (unchanged; reused)

**Interfaces:**
- Produces: `_circlePolyIntersections(P, L, polys)` → `Array<{x,y}>` — every point where the circle of radius `L` centered at `P` crosses a segment of the sampled border polygons `polys` (`[[{x,y}...], ...]`), deduped. Empty array when the circle never reaches the border.
- Produces: `_dedupePoints(pts, tol)` → `Array<{x,y}>` — drops near-coincident points (shared polygon vertices hit from two segments).

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/unit/test-ai-caption-seat.jsx` (before the `--- SUMMARY ---` block):

```javascript
// --- _circlePolyIntersections (exact circle ∩ border) --------------------------
testLog("[ai-seat-test] --- _circlePolyIntersections ---");

// SQUARE [0,100]^2. Center on the bottom edge, radius 50 -> hits the two bottom corners.
var ci1 = _circlePolyIntersections({x:50, y:0}, 50, SQUARE);
assert("circle r50 on bottom edge -> 2 hits", ci1.length, 2);

// Radius 100 from (50,0): left edge (0,~86.6), right edge (100,~86.6), tangent top (50,100).
var ci2 = _circlePolyIntersections({x:50, y:0}, 100, SQUARE);
assert("circle r100 -> 3 hits", ci2.length, 3);

// Radius 10 from (50,0): stays inside the square, never reaches an edge except the bottom it
// sits on — (40,0) and (60,0).
var ci3 = _circlePolyIntersections({x:50, y:0}, 10, SQUARE);
assert("circle r10 -> 2 hits on bottom", ci3.length, 2);

// A circle far too small to reach a raised border line -> 0 hits.
var LINE = [[ {x:-100,y:20}, {x:100,y:20} ]];
var ci4 = _circlePolyIntersections({x:0, y:0}, 10, LINE);
assert("circle can't reach border -> 0 hits", ci4.length, 0);

// _dedupePoints collapses coincident points.
var dd = _dedupePoints([{x:1,y:1},{x:1,y:1},{x:2,y:2}], 1e-4);
assert("dedupe 3 -> 2", dd.length, 2);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/integration/unit/run-test-ai-caption-seat.sh` (Illustrator must be running)
Expected: FAIL — `_circlePolyIntersections is not defined` / new asserts fail.

- [ ] **Step 3: Implement the helpers**

Add to `utils/aiUtils.jsx` immediately after `_aiKissVector` (~line 1914):

```javascript
// Drops near-coincident points (a shared polygon vertex is hit from both adjacent segments).
// Pure geometry.
function _dedupePoints(pts, tol) {
    if (tol === undefined) tol = 1e-4;
    var out = [], i, jj, dup;
    for (i = 0; i < pts.length; i++) {
        dup = false;
        for (jj = 0; jj < out.length; jj++) {
            if (Math.abs(pts[i].x - out[jj].x) <= tol && Math.abs(pts[i].y - out[jj].y) <= tol) {
                dup = true; break;
            }
        }
        if (!dup) out.push(pts[i]);
    }
    return out;
}

// Every point where the circle of radius L centered at P crosses a segment of the sampled border
// polygons. Solves |p1 + t*(p2-p1) - P|^2 = L^2 per segment, keeping roots with t in [0,1].
// Returns a deduped array of {x,y}; empty when the circle never reaches the border. Pure geometry.
function _circlePolyIntersections(P, L, polys) {
    var out = [], ai, A, i, j, p1, p2, k;
    var L2 = L * L, eps = 1e-9;
    for (ai = 0; ai < polys.length; ai++) {
        A = polys[ai];
        for (i = 0, j = A.length - 1; i < A.length; j = i++) {
            p1 = A[j]; p2 = A[i];
            var dx = p2.x - p1.x, dy = p2.y - p1.y;
            var fx = p1.x - P.x, fy = p1.y - P.y;
            var a = dx * dx + dy * dy;
            if (a < eps) continue;                                   // degenerate segment
            var b = 2 * (fx * dx + fy * dy);
            var c = fx * fx + fy * fy - L2;
            var disc = b * b - 4 * a * c;
            if (disc < -eps) continue;                               // no real intersection
            if (disc < 0) disc = 0;
            var sq = Math.sqrt(disc);
            var roots = [(-b - sq) / (2 * a), (-b + sq) / (2 * a)];
            for (k = 0; k < 2; k++) {
                var t = roots[k];
                if (t < -1e-6 || t > 1 + 1e-6) continue;             // outside the segment
                out.push({ x: p1.x + t * dx, y: p1.y + t * dy });
            }
        }
    }
    return _dedupePoints(out, 1e-4);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `tests/integration/unit/run-test-ai-caption-seat.sh`
Expected: PASS — `PASS [ai-caption-seat-unit]`, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add utils/aiUtils.jsx tests/integration/unit/test-ai-caption-seat.jsx
git commit -m "feat(seat): add circle-border intersection helper for two-point contact

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Pure helpers — near-endpoint pick + contact rotation

**Files:**
- Modify: `utils/aiUtils.jsx` (add `_seatNearEndpoint` + `_seatContactRotation` after `_circlePolyIntersections`)
- Test: `tests/integration/unit/test-ai-caption-seat.jsx` (append a section)

**Interfaces:**
- Consumes: `_circlePolyIntersections` (Task 1), `_aiChordAngleDeg`, `_aiNormalizeDeg` (existing).
- Produces: `_seatNearEndpoint(E0, B0, E1, B1, geom)` → `{ P, Bp, Q, Bq }` — `P`/`Bp` is the endpoint+border pair reached with the least forward travel toward the art; `Q`/`Bq` is the other.
- Produces: `_seatContactRotation(P, Q, polys, maxRot)` → `{ ok, deg, needsReview, clamped, reason }` — the smallest-magnitude rotation (deg, CCW-positive in y-up) about `P` that lands `Q` on the border. `ok:false` = far endpoint can't reach (`reason` set). `clamped:true` = smallest solution exceeds `maxRot` (deg forced to 0, `needsReview:true`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/unit/test-ai-caption-seat.jsx`:

```javascript
// --- _seatNearEndpoint (which endpoint reaches the border first) ---------------
testLog("[ai-seat-test] --- _seatNearEndpoint ---");
// gBelow: travelIsX=false, sign=+1. E0 gap to border = 5, E1 gap = 8 -> E0 is nearer.
var pick = _seatNearEndpoint({x:0,y:0}, {x:0,y:5}, {x:10,y:0}, {x:10,y:8}, gBelow);
assertPt("near endpoint P = E0", pick.P, 0, 0);
assertPt("far endpoint Q = E1", pick.Q, 10, 0);

// --- _seatContactRotation (rotate P->Q chord until Q lands on the border) -------
testLog("[ai-seat-test] --- _seatContactRotation ---");
// P at origin, Q at (10,0) (chord length 10). Border = horizontal line y=6.
// Circle r10 about origin hits y=6 at x=+-8: (8,6) at +36.87deg, (-8,6) at +143.13deg.
// Smallest rotation from Q (angle 0) is +36.87deg.
var LINE6 = [[ {x:-100,y:6}, {x:100,y:6} ]];
var rc = _seatContactRotation({x:0,y:0}, {x:10,y:0}, LINE6, 75);
assert("contact rotation ok", rc.ok, true);
assert("contact rotation not clamped", rc.clamped, false);
assertClose("contact rotation +36.87deg", rc.deg, 36.8698976, 1e-3);

// Same geometry, tight maxRot -> clamped, flagged, deg 0.
var rcClamp = _seatContactRotation({x:0,y:0}, {x:10,y:0}, LINE6, 30);
assert("contact rotation clamped", rcClamp.clamped, true);
assert("contact rotation clamp needsReview", rcClamp.needsReview, true);
assertClose("contact rotation clamped deg 0", rcClamp.deg, 0);

// Border too far for the chord to reach -> ok:false (overhang).
var LINE20 = [[ {x:-100,y:20}, {x:100,y:20} ]];
var rcNo = _seatContactRotation({x:0,y:0}, {x:10,y:0}, LINE20, 75);
assert("contact rotation unreachable -> ok false", rcNo.ok, false);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `tests/integration/unit/run-test-ai-caption-seat.sh`
Expected: FAIL — `_seatNearEndpoint is not defined` / new asserts fail.

- [ ] **Step 3: Implement the helpers**

Add to `utils/aiUtils.jsx` after `_circlePolyIntersections`:

```javascript
// Of the two inner-edge endpoints, the one that reaches its border point with the LEAST forward
// travel toward the art (smallest signed gap). That one is translated onto the border first; the
// other is then rotated down onto the border. geom = { travelIsX, sign } (plate -> art). Both
// border points are non-null here (overhang is handled upstream). Pure geometry.
function _seatNearEndpoint(E0, B0, E1, B1, geom) {
    function gap(E, B) {
        return geom.sign * (geom.travelIsX ? (B.x - E.x) : (B.y - E.y));
    }
    if (gap(E0, B0) <= gap(E1, B1)) return { P: E0, Bp: B0, Q: E1, Bq: B1 };
    return { P: E1, Bp: B1, Q: E0, Bq: B0 };
}

// The smallest-magnitude rotation about the (already on-border) near endpoint P that lands the far
// endpoint Q on the border. Q is rigidly at distance L=|P-Q| from P, so its target is where the
// circle of radius L about P meets the border. deg is CCW-positive in AI's y-up space (feeds
// _rotateItemsAbout directly). Pure geometry.
function _seatContactRotation(P, Q, polys, maxRot) {
    var L = Math.sqrt((Q.x - P.x) * (Q.x - P.x) + (Q.y - P.y) * (Q.y - P.y));
    if (L < 1e-6) return { ok: false, reason: "degenerate chord" };
    var hits = _circlePolyIntersections(P, L, polys);
    if (!hits.length) return { ok: false, reason: "far endpoint cannot reach border" };
    var qAng = _aiChordAngleDeg(P, Q);
    var best = 0, bestAbs = 1e18, i, d;
    for (i = 0; i < hits.length; i++) {
        d = _aiNormalizeDeg(_aiChordAngleDeg(P, hits[i]) - qAng);
        if (Math.abs(d) < bestAbs) { bestAbs = Math.abs(d); best = d; }
    }
    if (bestAbs > maxRot) return { ok: true, deg: 0, needsReview: true, clamped: true };
    return { ok: true, deg: best, needsReview: false, clamped: false };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `tests/integration/unit/run-test-ai-caption-seat.sh`
Expected: PASS — 0 failed.

- [ ] **Step 5: Commit**

```bash
git add utils/aiUtils.jsx tests/integration/unit/test-ai-caption-seat.jsx
git commit -m "feat(seat): add near-endpoint pick + contact-rotation solver

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Rewrite the caption branch + wire the caption embed knob

**Files:**
- Modify: `utils/aiUtils.jsx` — replace the shared rotate+kiss+return block (`aiUtils.jsx:1738`–1776) with a tab/caption split; add `overlapPt` to the caption seat call in `buildCaption` (`aiUtils.jsx:1353`)
- Modify: `illustrator/Step8b_CaptionNormalise.jsx:143` — pass the same `overlapPt`
- Modify: `pipelines/AI_BuildCutlines.jsx`, `pipelines/AI_NormaliseCaptions.jsx`, `pipelines/AI_BuildAndExportCutlines.jsx` — add `captionSeatOverlapMm: 0`
- Test: existing pure unit tests (Tasks 1–2) must still pass; the full DOM function is validated live in Task 4.

**Interfaces:**
- Consumes: `_seatNearEndpoint`, `_seatContactRotation` (Task 2), `_aiKissVector`, `_translateItems`, `_rotateItemsAbout` (existing).
- Produces: `seatPlateToOutline` unchanged signature/return; caption branch now does two-point contact. `CONFIG.captionSeatOverlapMm` (mm, default 0) is the caption embed past contact.

- [ ] **Step 1: Replace the shared rotate+kiss+return block**

In `utils/aiUtils.jsx`, replace the block from `    // ── ROTATE:` (line ~1738) through the final `             rotDeg: rotDeg, needsReview: needsReview };` (line ~1776) with:

```javascript
    var rotDeg = 0;

    if (travelDir) {
        // ── TAB (unchanged): rotate the inner edge parallel to the art chord (pivot E0), then
        // kiss E0 onto B0 along the tab's travel direction, submerged by depth. ──
        if (CONFIG.seatConform && !kissOnly) {
            var baseLen = Math.sqrt((E1.x - E0.x) * (E1.x - E0.x) + (E1.y - E0.y) * (E1.y - E0.y));
            if (baseLen >= epsPt) {
                var phi = _aiNormalizeDeg(_aiChordAngleDeg(B0, B1) - _aiChordAngleDeg(E0, E1));
                if (Math.abs(phi) <= maxRot) {
                    _rotateItemsAbout(items, E0, rotSign * phi);
                    rotDeg = phi;
                    log("[seat] " + name + " | rotated " + phi.toFixed(1) + "deg to endpoint chord.");
                } else {
                    needsReview = true;
                    log("[seat] " + name + " | chord tilt " + phi.toFixed(1)
                        + "deg exceeds maxSeatRotationDeg — rotation skipped, flagged.");
                }
            }
        }
        var kt = _aiKissVectorDir(E0, B0, travelDir, depth);
        _translateItems(items, kt.tx, kt.ty);
        log("[seat] " + name + " | seated (tab) rot=" + _r1(rotDeg) + "deg move="
            + _r1(Math.sqrt(kt.tx * kt.tx + kt.ty * kt.ty)) + "pt depth=" + _r1(depth) + "pt"
            + (needsReview ? " (needsReview)" : ""));
        return { ok: true, moved: Math.sqrt(kt.tx * kt.tx + kt.ty * kt.ty),
                 rotDeg: rotDeg, needsReview: needsReview };
    }

    // ── CAPTION (two-point contact): translate the NEARER inner-edge endpoint onto the border
    // (depth 0), then ROTATE about it until the FAR endpoint also lands on the border (exact
    // circle∩border solve). Both endpoints end exactly on the traced border — no stale-probe
    // float, no over-burial. See docs/superpowers/specs/2026-07-21-caption-seat-two-point-contact-design.md. ──
    var pick = _seatNearEndpoint(E0, B0, E1, B1, geom);

    // Step A — near endpoint onto its border point (depth 0).
    var kA = _aiKissVector(pick.P, pick.Bp, geom, 0);
    _translateItems(items, kA.tx, kA.ty);
    var Pm = { x: pick.P.x + kA.tx, y: pick.P.y + kA.ty };
    var Qm = { x: pick.Q.x + kA.tx, y: pick.Q.y + kA.ty };

    // Step B — rotate about the seated near endpoint until the far endpoint touches the border.
    if (CONFIG.seatConform && !kissOnly) {
        var rot = _seatContactRotation(Pm, Qm, artPolys, maxRot);
        if (!rot.ok) {
            needsReview = true;
            log("[seat] " + name + " | far endpoint can't reach the border (" + rot.reason
                + ") — contact rotation skipped, flagged.");
        } else if (rot.clamped) {
            needsReview = true;
            log("[seat] " + name + " | contact rotation exceeds maxSeatRotationDeg — skipped, flagged.");
        } else if (Math.abs(rot.deg) >= 0.01) {
            _rotateItemsAbout(items, Pm, rot.deg);
            rotDeg = rot.deg;
            log("[seat] " + name + " | rotated " + rot.deg.toFixed(1) + "deg to two-point contact.");
        }
    }

    // Step C — optional embed past contact (depth 0 by default → pure tangent contact).
    if (depth > 1e-6) {
        var eC = geom.travelIsX ? { tx: geom.sign * depth, ty: 0 }
                                : { tx: 0, ty: geom.sign * depth };
        _translateItems(items, eC.tx, eC.ty);
    }

    if (CONFIG.seatDebug) {
        log("[seatdbg] " + name + " | axisX=" + geom.travelIsX + " sign=" + geom.sign
            + " depth=" + _r1(depth) + " r=" + _r1(r) + " kissOnly=" + kissOnly
            + " shrunk=" + shrunk + " rot=" + _r1(rotDeg)
            + " P=(" + _r1(Pm.x) + "," + _r1(Pm.y) + ")");
    }
    log("[seat] " + name + " | seated (contact) rot=" + _r1(rotDeg) + "deg move="
        + _r1(Math.sqrt(kA.tx * kA.tx + kA.ty * kA.ty)) + "pt depth=" + _r1(depth) + "pt"
        + (needsReview ? " (needsReview)" : ""));
    return { ok: true, moved: Math.sqrt(kA.tx * kA.tx + kA.ty * kA.ty),
             rotDeg: rotDeg, needsReview: needsReview };
```

- [ ] **Step 2: Wire the caption embed knob into the two caption call sites**

In `utils/aiUtils.jsx:1353`, change:

```javascript
    var seat = seatPlateToOutline(name, outline, pill, rideItem, { polyCache: {} });
```
to:
```javascript
    var _capOverlap = (CONFIG.captionSeatOverlapMm != null) ? CONFIG.captionSeatOverlapMm : 0;
    var seat = seatPlateToOutline(name, outline, pill, rideItem,
        { polyCache: {}, overlapPt: mmToPoints(_capOverlap) });
```

In `illustrator/Step8b_CaptionNormalise.jsx:143`, change:

```javascript
        var seat = seatPlateToOutline(group.name, outline, pill, rideItem, { polyCache: polyCache });
```
to:
```javascript
        var _capOverlap = (CONFIG.captionSeatOverlapMm != null) ? CONFIG.captionSeatOverlapMm : 0;
        var seat = seatPlateToOutline(group.name, outline, pill, rideItem,
            { polyCache: polyCache, overlapPt: mmToPoints(_capOverlap) });
```

- [ ] **Step 3: Add the knob to the three caption pipeline CONFIGs**

In each of `pipelines/AI_BuildCutlines.jsx`, `pipelines/AI_NormaliseCaptions.jsx`, `pipelines/AI_BuildAndExportCutlines.jsx`, add directly below the existing `seatOverlapMm:` line:

```javascript
    captionSeatOverlapMm: 0,     // caption embed PAST two-point contact (mm). 0 = endpoints exactly
                                 // on the border. Raise to a hair (e.g. 0.1) only if a concave base
                                 // pinches the Unite. Separate from seatOverlapMm (the TAB embed).
```

- [ ] **Step 4: Syntax-check + run the pure unit tests**

Run: `osascript -e 'tell application "Adobe Illustrator" to do javascript file "'"$PWD"'/tests/integration/unit/test-ai-caption-seat.jsx"'`
(or the runner) — confirms `aiUtils.jsx` still parses (the test `#include`s it) and Tasks 1–2 helpers still pass.
Run: `tests/integration/unit/run-test-ai-caption-seat.sh`
Expected: PASS — 0 failed. (The rewritten caption branch is not exercised headless; its geometry is covered by Tasks 1–2 and validated live in Task 4.)

- [ ] **Step 5: Commit**

```bash
git add utils/aiUtils.jsx illustrator/Step8b_CaptionNormalise.jsx \
        pipelines/AI_BuildCutlines.jsx pipelines/AI_NormaliseCaptions.jsx \
        pipelines/AI_BuildAndExportCutlines.jsx
git commit -m "feat(seat): two-point contact caption seat (replace rotate-then-kiss)

Caption endpoints now land exactly on the traced border: translate nearest
endpoint to contact (depth 0), then rotate about it until the far endpoint
touches (exact circle-border solve). Removes the junction bump. Tab branch
unchanged. Caption embed default 0 via captionSeatOverlapMm.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Live validation, integration goldens, docs

**Files:**
- Verify: `tests/integration/ai-build-and-export-cutlines/run.sh`, `tests/integration/ai-normalise-captions/run.sh` (+ their `expected.txt` goldens)
- Modify (docs): `CLAUDE.md` seating banner note; add a memory entry per the memory protocol
- No code changes expected in this task (only golden regen if diffs are seat-log-only and reviewed)

**Interfaces:**
- Consumes: the seat rewrite from Task 3.

- [ ] **Step 1: Live-validate in Illustrator (authoritative)**

Run Pipeline 2 in-app on a fixture that has a **flat** base, a **curved/round** base, and a **tilted** base. Use the osascript entry point (see `run-ai-caption-seat.sh` for the invocation pattern). Confirm in the log:
- `[seat] … seated (contact) …` lines for captioned elements (not `(tab)`), no `far endpoint can't reach` unless genuinely overhanging.
- Then eyeball at high zoom: **flat base → no bump, top edge flush on the border**; tilted base → both endpoints sit on the border; curved base → both endpoints on the border (mid gap acceptable, unmanaged by design).
- Concave base check: confirm the Unite fuses into one clean contour. If it pinches, set `captionSeatOverlapMm: 0.1` in the caption CONFIGs and re-validate (this is the documented escape hatch, not a bug).

Record the outcome (which bases tested, pass/fail, any `captionSeatOverlapMm` change) in the commit message and memory.

- [ ] **Step 2: Run the caption integration runners**

Run: `tests/integration/ai-normalise-captions/run.sh`
Run: `tests/integration/ai-build-and-export-cutlines/run.sh`
Expected: functional assertions pass (named/unmatched counts, SVGs). Seat-log golden lines will differ (new `(contact)` wording, new rot values).

- [ ] **Step 3: Review and regenerate goldens**

Diff each runner's log against its `expected.txt`. Confirm every diff is a **seat-log line change** (wording/rotation), not a structural regression (element count, unmatched, SVG presence). Only then regenerate the golden per the runner's documented regen step, and re-run twice to confirm determinism (per test-fixture discipline).

- [ ] **Step 4: Run the half-cut alignment regression**

Run: `tests/integration/unit/run-ai-halfcut-alignment.sh`
Expected: PASS — the half-cut still projects onto the cut line derived from the newly-seated pose (the seat change moves endpoints onto the border, which the seam tracer follows).

- [ ] **Step 5: Update docs + memory, then commit**

- In `CLAUDE.md`, update the caption-seating bullet in the top banner to note the seat is now **two-point contact** (translate-nearest + rotate-until-far-touches, endpoints exactly on the border, `captionSeatOverlapMm` default 0), superseding the "analytic capsule seat / pin-E0 rotate-by-chord + depth-d kiss" description.
- Add a memory file under the memory dir summarizing the change + live-validation outcome, and a one-line pointer in `MEMORY.md` (link `[[caption_vector_seat]]`).

```bash
git add tests/ CLAUDE.md
git commit -m "test(seat): regenerate caption goldens + validate two-point contact live

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- New order (probe → translate nearest to contact → rotate via circle∩border → depth-0) → Tasks 1–3. ✓
- Overhang / 15% shrink kept → unchanged upstream block (steps 1–5 of the seat); far-point unreachable routes to `needsReview` in Task 3 Step B. ✓
- Contact depth 0 → `captionSeatOverlapMm: 0` (Task 3). ✓
- Axis-aligned translate (decision #3) → Step A uses `_aiKissVector` (travel-axis). ✓
- Middle unmanaged (decision #4) → only the two endpoints are pinned. ✓
- `seatOverlapMm` kept as knob → tab embed untouched; caption uses the separate `captionSeatOverlapMm`. **Deviation from the spec's "reuse one knob": a separate caption knob is used to avoid regressing the tab branch (which shares `seatOverlapMm`). Flag for the user.** ✓
- 0/2/≥3 circle-hit dispositions → `_seatContactRotation` (smallest rotation; clamp→flag; none→ok:false). ✓
- Depth-0 Unite fusion risk → Task 4 Step 1 concave check + escape hatch. ✓
- Idempotency (Step 8b re-seat) → both endpoints already on border → ~0 translate + ~0 rotation; covered by Task 4 integration run. ✓

**Placeholder scan:** no TBD/TODO; every code step shows full code; every test step shows asserts + expected runner output. ✓

**Type consistency:** `_seatNearEndpoint` returns `{P,Bp,Q,Bq}` — consumed as `pick.P/pick.Bp/pick.Q` in Task 3. `_seatContactRotation` returns `{ok,deg,needsReview,clamped,reason}` — consumed as `rot.ok/rot.clamped/rot.deg/rot.reason`. `_circlePolyIntersections(P,L,polys)` — called by `_seatContactRotation` with `(P,L,polys)`. `mmToPoints`/`CONFIG.captionSeatOverlapMm` consistent across both caption call sites. ✓
