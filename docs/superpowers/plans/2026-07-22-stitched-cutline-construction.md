# Stitched Cutline Construction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the boolean `deriveCutline` with a construction that traces the outer boundary of (art ∪ caption) from the two junction crossings, so touch-only seats join with no embed and no junction slivers form.

**Architecture:** The risky geometry is pure and node-tested on plain cubic-segment arrays: de Casteljau split, crossing→(segment,t) mapping, two-outermost selection, and the arc-select-and-splice into one closed loop. A thin Illustrator glue layer converts a `PathItem` to/from that cubic model and rewrites `deriveCutline` to call the pure stitch. The boolean and the entire sliver-removal machinery are removed.

**Tech Stack:** ExtendScript (ES3) for Illustrator; Node.js (no framework) for pure-geometry unit tests; bash + osascript for live integration.

## Global Constraints

- **ES3 only** in `utils/aiUtils.jsx`: no `let`/`const`, no arrow functions, no template literals. Match surrounding style.
- `utils/aiUtils.jsx` has no `#target`/`CONFIG`/`main`; `CONFIG` and `log` are runtime globals — guard `CONFIG` with `typeof CONFIG !== "undefined"`.
- **Cubic-segment model** (the shared pure data type): a segment is `{ p0:[x,y], c1:[x,y], c2:[x,y], p3:[x,y] }` (cubic Bézier control points). A closed path is an array of segments where `seg[i].p3` equals `seg[i+1].p0` and `last.p3` equals `first.p0`.
- **Bézier ↔ DOM mapping** (Illustrator `PathItem.pathPoints`): for point `i`, `.anchor` = on-curve point, `.rightDirection` = outgoing handle, `.leftDirection` = incoming handle. Segment `i→i+1` = `(A[i], R[i], L[i+1], A[i+1])` = `(p0, c1, c2, p3)`. A straight segment has `c1==p0` and `c2==p3`.
- **Two-point-contact seat is honored:** `captionSeatOverlapMm` stays `0`. Do not add an embed.
- **Hard error, no fallback:** fewer than two usable crossings → failure surfaced to the caller; the boolean is removed, so there is nothing to fall back to.
- **Reuse, do not reimplement:** `samplePathToPolygons`, `_largestPoly`, `_pointInPolysEO`, `pointInPolygon`, `_segCrossArt`, `_aiSeatGeometry`, `_bezierPoint`.
- Node unit tests: read `utils/aiUtils.jsx` as text, regex-`extract` each function, `eval`, test on plain arrays. Model on `tests/integration/unit/test-halfcut-tail-dir.js`.
- aiUtils log prefix for construction lines: `[cutline]`.

---

### Task 1: de Casteljau cubic split (`_splitCubic`) — pure, node TDD

**Files:**
- Modify: `utils/aiUtils.jsx` (add `_splitCubic` near `_bezierPoint`, ~line 3249)
- Test: `tests/integration/unit/test-stitch-splitcubic.js` (create)
- Runner: `tests/integration/unit/run-test-stitch-splitcubic.sh` (create)

**Interfaces:**
- Produces: `_splitCubic(seg, t) -> { left, right }` where `seg`/`left`/`right` are cubic segments `{p0,c1,c2,p3}` (each control point `[x,y]`). `left` covers `[0,t]`, `right` covers `[t,1]`; `left.p3 === right.p0` is the split point. Pure.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/unit/test-stitch-splitcubic.js`:

```javascript
// Pure-geometry unit test for _splitCubic (de Casteljau) in aiUtils.jsx.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name){var re=new RegExp('function '+name+'\\s*\\([\\s\\S]*?\\n}');var m=src.match(re);if(!m)throw new Error('could not extract '+name);return m[0];}
eval(extract('_bezierPoint'));
eval(extract('_splitCubic'));

var fails=0;
function check(c,m){if(!c){console.log('FAIL: '+m);fails++;}}
function near(a,b){return Math.abs(a-b)<1e-6;}
function ptNear(p,q,msg){check(near(p[0],q[0])&&near(p[1],q[1]),msg+' got ['+p+'] want ['+q+']');}

// Straight segment (0,0)->(9,0): split at t=1/3 -> point (3,0); halves stay straight.
(function(){
  var seg={p0:[0,0],c1:[3,0],c2:[6,0],p3:[9,0]};
  var s=_splitCubic(seg,1/3);
  ptNear(s.left.p0,[0,0],'left.p0'); ptNear(s.left.p3,[3,0],'left.p3 = split point');
  ptNear(s.right.p0,[3,0],'right.p0 = split point'); ptNear(s.right.p3,[9,0],'right.p3');
})();

// Split point must equal _bezierPoint at t for a curved segment.
(function(){
  var seg={p0:[0,0],c1:[0,10],c2:[10,10],p3:[10,0]};
  var t=0.4, bp=_bezierPoint(seg.p0,seg.c1,seg.c2,seg.p3,t);
  var s=_splitCubic(seg,t);
  ptNear(s.left.p3,[bp.x,bp.y],'split point == _bezierPoint(t)');
  ptNear(s.right.p0,[bp.x,bp.y],'right.p0 == split point');
})();

if(fails===0)console.log('PASS: splitcubic'); else {console.log(fails+' FAIL');process.exit(1);}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/integration/unit/test-stitch-splitcubic.js`
Expected: `Error: could not extract _splitCubic`.

- [ ] **Step 3: Implement**

In `utils/aiUtils.jsx`, immediately AFTER `function _bezierPoint(...) {...}` (~line 3258), add:

```javascript
// de Casteljau split of a cubic segment {p0,c1,c2,p3} at parameter t in [0,1].
// Returns { left, right } cubic segments; left covers [0,t], right covers [t,1], sharing the
// split point (left.p3 === right.p0). Pure — [x,y] arrays only.
function _splitCubic(seg, t) {
    function lerp(a, b, u) { return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; }
    var p0 = seg.p0, c1 = seg.c1, c2 = seg.c2, p3 = seg.p3;
    var a = lerp(p0, c1, t), b = lerp(c1, c2, t), c = lerp(c2, p3, t);
    var d = lerp(a, b, t), e = lerp(b, c, t);
    var f = lerp(d, e, t);
    return { left:  { p0: p0, c1: a, c2: d, p3: f },
             right: { p0: f,  c1: e, c2: c, p3: p3 } };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/integration/unit/test-stitch-splitcubic.js`
Expected: `PASS: splitcubic`

- [ ] **Step 5: Create runner + commit**

Create `tests/integration/unit/run-test-stitch-splitcubic.sh`:

```bash
#!/bin/bash
set -euo pipefail
STEP="stitch-splitcubic-unit"; DIR="$(cd "$(dirname "$0")" && pwd)"
echo "[$STEP] Running _splitCubic unit tests (node)..."
if ! command -v node >/dev/null 2>&1; then echo "SKIP [$STEP]: node not found."; exit 0; fi
if node "$DIR/test-stitch-splitcubic.js"; then echo "PASS [$STEP]"; exit 0; else echo "FAIL [$STEP]"; exit 1; fi
```

Then:
```bash
chmod +x tests/integration/unit/run-test-stitch-splitcubic.sh
git add utils/aiUtils.jsx tests/integration/unit/test-stitch-splitcubic.js tests/integration/unit/run-test-stitch-splitcubic.sh
git commit -m "feat(cutline): _splitCubic — de Casteljau cubic split (pure)"
```

---

### Task 2: Crossings between two cubic paths, mapped to (segment,t) + two outermost (`_cubicCrossings`, `_twoOutermost`) — pure, node TDD

**Files:**
- Modify: `utils/aiUtils.jsx` (add near `_splitCubic`)
- Test: `tests/integration/unit/test-stitch-crossings.js` (create)
- Runner: `tests/integration/unit/run-test-stitch-crossings.sh` (create)

**Interfaces:**
- Consumes: `_bezierPoint` (Task 0/existing).
- Produces:
  - `_segSegIntersect(p1,p2,p3,p4) -> {x,y,tA,tB} | null` — intersection of segments p1p2 and p3p4; `tA`/`tB` are the parametric positions on each. Pure.
  - `_cubicCrossings(pathA, pathB, steps) -> [{ x, y, aIdx, aT, bIdx, bT }]` — each place path A crosses path B, with the cubic index and in-cubic parameter on each path. `pathA`/`pathB` are arrays of cubic segments; `steps` = samples per cubic. Pure.
  - `_twoOutermost(crossings) -> { c0, c1 }` — the two crossings farthest apart (Euclidean), `c0`/`c1` are elements of the input. Pure.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/unit/test-stitch-crossings.js`:

```javascript
// Pure-geometry unit test for _segSegIntersect / _cubicCrossings / _twoOutermost in aiUtils.jsx.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name){var re=new RegExp('function '+name+'\\s*\\([\\s\\S]*?\\n}');var m=src.match(re);if(!m)throw new Error('could not extract '+name);return m[0];}
eval(extract('_bezierPoint'));
eval(extract('_segSegIntersect'));
eval(extract('_cubicCrossings'));
eval(extract('_twoOutermost'));

var fails=0;
function check(c,m){if(!c){console.log('FAIL: '+m);fails++;}}
function near(a,b,e){return Math.abs(a-b)<(e||1e-4);}

// straight-cubic helper: cubic that is the straight segment a->b
function seg(a,b){return {p0:a,c1:[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],c2:[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],p3:b};}

// _segSegIntersect: a '+' crossing at origin.
(function(){
  var r=_segSegIntersect([-1,0],[1,0],[0,-1],[0,1]);
  check(r&&near(r.x,0)&&near(r.y,0),'segseg crosses at origin (got '+JSON.stringify(r)+')');
  check(_segSegIntersect([0,0],[1,0],[0,1],[1,1])===null,'parallel/no-cross -> null');
})();

// _cubicCrossings: A is a horizontal line y=0 from x=-2..2 (as 1 straight cubic);
// B is a "V" that dips below and crosses A twice (two straight cubics).
(function(){
  var A=[seg([-2,0],[2,0])];
  var B=[seg([-1,1],[0,-1]), seg([0,-1],[1,1])];
  var cr=_cubicCrossings(A,B,20);
  check(cr.length===2,'two crossings found (got '+cr.length+')');
  // crossings near x=-0.5 and x=0.5, y=0
  var xs=[cr[0].x,cr[1].x].sort(function(a,b){return a-b;});
  check(near(xs[0],-0.5,0.05)&&near(xs[1],0.5,0.05),'crossings near x=-0.5,0.5 (got '+xs+')');
  check(cr[0].aIdx===0&&cr[1].aIdx===0,'both on A cubic 0');
})();

// _twoOutermost: pick the farthest-apart pair.
(function(){
  var cs=[{x:0,y:0},{x:1,y:0},{x:10,y:0}];
  var r=_twoOutermost(cs);
  var pair=[r.c0.x,r.c1.x].sort(function(a,b){return a-b;});
  check(pair[0]===0&&pair[1]===10,'outermost = 0 and 10 (got '+pair+')');
})();

if(fails===0)console.log('PASS: crossings'); else {console.log(fails+' FAIL');process.exit(1);}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/integration/unit/test-stitch-crossings.js`
Expected: `Error: could not extract _segSegIntersect`.

- [ ] **Step 3: Implement**

In `utils/aiUtils.jsx`, after `_splitCubic`, add:

```javascript
// Intersection of segment p1p2 with p3p4. Returns { x, y, tA, tB } (tA on p1p2, tB on p3p4,
// both in [0,1]) or null if they do not cross within both segments. Pure.
function _segSegIntersect(p1, p2, p3, p4) {
    var r0 = p2[0] - p1[0], r1 = p2[1] - p1[1];
    var s0 = p4[0] - p3[0], s1 = p4[1] - p3[1];
    var denom = r0 * s1 - r1 * s0;
    if (denom === 0) return null;                       // parallel
    var qp0 = p3[0] - p1[0], qp1 = p3[1] - p1[1];
    var tA = (qp0 * s1 - qp1 * s0) / denom;
    var tB = (qp0 * r1 - qp1 * r0) / denom;
    if (tA < 0 || tA > 1 || tB < 0 || tB > 1) return null;
    return { x: p1[0] + tA * r0, y: p1[1] + tA * r1, tA: tA, tB: tB };
}

// Sample a cubic path to a polyline, tagging each vertex with its cubic index and in-cubic t.
// Returns [{ x, y, idx, t }]. Pure. (Local helper for _cubicCrossings.)
function _cubicPolyline(path, steps) {
    var out = [], i, j, s, bp, t;
    for (i = 0; i < path.length; i++) {
        s = path[i];
        for (j = 0; j < steps; j++) {
            t = j / steps;
            bp = _bezierPoint(s.p0, s.c1, s.c2, s.p3, t);
            out.push({ x: bp.x, y: bp.y, idx: i, t: t });
        }
    }
    // close: last vertex = start of path
    out.push({ x: path[0].p0[0], y: path[0].p0[1], idx: 0, t: 0 });
    return out;
}

// Every place cubic path A crosses cubic path B. Returns [{ x, y, aIdx, aT, bIdx, bT }], where
// aIdx/aT locate the crossing on A (cubic index + in-cubic parameter) and bIdx/bT on B. Beziers
// are sampled to `steps` chords per cubic; the in-cubic t is interpolated across the chord. Pure.
function _cubicCrossings(pathA, pathB, steps) {
    var pa = _cubicPolyline(pathA, steps), pb = _cubicPolyline(pathB, steps);
    var out = [], i, j, hit;
    for (i = 0; i + 1 < pa.length; i++) {
        for (j = 0; j + 1 < pb.length; j++) {
            hit = _segSegIntersect([pa[i].x, pa[i].y], [pa[i + 1].x, pa[i + 1].y],
                                   [pb[j].x, pb[j].y], [pb[j + 1].x, pb[j + 1].y]);
            if (!hit) continue;
            // Only count a crossing at the START vertex's cubic to avoid double counting shared
            // endpoints; interpolate in-cubic t across this chord (1/steps of a cubic per chord).
            var aStep = 1 / steps, bStep = 1 / steps;
            out.push({ x: hit.x, y: hit.y,
                       aIdx: pa[i].idx, aT: pa[i].t + hit.tA * aStep,
                       bIdx: pb[j].idx, bT: pb[j].t + hit.tB * bStep });
        }
    }
    return out;
}

// The two crossings farthest apart (Euclidean). Returns { c0, c1 } (input elements). Pure.
function _twoOutermost(crossings) {
    var m = crossings.length, bi = 0, bj = (m > 1 ? 1 : 0), best = -1, i, j, dx, dy, d;
    for (i = 0; i < m; i++) {
        for (j = i + 1; j < m; j++) {
            dx = crossings[i].x - crossings[j].x; dy = crossings[i].y - crossings[j].y;
            d = dx * dx + dy * dy;
            if (d > best) { best = d; bi = i; bj = j; }
        }
    }
    return { c0: crossings[bi], c1: crossings[bj] };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/integration/unit/test-stitch-crossings.js`
Expected: `PASS: crossings`

- [ ] **Step 5: Runner + commit**

Create `tests/integration/unit/run-test-stitch-crossings.sh` (same shape as Task 1's runner, `STEP="stitch-crossings-unit"`, running `test-stitch-crossings.js`), then:
```bash
chmod +x tests/integration/unit/run-test-stitch-crossings.sh
git add utils/aiUtils.jsx tests/integration/unit/test-stitch-crossings.js tests/integration/unit/run-test-stitch-crossings.sh
git commit -m "feat(cutline): _cubicCrossings + _twoOutermost + _segSegIntersect (pure)"
```

---

### Task 3: Arc extraction and stitch into one closed loop (`_arcBetween`, `_stitchUnionLoop`) — pure, node TDD

**Files:**
- Modify: `utils/aiUtils.jsx` (after Task 2's functions)
- Test: `tests/integration/unit/test-stitch-loop.js` (create)
- Runner: `tests/integration/unit/run-test-stitch-loop.sh` (create)

**Interfaces:**
- Consumes: `_splitCubic`, `_bezierPoint`, `pointInPolygon`.
- Produces:
  - `_arcBetween(path, i0, t0, i1, t1) -> [segments]` — the run of cubics from `(i0,t0)` FORWARD (increasing index, wrapping) to `(i1,t1)`, with the two boundary cubics split so the arc starts exactly at `(i0,t0)` and ends exactly at `(i1,t1)`. Pure.
  - `_arcMidpoint(arc) -> {x,y}` — a point near the arc's middle (the `p0` of its middle segment, or the segment midpoint if one segment). Pure.
  - `_stitchUnionLoop(artPath, capPath, cross, otherPolyForArt, otherPolyForCap) -> [segments] | null` — the closed union loop. `cross` = `{c0,c1}` from `_twoOutermost`; `otherPolyForArt` = the cap sampled as a polygon `[{x,y}]` (to pick the art arc OUTSIDE the cap), `otherPolyForCap` = the art polygon (to pick the cap arc OUTSIDE the art). Returns the concatenated closed cubic loop, or `null` if it cannot form one. Pure.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/unit/test-stitch-loop.js`:

```javascript
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name){var re=new RegExp('function '+name+'\\s*\\([\\s\\S]*?\\n}');var m=src.match(re);if(!m)throw new Error('could not extract '+name);return m[0];}
eval(extract('_bezierPoint'));
eval(extract('pointInPolygon'));
eval(extract('_splitCubic'));
eval(extract('_arcBetween'));
eval(extract('_arcMidpoint'));
eval(extract('_cubicPolyline'));
eval(extract('_pt2'));
eval(extract('_reverseArc'));
eval(extract('_stitchUnionLoop'));

var fails=0;
function check(c,m){if(!c){console.log('FAIL: '+m);fails++;}}
function near(a,b,e){return Math.abs(a-b)<(e||1e-4);}
function seg(a,b){return {p0:a,c1:[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],c2:[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],p3:b};}
function polyOf(path){var p=_cubicPolyline(path,8),o=[],i;for(i=0;i<p.length;i++)o.push({x:p[i].x,y:p[i].y});return o;}

// _arcBetween: unit square (4 straight cubics CCW): (0,0)->(1,0)->(1,1)->(0,1)->close.
var SQ=[seg([0,0],[1,0]),seg([1,0],[1,1]),seg([1,1],[0,1]),seg([0,1],[0,0])];
(function(){
  // arc from (idx0,t0.5)=(0.5,0) forward to (idx2,t0.5)=(1,0.5? ) -> covers bottom-right corner.
  var arc=_arcBetween(SQ,0,0.5,2,0.5);
  check(arc.length>=1,'arc has segments');
  check(near(arc[0].p0[0],0.5)&&near(arc[0].p0[1],0),'arc starts at (0.5,0)');
  var last=arc[arc.length-1];
  check(near(last.p3[0],0.5)&&near(last.p3[1],1),'arc ends at (0.5,1)');
})();

// _stitchUnionLoop: art = unit square; cap = a box hanging off the bottom edge that overlaps.
// art bottom edge y=0; cap spans x[0.25,0.75], y[-0.5,0.25] -> crosses the bottom edge at
// x=0.25 and x=0.75. Union boundary = square minus the notch + cap's outer (bottom) rectangle.
(function(){
  var cap=[seg([0.25,0.25],[0.75,0.25]),seg([0.75,0.25],[0.75,-0.5]),
           seg([0.75,-0.5],[0.25,-0.5]),seg([0.25,-0.5],[0.25,0.25])];
  var cross={ c0:{x:0.25,y:0, aIdx:0,aT:0.25, bIdx:3,bT:0.6666667},
              c1:{x:0.75,y:0, aIdx:0,aT:0.75, bIdx:0,bT:0.5} };
  var loop=_stitchUnionLoop(SQ,cap,cross,polyOf(cap),polyOf(SQ));
  check(loop!==null,'loop built');
  // The loop must dip BELOW y=0 somewhere (it includes the cap's bottom at y=-0.5).
  var minY=1e9,i;for(i=0;i<loop.length;i++){minY=Math.min(minY,loop[i].p0[1],loop[i].p3[1]);}
  check(near(minY,-0.5,0.01),'union loop reaches the cap bottom y=-0.5 (got '+minY+')');
  // Closed: last.p3 == first.p0
  var f=loop[0].p0,l=loop[loop.length-1].p3;
  check(near(f[0],l[0])&&near(f[1],l[1]),'loop is closed');
})();

if(fails===0)console.log('PASS: stitch-loop'); else {console.log(fails+' FAIL');process.exit(1);}
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/integration/unit/test-stitch-loop.js`
Expected: `Error: could not extract _arcBetween`.

- [ ] **Step 3: Implement**

In `utils/aiUtils.jsx`, after Task 2's functions, add:

```javascript
// The FORWARD run of cubics from (i0,t0) to (i1,t1) along a closed cubic path (increasing index,
// wrapping past the end). The first cubic is trimmed to start at t0, the last to end at t1. If
// (i0,t0) and (i1,t1) fall in the same cubic with t1>t0, returns that single trimmed piece.
// Returns [segments]. Pure.
function _arcBetween(path, i0, t0, i1, t1) {
    var n = path.length, out = [], i, guard = 0;
    // same-cubic forward slice
    if (i0 === i1 && t1 > t0) {
        var mid = _splitCubic(path[i0], t0).right;        // [t0,1]
        var frac = (t1 - t0) / (1 - t0);
        out.push(_splitCubic(mid, frac).left);            // [t0,t1]
        return out;
    }
    // first (partial) cubic: [t0,1]
    out.push(_splitCubic(path[i0], t0).right);
    // whole middle cubics
    i = (i0 + 1) % n;
    while (i !== i1 && guard < n + 1) { out.push(path[i]); i = (i + 1) % n; guard++; }
    // last (partial) cubic: [0,t1]
    out.push(_splitCubic(path[i1], t1).left);
    return out;
}

// A point near an arc's middle: p0 of the middle segment (or the eval-at-0.5 of a lone segment).
function _arcMidpoint(arc) {
    if (arc.length === 1) { return _bezierPoint(arc[0].p0, arc[0].c1, arc[0].c2, arc[0].p3, 0.5); }
    var m = arc[Math.floor(arc.length / 2)];
    return { x: m.p0[0], y: m.p0[1] };
}

// Build the closed union loop: keep the ART arc that lies OUTSIDE the cap and the CAP arc that
// lies OUTSIDE the art, joined at the two crossings. `cross` = {c0,c1}. capPoly/artPoly are
// sampled polygons ([{x,y}]) used for the outside tests. Returns the closed cubic loop or null.
function _stitchUnionLoop(artPath, capPath, cross, capPoly, artPoly) {
    var c0 = cross.c0, c1 = cross.c1;
    // Two candidate ART arcs between the crossings; keep the one whose midpoint is OUTSIDE the cap.
    var artFwd = _arcBetween(artPath, c0.aIdx, c0.aT, c1.aIdx, c1.aT);
    var artRev = _arcBetween(artPath, c1.aIdx, c1.aT, c0.aIdx, c0.aT);
    var artArc = pointInPolygon(_arcMidpoint(artFwd), capPoly) ? artRev : artFwd;
    // Two candidate CAP arcs; keep the one whose midpoint is OUTSIDE the art.
    var capFwd = _arcBetween(capPath, c0.bIdx, c0.bT, c1.bIdx, c1.bT);
    var capRev = _arcBetween(capPath, c1.bIdx, c1.bT, c0.bIdx, c0.bT);
    var capArc = pointInPolygon(_arcMidpoint(capFwd), artPoly) ? capRev : capFwd;
    if (!artArc.length || !capArc.length) return null;

    // Orient so the loop is continuous: artArc ends at one crossing; capArc must start there.
    var artEnd = artArc[artArc.length - 1].p3;
    var capStart = capArc[0].p0;
    if (!(_pt2(artEnd, capStart) < 1e-6)) { capArc = _reverseArc(capArc); }
    // Concatenate; snap the two seams to a shared point so the loop closes exactly.
    var loop = [], i;
    for (i = 0; i < artArc.length; i++) loop.push(artArc[i]);
    for (i = 0; i < capArc.length; i++) loop.push(capArc[i]);
    // Weld endpoints: force continuity at the two joins.
    for (i = 0; i < loop.length; i++) {
        var nxt = loop[(i + 1) % loop.length];
        // share the anchor: set nxt.p0 = loop[i].p3 (keep handles)
        nxt.p0 = loop[i].p3;
    }
    return loop;
}

// squared distance between two [x,y] points
function _pt2(a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1];
    return dx * dx + dy * dy;
}

// Reverse an arc (list of cubics): reverse order AND swap each segment's endpoints/handles.
function _reverseArc(arc) {
    var out = [], i, s;
    for (i = arc.length - 1; i >= 0; i--) {
        s = arc[i];
        out.push({ p0: s.p3, c1: s.c2, c2: s.c1, p3: s.p0 });
    }
    return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node tests/integration/unit/test-stitch-loop.js`
Expected: `PASS: stitch-loop`
(If the outside-test picks the wrong arc, the min-Y assertion fails — that is the guard that the arc selection is correct.)

- [ ] **Step 5: Runner + commit**

Create `tests/integration/unit/run-test-stitch-loop.sh` (`STEP="stitch-loop-unit"`, runs `test-stitch-loop.js`), then:
```bash
chmod +x tests/integration/unit/run-test-stitch-loop.sh
git add utils/aiUtils.jsx tests/integration/unit/test-stitch-loop.js tests/integration/unit/run-test-stitch-loop.sh
git commit -m "feat(cutline): _stitchUnionLoop + _arcBetween — trace union from two crossings (pure)"
```

---

### Task 4: Illustrator glue — `PathItem`↔cubics, rewrite `deriveCutline`; live-validate

**Files:**
- Modify: `utils/aiUtils.jsx` — add `_pathItemToCubics`, `_cubicsToPathItem`; replace `deriveCutline` body.
- Live fixture: `tests/integration/ai-build-and-export-cutlines/` runner.

**Interfaces:**
- Consumes: Tasks 1–3 (`_cubicCrossings`, `_twoOutermost`, `_stitchUnionLoop`), plus `samplePathToPolygons`, `_largestPoly`.
- Produces:
  - `_pathItemToCubics(item) -> [segments]` — read a closed `PathItem`'s `pathPoints` into the cubic model (`p0=A[i]`, `c1=R[i]`, `c2=L[i+1]`, `p3=A[i+1]`, wrapping). If `item` is a `CompoundPathItem`/`GroupItem`, use its largest-area leaf `PathItem`.
  - `_cubicsToPathItem(parent, cubics) -> PathItem` — create a closed `PathItem` under `parent` whose anchors are the segment endpoints and whose handles are the segment control points (`setEntirePath` for anchors, then assign `rightDirection`/`leftDirection` per point).
  - `deriveCutline(outline, plate) -> PathItem` (unchanged signature) — now the stitched cutline; **throws** `"deriveCutline: caption not seated (…)"` on `< 2` crossings.

- [ ] **Step 1: Add the glue helpers**

In `utils/aiUtils.jsx`, immediately BEFORE `function deriveCutline`, add:

```javascript
// Largest-area leaf PathItem of a PathItem / CompoundPathItem / GroupItem.
function _largestLeafPathItem(item) {
    var acc = [];
    (function walk(it) {
        var t = it.typename, i;
        if (t === "PathItem") acc.push(it);
        else if (t === "CompoundPathItem") { for (i = 0; i < it.pathItems.length; i++) acc.push(it.pathItems[i]); }
        else if (t === "GroupItem") { for (i = 0; i < it.pageItems.length; i++) walk(it.pageItems[i]); }
    })(item);
    var best = null, bestA = -1, i, b, a;
    for (i = 0; i < acc.length; i++) {
        b = acc[i].geometricBounds; a = Math.abs((b[2] - b[0]) * (b[1] - b[3]));
        if (a > bestA) { bestA = a; best = acc[i]; }
    }
    return best;
}

// Read a closed path's pathPoints into the cubic-segment model. Returns [segments].
function _pathItemToCubics(item) {
    var leaf = (item.typename === "PathItem") ? item : _largestLeafPathItem(item);
    var pts = leaf.pathPoints, n = pts.length, A = [], L = [], R = [], k;
    for (k = 0; k < n; k++) { A[k] = pts[k].anchor; L[k] = pts[k].leftDirection; R[k] = pts[k].rightDirection; }
    var segs = [], i, nx;
    for (i = 0; i < n; i++) {
        nx = (i + 1) % n;
        segs.push({ p0: [A[i][0], A[i][1]], c1: [R[i][0], R[i][1]],
                    c2: [L[nx][0], L[nx][1]], p3: [A[nx][0], A[nx][1]] });
    }
    return segs;
}

// Write a cubic-segment loop to a new closed PathItem under `parent`. Anchor i = segs[i].p0;
// its rightDirection = segs[i].c1; its leftDirection = segs[i-1].c2 (the previous segment's c2).
function _cubicsToPathItem(parent, segs) {
    var n = segs.length, coords = [], i;
    for (i = 0; i < n; i++) coords.push([segs[i].p0[0], segs[i].p0[1]]);
    var path = parent.pathItems.add();
    path.setEntirePath(coords);
    path.closed = true;                                   // setEntirePath can drop the flag
    var pp = path.pathPoints;
    for (i = 0; i < n; i++) {
        var prev = (i - 1 + n) % n;
        pp[i].anchor = [segs[i].p0[0], segs[i].p0[1]];
        pp[i].rightDirection = [segs[i].c1[0], segs[i].c1[1]];
        pp[i].leftDirection  = [segs[prev].c2[0], segs[prev].c2[1]];
        pp[i].pointType = PointType.CORNER;
    }
    return path;
}
```

- [ ] **Step 2: Replace `deriveCutline`'s body**

Replace the entire `function deriveCutline(outline, plate) { ... }` with:

```javascript
// Fused cutline = the outer boundary of (art ∪ caption), traced from the two junction crossings
// (NOT a boolean union — that fails to fuse a two-point-contact seat and leaves junction slivers).
// See docs/superpowers/specs/2026-07-22-stitched-cutline-construction-design.md. Throws on a
// caption that is not seated into the art (< 2 crossings) — a hard error the caller surfaces.
function deriveCutline(outline, plate) {
    var parent = outline.parent;
    var steps = (typeof CONFIG !== "undefined" && CONFIG.seatSampleSteps) ? CONFIG.seatSampleSteps : 24;

    var artCubics = _pathItemToCubics(outline);
    var capCubics = _pathItemToCubics(plate);

    var crossings = _cubicCrossings(artCubics, capCubics, steps);
    if (crossings.length < 2) {
        throw new Error("deriveCutline: caption not seated into the art (" + crossings.length
            + " crossing(s)); cannot stitch cutline.");
    }
    var pair = _twoOutermost(crossings);
    var capPoly = _largestPoly(samplePathToPolygons(plate, steps));
    var artPoly = _largestPoly(samplePathToPolygons(outline, steps));
    var loop = _stitchUnionLoop(artCubics, capCubics, pair, capPoly, artPoly);
    if (!loop || loop.length < 2) {
        throw new Error("deriveCutline: could not stitch a closed cutline for the caption.");
    }
    return _cubicsToPathItem(parent, loop);
}
```

- [ ] **Step 3: Syntax check**

Run: `cp utils/aiUtils.jsx /tmp/aiUtils-check.js && node --check /tmp/aiUtils-check.js && echo OK`
Expected: `OK`

- [ ] **Step 4: Live-validate on build-export (needs Illustrator)**

Run: `tests/integration/ai-build-and-export-cutlines/run.sh`
Then check the seated result with the join-scan (all captions must fuse):
```bash
osascript -e 'tell application "Adobe Illustrator" to do javascript file (POSIX file "/tmp/join-scan.jsx")'
```
Expected: `caption NOT joined (pill is a separate leaf): 0` — **including Tatra chamois** — with `captionSeatOverlapMm` still `0`. The runner's caption-build assertions PASS (28 built, 0 failed). The golden diff WILL fail (construction changed) — that is expected and handled in Task 6. If any caption throws "not seated" or the join-scan shows a detached pill, STOP: inspect that element's crossings before proceeding.

> `/tmp/join-scan.jsx` is the scan used during design (counts, per captioned Cutlines group, whether any fused leaf matches the plate = a detached caption). If absent, recreate it: for each `GroupItem` in the `Cutlines` layer with a `"<name> plate"` member, compare the plate's centroid+area to each leaf of the `"<name>"` fused member; a leaf within 10pt and area-ratio 0.75–1.25 of the plate = detached.

- [ ] **Step 5: Commit**

```bash
git add utils/aiUtils.jsx
git commit -m "feat(cutline): stitch deriveCutline from union crossings (replace boolean)

Trace the outer boundary of (art ∪ caption) via _cubicCrossings + _stitchUnionLoop
instead of Live Pathfinder Add. Two-point-contact seats (Tatra) fuse with no embed;
no junction slivers. Throws a hard error on an unseated caption."
```

---

### Task 5: Retire the sliver-removal machinery

**Files:**
- Modify: `utils/aiUtils.jsx` — remove `removeCaptionJunctionSlivers`, `_junctionSliverLeaves`, `_fusedCutLeaves`, and the `[cutline] junction slivers removed` log call (the stitch never made slivers).
- Modify: `tests/integration/ai-normalise-captions/run.sh` — remove the leaf-count / "cleanup fired" assertion block added for slivers.
- Delete: `tests/integration/unit/test-junction-slivers.js`, `tests/integration/unit/run-test-junction-slivers.sh`.

- [ ] **Step 1: Remove the functions and their call site**

Delete the three functions and the `if (sw.removed > 0) log(...)` / `removeCaptionJunctionSlivers(...)` call that the old boolean `deriveCutline` used. (The new `deriveCutline` in Task 4 does not reference them, so no call remains — grep to confirm.)

Run: `grep -n "removeCaptionJunctionSlivers\|_junctionSliverLeaves\|_fusedCutLeaves" utils/aiUtils.jsx`
Expected: no matches.

- [ ] **Step 2: Remove the normalise sliver assertion**

In `tests/integration/ai-normalise-captions/run.sh`, delete the leaf-count / cleanup-fired assertion block added for sliver removal (search for `LEAFCHK` / `junction slivers` / `single contour`). Leave the reset + idempotency assertions intact.

Run: `grep -nc "LEAFCHK\|junction sliver\|single contour" tests/integration/ai-normalise-captions/run.sh`
Expected: `0`

- [ ] **Step 3: Delete the sliver unit test + runner**

```bash
git rm tests/integration/unit/test-junction-slivers.js tests/integration/unit/run-test-junction-slivers.sh
```

- [ ] **Step 4: Syntax check + node unit sweep**

```bash
cp utils/aiUtils.jsx /tmp/aiUtils-check.js && node --check /tmp/aiUtils-check.js && echo OK
for f in tests/integration/unit/run-test-stitch-*.sh; do "$f"; done
```
Expected: `OK`, and each stitch unit runner prints `PASS`.

- [ ] **Step 5: Commit**

```bash
git add -A utils/aiUtils.jsx tests/integration/ai-normalise-captions/run.sh
git commit -m "refactor(cutline): retire sliver removal — the stitch makes no slivers"
```

---

### Task 6: Full live validation + golden regeneration

**Files:**
- Modify (regenerate): the goldens that seat/build cutlines — at minimum `tests/integration/ai-build-and-export-cutlines/expected.txt` and `tests/integration/ai-normalise-captions/expected.txt`; check `ai-import-nesting` and `ai-export-final` too.

- [ ] **Step 1: Half-cut alignment regression (the cut shape changed)**

Run: `tests/integration/unit/run-ai-halfcut-alignment.sh`
Expected: PASS (endpoints still land on the cut line). If it fails, STOP — the stitched cutline broke the seam projection; investigate before regenerating any golden.

- [ ] **Step 2: Build-export — verify then regenerate golden**

Run: `tests/integration/ai-build-and-export-cutlines/run.sh`
Confirm: `28 caption(s) built, 0 failed`; classification line `16 regular, 12 irregular` unchanged; join-scan shows 0 detached. Then, if the only diffs are the construction changes (no failures, same element set/counts):
```bash
cp /tmp/AI_BuildAndExportCutlines.log tests/integration/ai-build-and-export-cutlines/expected.txt
```
Re-run; confirm `PASS ... log matches golden`.

- [ ] **Step 3: Normalise — verify then regenerate golden**

Run: `tests/integration/ai-normalise-captions/run.sh`
Confirm reset + idempotency PASS. Regenerate:
```bash
cp /tmp/normalise-captions-run1.log tests/integration/ai-normalise-captions/expected.txt
```
Re-run; confirm PASS.

- [ ] **Step 4: Import-nesting + export-final — run, regen only if benign**

Run each runner:
```bash
tests/integration/ai-import-nesting/run.sh
tests/integration/ai-export-final/run.sh
```
For any whose golden diff is purely the construction change (no new failures, same counts), regenerate its golden the way its runner documents and re-run to green. If any shows a NEW failure (a caption that no longer builds, a half-cut off the line, a classification flip), STOP and investigate — do not paper over it with a golden.

- [ ] **Step 5: Full suite + commit**

```bash
tests/integration/run-all.sh
```
Expected: all PASS / SKIP (SKIP only where an Adobe app is unavailable), no FAIL.
```bash
git add tests/integration/*/expected.txt tests/integration/*/expected 2>/dev/null || true
git commit -m "test: regenerate goldens for stitched cutline construction

All 28 captions fuse (Tatra included) with captionSeatOverlapMm=0; half-cut
alignment green; classification unchanged."
```

---

## Self-Review

**Spec coverage:**
- Trace union from two crossings → Tasks 2 (`_cubicCrossings`/`_twoOutermost`) + 3 (`_stitchUnionLoop`). ✓
- Bezier-preserving (split only at junctions) → Task 1 (`_splitCubic`) + `_arcBetween`. ✓
- Which arc to keep (midpoint-inside tests) → Task 3 `_stitchUnionLoop`. ✓
- Hard error, no fallback (<2 crossings) → Task 4 `deriveCutline` throws. ✓
- Signature/return unchanged for success; failure throws (spec leaning) → Task 4. ✓
- Tabs use it (deriveCutline) → covered by Task 4 (same function) + Task 6 export-final/import validation. ✓
- Retire sliver machinery + keep embed at 0 → Task 5 + Task 4 (no embed added). ✓
- Reused helpers only → Tasks reuse `samplePathToPolygons`/`_largestPoly`/`_pointInPolysEO`/`pointInPolygon`/`_bezierPoint`. ✓
- Testing: pure node units + live (join, half-cut, nesting, spot-check, goldens) → Tasks 1–3 + 6. ✓

**Placeholder scan:** none — all steps carry literal code/commands. `/tmp/join-scan.jsx` is defined (recreation recipe given in Task 4).

**Type consistency:** cubic segment `{p0,c1,c2,p3}` (each `[x,y]`) is used identically across Tasks 1–4. `_cubicCrossings` returns `{x,y,aIdx,aT,bIdx,bT}`; `_twoOutermost` returns `{c0,c1}` of those; `_stitchUnionLoop(artPath, capPath, cross, capPoly, artPoly)` consumes `{c0,c1}` and polygons `[{x,y}]` — matches Task 4's call. `_pathItemToCubics`/`_cubicsToPathItem` names match Task 4's usage.

**Note on Task 4 (live iteration):** the pure geometry (Tasks 1–3) is deterministically node-tested, but the `PathItem`↔cubic round-trip and handle assignment can need live tuning against real geometry (spec Open Question #2). If handles come out wrong on curved edges, the bounded fallback is to sample only the two junction segments to short polylines while keeping other segments as beziers — decide against live output, not up front.
