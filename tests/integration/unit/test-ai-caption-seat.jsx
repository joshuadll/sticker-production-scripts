// test-ai-caption-seat.jsx -- Unit tests for the Illustrator-side vector caption seat in
// utils/aiUtils.jsx (seatPlateToOutline and its pure helpers).
//
// Run directly in Illustrator (File > Scripts > Browse) or via run-test-ai-caption-seat.sh.
// NO open document required -- every function tested here is pure geometry (plain numbers /
// mock-bounds objects in, plain numbers out). The DOM-bound pieces (samplePathToPolygons +
// _innerEdgeVerts on the real plate, app.getRotationMatrix in _rotateItemsAbout, and the
// .transform / .translate calls in seatPlateToOutline itself) are validated in-app, not here.
// Results -> Desktop/test-ai-caption-seat.log + an alert.
//
// Guards the Option-B vector-seat invariants (see docs/caption-seating-redesign.md):
//   - the vector edge probe returns the outline edge NEAREST the pill (facing edge), or
//     null on overhang -- the swap that replaces Step3B's raster _probeBorder
//   - travel axis + sign derive from plate-centre -> outline-centre (y-up bounds)
//   - the pin-E0 kiss + convex-bulge math match the proven Photoshop twins exactly
//   - the curve-aware balanced shrink stays centred on the inner edge

#target illustrator

var CONFIG = {
    suppressAlerts: true,
    logPath:        Folder.desktop.fsName + "/test-ai-caption-seat.log"
};

#include "../../../utils/aiUtils.jsx"

// --- TEST HARNESS -------------------------------------------------------------

var _passed = 0;
var _failed = 0;
var _logPath = Folder.desktop.fsName + "/test-ai-caption-seat.log";

var _clearFile = new File(_logPath);
_clearFile.open("w");
_clearFile.close();

function testLog(msg) {
    $.writeln(msg);
    var f = new File(_logPath);
    f.encoding = "UTF-8";
    f.lineFeed = "Unix";
    f.open("a");
    f.writeln(msg);
    f.close();
}

function assert(description, actual, expected) {
    var a = String(actual), e = String(expected);
    if (a === e) {
        testLog("[ai-seat-test] PASS | " + description);
        _passed++;
    } else {
        testLog("[ai-seat-test] FAIL | " + description);
        testLog("  expected: " + e);
        testLog("  actual:   " + a);
        _failed++;
    }
}

function assertClose(description, actual, expected, tol) {
    if (tol === undefined) tol = 1e-6;
    var ok = (typeof actual === "number") && Math.abs(actual - expected) <= tol;
    if (ok) {
        testLog("[ai-seat-test] PASS | " + description);
        _passed++;
    } else {
        testLog("[ai-seat-test] FAIL | " + description);
        testLog("  expected: " + expected + " (+/-" + tol + ")");
        testLog("  actual:   " + actual);
        _failed++;
    }
}

function assertPt(description, p, x, y, tol) {
    assertClose(description + ".x", p ? p.x : NaN, x, tol);
    assertClose(description + ".y", p ? p.y : NaN, y, tol);
}

// A closed square outline, y-up, spanning [0,100] x [0,100], CCW.
var SQUARE = [[ {x:0,y:0}, {x:100,y:0}, {x:100,y:100}, {x:0,y:100} ]];

// --- _aiChordAngleDeg / _aiNormalizeDeg ---------------------------------------

testLog("[ai-seat-test] --- _aiChordAngleDeg / _aiNormalizeDeg ---");
assertClose("chord right ->   0 deg", _aiChordAngleDeg({x:0,y:0}, {x:10,y:0}),   0);
assertClose("chord +y    ->  90 deg", _aiChordAngleDeg({x:0,y:0}, {x:0,y:10}),  90);
assertClose("chord -y    -> -90 deg", _aiChordAngleDeg({x:0,y:0}, {x:0,y:-10}), -90);
assertClose("normalize 190 -> -170",  _aiNormalizeDeg(190),  -170);
assertClose("normalize -180 -> 180",  _aiNormalizeDeg(-180),  180);

// --- _aiSeatGeometry (mock geometricBounds [left, top, right, bottom], y-up) ---

testLog("[ai-seat-test] --- _aiSeatGeometry ---");
// Plate below the art (plate top=-10, bottom=-30; art is the square): travel = y, sign +1.
var plateBelow   = { geometricBounds: [0, -10, 100, -30] };
var artSquare    = { geometricBounds: [0, 100, 100, 0] };
var gBelow = _aiSeatGeometry(plateBelow, artSquare);
assert("plate-below travelIsX", gBelow.travelIsX, false);
assert("plate-below sign +1",   gBelow.sign, 1);
// Plate above the art: travel = y, sign -1.
var plateAbove = { geometricBounds: [0, 130, 100, 110] };
var gAbove = _aiSeatGeometry(plateAbove, artSquare);
assert("plate-above sign -1", gAbove.sign, -1);
// Plate to the LEFT of the art: travel = x, sign +1 (art at larger x).
var plateLeft = { geometricBounds: [-30, 50, -10, 30] };
var gRight = _aiSeatGeometry(plateLeft, artSquare);
assert("plate-left travelIsX", gRight.travelIsX, true);
assert("plate-left sign +1",   gRight.sign, 1);

// --- _probeOutline (vector facing-edge probe; the raster -> vector swap) -------

testLog("[ai-seat-test] --- _probeOutline ---");
// Plate below, sign +1: facing edge = art BOTTOM (min y) at the probe column.
assertPt("probe from below finds art bottom (y=0)",
    _probeOutline(SQUARE, gBelow, {x:50, y:-20}), 50, 0);
// Plate above, sign -1: facing edge = art TOP (max y).
assertPt("probe from above finds art top (y=100)",
    _probeOutline(SQUARE, gAbove, {x:50, y:130}), 50, 100);
// Horizontal travel, sign +1: facing edge = art LEFT (min x).
assertPt("probe from left finds art left (x=0)",
    _probeOutline(SQUARE, gRight, {x:-20, y:50}), 0, 50);
// Overhang: probe column outside the art's x-extent -> null.
assert("probe overhang -> null",
    _probeOutline(SQUARE, gBelow, {x:150, y:-20}), null);
// Concave notch must not fool it: an upward spike from the bottom edge is the NEAREST
// surface to a pill below, so the facing edge is the spike tip, not the flat base.
var NOTCHED = [[ {x:0,y:0}, {x:40,y:0}, {x:50,y:30}, {x:60,y:0}, {x:100,y:0},
                 {x:100,y:100}, {x:0,y:100} ]];
assertPt("probe takes nearest surface over a spike (y=30)",
    _probeOutline(NOTCHED, gBelow, {x:50, y:-20}), 50, 30);

// --- _aiKissVector (pin-E0, signed depth, bidirectional) — PS twin -------------

testLog("[ai-seat-test] --- _aiKissVector ---");
// Plate below, art bottom 5 above the inner edge, depth 3 -> move up 8 (into the art).
assertClose("kiss below: gap 5 + depth 3 -> +8",
    _aiKissVector({x:0,y:0}, {x:0,y:5}, gBelow, 3).ty, 8);
// Already 2 into the art, depth 3 -> +1 more.
assertClose("kiss below: shallow overlap -> +1",
    _aiKissVector({x:0,y:0}, {x:0,y:-2}, gBelow, 3).ty, 1);
// 10 too deep, depth 3 -> pull OUT by 7 (bidirectional, signed).
assertClose("kiss below: too deep -> -7 (outward)",
    _aiKissVector({x:0,y:0}, {x:0,y:-10}, gBelow, 3).ty, -7);
// Horizontal travel writes tx, not ty.
var kx = _aiKissVector({x:0,y:0}, {x:4,y:0}, gRight, 2);
assertClose("kiss horizontal tx", kx.tx, 6);
assertClose("kiss horizontal ty", kx.ty, 0);

// --- _aiMidProtrusion (convex bulge, p = sagitta + depth) — PS twin ------------

testLog("[ai-seat-test] --- _aiMidProtrusion ---");
// Plate below the art (sign +1): the art's facing edge is its BOTTOM; a convex bulge dips
// toward the pill (smaller y) -> positive sagitta. Bm 10 below the B0/B1 chord toward the pill.
assertClose("below convex bulge -> 10 + 3 = 13",
    _aiMidProtrusion({x:0,y:100}, {x:100,y:100}, {x:50,y:90}, gBelow, 3), 13);
// Flat -> p == depth.
assertClose("below flat -> p == depth",
    _aiMidProtrusion({x:0,y:100}, {x:100,y:100}, {x:50,y:100}, gBelow, 3), 3);
// Missing midpoint probe -> null.
assert("null Bm -> null", _aiMidProtrusion({x:0,y:0}, {x:1,y:0}, null, gBelow, 3), null);

// --- _innerEdgeVerts near-circular guard (HIGH-bug regression) -----------------
// Needs a DENSELY-sampled plate (edge points, not a 4-corner rect — those all classify as
// caps and collapse to the degenerate branch). gBelow = art ABOVE the pill, so the inner edge
// faces +y. The guard is what stops a near-circular pill from seating a ~90deg-wrong baseline.
testLog("[ai-seat-test] --- _innerEdgeVerts (near-circular guard) ---");

// Wide pill (100x20, aspect 5): PCA axis reliable -> NOT kissOnly; radius = half height = 10;
// real inner-edge verts found (so the conform rotation runs).
var wideIe = _innerEdgeVerts(
    [{x:0,y:0},{x:25,y:0},{x:50,y:0},{x:75,y:0},{x:100,y:0},
     {x:100,y:20},{x:75,y:20},{x:50,y:20},{x:25,y:20},{x:0,y:20}], gBelow);
assert("wide pill not kissOnly", wideIe.kissOnly, false);
assertClose("wide pill radius = 10", wideIe.radius, 10);
assert("wide pill has inner-edge verts", wideIe.verts.length >= 2, true);

// Near-square pill (20x20, aspect 1): PCA long axis is noise -> guard MUST fire (kissOnly), so
// the seat keeps the artist angle instead of flipping ~90deg. radius still = 10.
var sqIe = _innerEdgeVerts(
    [{x:0,y:0},{x:10,y:0},{x:20,y:0},{x:20,y:10},
     {x:20,y:20},{x:10,y:20},{x:0,y:20},{x:0,y:10}], gBelow);
assert("near-square pill kissOnly", sqIe.kissOnly, true);
assertClose("near-square pill radius = 10", sqIe.radius, 10);

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

// --- SUMMARY ------------------------------------------------------------------

testLog("[ai-seat-test] ====================================");
testLog("[ai-seat-test] " + _passed + " passed, " + _failed + " failed.");

if (!CONFIG.suppressAlerts) {
    alert("AI caption-seat unit tests:\n" + _passed + " passed, " + _failed + " failed.\n\n"
        + "Log: " + _logPath);
}
