// tests/integration/unit/test-caption-capend.js
// Pure-geometry unit test for the caption pill's BEZIER end-caps (aiUtils).
//
// The WC capsule (buildCapsuleFromSpine) used to build its rounded ends as a 10-segment
// STRAIGHT-line polygon approximation of a semicircle (_appendCap / _capsulePolygon). Those
// flat chords are visibly jagged at print zoom (the artist's "Spiš Castle" complaint). The fix
// mirrors Illustrator's Live Corners: build the caps as exact circular-arc BEZIER segments.
//
// _capsuleBezierNodes(spine, r) returns an ordered, closed list of path nodes:
//   { anchor:[x,y], leftDir:[x,y], rightDir:[x,y], smooth:Bool }
// The two long sides stay corner nodes at the offset-spine points; the two caps become
// kappa-handle bezier arcs. This test asserts the caps ride the TRUE circle (unlike straight
// chords), the sides are preserved, and the ring is continuous.
//
// ES3 bodies are node-compatible; extract the declarations and eval them (deps first).
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '[\\s\\S]*?\\n}');
    var m = src.match(re);
    if (!m) throw new Error('could not extract ' + name + ' from aiUtils.jsx');
    return m[0];
}
eval(extract('_capUnit'));
eval(extract('_appendCap'));       // legacy polygon cap — used as the "before" reference
eval(extract('_capsulePolygon'));  // legacy full polygon — reference for chord sag
eval(extract('_capArcNodes'));
eval(extract('_capsuleBezierNodes'));

// Cubic bezier point (mirrors aiUtils _bezierPoint, [x,y] in / {x,y} out).
function bez(p0, p1, p2, p3, t) {
    var mt = 1 - t;
    function lerp(a, b) { return [mt * a[0] + t * b[0], mt * a[1] + t * b[1]]; }
    var q0 = lerp(p0, p1), q1 = lerp(p1, p2), q2 = lerp(p2, p3);
    var r0 = lerp(q0, q1), r1 = lerp(q1, q2);
    return { x: mt * r0[0] + t * r1[0], y: mt * r0[1] + t * r1[1] };
}
function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }

var fails = 0;
function check(cond, msg) { if (!cond) { console.log('FAIL: ' + msg); fails++; } }

// ── 1. Straight horizontal spine → the two caps ride the true circle within a tight tol ──
// Spine along x at y=0, radius 20. Cap centres are the spine endpoints. Sample every bezier
// segment of every cap node and assert |P - capCentre| stays within 0.1% of r everywhere
// (a straight-chord cap sags ~1.2% — see test 2 — so this genuinely distinguishes the two).
(function () {
    var spine = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 80, y: 0 }];
    var r = 20;
    var nodes = _capsuleBezierNodes(spine, r);
    check(nodes && nodes.length >= 6, 'returns a closed node ring (got ' + (nodes ? nodes.length : 'null') + ')');

    var centres = [{ x: 0, y: 0 }, { x: 80, y: 0 }];   // the two spine endpoints
    var worst = 0, n = nodes.length, i, j;
    for (i = 0; i < n; i++) {
        var a = nodes[i], b = nodes[(i + 1) % n];
        // only measure cap segments: both endpoints of the segment lie within r+eps of a centre
        for (var c = 0; c < centres.length; c++) {
            var da = dist(a.anchor[0], a.anchor[1], centres[c].x, centres[c].y);
            var db = dist(b.anchor[0], b.anchor[1], centres[c].x, centres[c].y);
            if (Math.abs(da - r) < 0.01 && Math.abs(db - r) < 0.01) {
                for (j = 1; j < 8; j++) {
                    var p = bez(a.anchor, a.rightDir, b.leftDir, b.anchor, j / 8);
                    var err = Math.abs(dist(p.x, p.y, centres[c].x, centres[c].y) - r);
                    if (err > worst) worst = err;
                }
            }
        }
    }
    check(worst < r * 0.001, 'bezier caps ride the circle: worst radial error ' + worst.toFixed(4) + ' should be < ' + (r * 0.001).toFixed(4));
})();

// ── 2. Reference: the OLD straight-chord cap visibly sags off the circle (the bug we fix) ──
// Not testing new code — documents WHY (a chord midpoint sits ~1.2% of r inside the arc).
(function () {
    var C = { x: 0, y: 0 }, r = 20;
    var poly = [];
    _appendCap(poly, C, r, [0, r], [0, -r], [-1, 0]);   // 10-chord semicircle, bulging -x
    var worst = 0;
    for (var i = 0; i + 1 < poly.length; i++) {
        var mx = (poly[i][0] + poly[i + 1][0]) / 2, my = (poly[i][1] + poly[i + 1][1]) / 2;
        var err = Math.abs(dist(mx, my, C.x, C.y) - r);
        if (err > worst) worst = err;
    }
    check(worst > r * 0.01, 'sanity: old chord cap sags > 1% of r (got ' + worst.toFixed(3) + ') — this is the jaggedness');
})();

// ── 3. Sides preserved: the offset-spine edge points still appear as anchors ──
// The first node is the top edge start (spine[0] + r*normal). For a horizontal spine the normal
// is +y, so top[0] = (0, r) and bot[0] = (0, -r) must both be present as anchors.
(function () {
    var spine = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 80, y: 0 }];
    var r = 20;
    var nodes = _capsuleBezierNodes(spine, r);
    function hasAnchor(x, y) {
        for (var i = 0; i < nodes.length; i++)
            if (dist(nodes[i].anchor[0], nodes[i].anchor[1], x, y) < 1e-6) return true;
        return false;
    }
    check(hasAnchor(0, 20), 'top edge start (0,20) preserved as an anchor');
    check(hasAnchor(0, -20), 'bot edge start (0,-20) preserved as an anchor');
    check(hasAnchor(80, 20) || hasAnchor(80, -20), 'far-end edge point preserved as an anchor');
})();

// ── 4. Closed ring: consecutive anchors never coincide (no zero-length degenerate segment) ──
(function () {
    var spine = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 80, y: 0 }];
    var nodes = _capsuleBezierNodes(spine, 20);
    var n = nodes.length, ok = true;
    for (var i = 0; i < n; i++) {
        var a = nodes[i].anchor, b = nodes[(i + 1) % n].anchor;
        if (dist(a[0], a[1], b[0], b[1]) < 1e-9) ok = false;
    }
    check(ok, 'no duplicate consecutive anchors in the ring');
})();

console.log(fails === 0 ? 'PASS capend' : ('FAIL capend (' + fails + ' failure(s))'));
process.exit(fails === 0 ? 0 : 1);
