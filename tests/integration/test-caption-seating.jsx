// test-caption-seating.jsx -- Unit tests for the analytic capsule-seating geometry in
// photoshop/Step3B_CaptionWhite.jsx (seatCaptionConform and its pure helpers).
//
// Run directly in Photoshop (File > Scripts > Browse) or via run-test-caption-seating.sh.
// NO open document required -- every function tested here is pure geometry (plain numbers
// in, plain numbers out; the raster probe _probeBorder is the only PS-bound piece and is
// validated in-app, not here). Results -> Desktop/test-caption-seating.log + an alert.
//
// Guards the redesign invariants (see docs/caption-seating-redesign.md):
//   - analytic inner-edge endpoints E = spineEnd + r*normal(toward art)
//   - border tilt = chord angle; angle normalisation
//   - balanced overhang shrink stays centred
//   - the pin-E0 kiss is bidirectional (signed depth)
//   - the carried spine rotates/translates with the same transform as the pill

#target photoshop

var CONFIG = {
    suppressAlerts: true,
    logPath:        Folder.desktop.fsName + "/test-caption-seating.log"
};

#include "../../utils/psUtils.jsx"
#include "../../photoshop/Step3B_CaptionWhite.jsx"

// --- TEST HARNESS -------------------------------------------------------------

var _passed = 0;
var _failed = 0;
var _logPath = Folder.desktop.fsName + "/test-caption-seating.log";

var _clearFile = new File(_logPath);
_clearFile.open("w");
_clearFile.close();

function testLog(msg) {
    $.writeln(msg);
    var f = new File(_logPath);
    f.encoding = "UTF-8";   // write all chars; default encoding silently drops some
    f.lineFeed = "Unix";    // \n terminators so the runner's line-based grep counts right
    f.open("a");
    f.writeln(msg);
    f.close();
}

function assert(description, actual, expected) {
    var a = String(actual), e = String(expected);
    if (a === e) {
        testLog("[seating-test] PASS | " + description);
        _passed++;
    } else {
        testLog("[seating-test] FAIL | " + description);
        testLog("  expected: " + e);
        testLog("  actual:   " + a);
        _failed++;
    }
}

// Numeric assert with tolerance (geometry is float).
function assertClose(description, actual, expected, tol) {
    if (tol === undefined) tol = 1e-6;
    var ok = (typeof actual === "number") && Math.abs(actual - expected) <= tol;
    if (ok) {
        testLog("[seating-test] PASS | " + description);
        _passed++;
    } else {
        testLog("[seating-test] FAIL | " + description);
        testLog("  expected: " + expected + " (+/-" + tol + ")");
        testLog("  actual:   " + actual);
        _failed++;
    }
}

function assertPt(description, p, x, y, tol) {
    assertClose(description + ".x", p ? p.x : NaN, x, tol);
    assertClose(description + ".y", p ? p.y : NaN, y, tol);
}

// --- _chordAngleDeg (PS y-down) -----------------------------------------------

testLog("[seating-test] --- _chordAngleDeg ---");
assertClose("chord right ->   0 deg", _chordAngleDeg({x:0,y:0}, {x:10,y:0}),   0);
assertClose("chord down  ->  90 deg", _chordAngleDeg({x:0,y:0}, {x:0,y:10}),  90);
assertClose("chord up    -> -90 deg", _chordAngleDeg({x:0,y:0}, {x:0,y:-10}), -90);
assertClose("chord left  -> 180 deg", _chordAngleDeg({x:0,y:0}, {x:-10,y:0}), 180);

// --- _normalizeDeg -> (-180,180] ----------------------------------------------

testLog("[seating-test] --- _normalizeDeg ---");
assertClose("normalize 190 -> -170",  _normalizeDeg(190),  -170);
assertClose("normalize -190 -> 170",  _normalizeDeg(-190),  170);
assertClose("normalize 180 -> 180",   _normalizeDeg(180),   180);
assertClose("normalize -180 -> 180",  _normalizeDeg(-180),  180);
assertClose("normalize 540 -> 180",   _normalizeDeg(540),   180);

// --- _innerEdgeEndpoints (analytic, no sampling) ------------------------------

testLog("[seating-test] --- _innerEdgeEndpoints ---");

// Flat horizontal spine, art BELOW (vertical travel, sign +1) -> inner edge = bottom.
var gBelow = { travelIsX: false, sign: 1 };
var eb = _innerEdgeEndpoints([{x:0,y:100}, {x:50,y:100}], 10, gBelow);
assertPt("art-below E0 (bottom-left corner)",  eb.E0,  0, 110);
assertPt("art-below E1 (bottom-right corner)", eb.E1, 50, 110);

// Art ABOVE (sign -1) -> inner edge = top.
var gAbove = { travelIsX: false, sign: -1 };
var ea = _innerEdgeEndpoints([{x:0,y:100}, {x:50,y:100}], 10, gAbove);
assertPt("art-above E0 (top-left corner)",  ea.E0,  0, 90);
assertPt("art-above E1 (top-right corner)", ea.E1, 50, 90);

// Vertical spine, art to the RIGHT (horizontal travel, sign +1) -> inner edge faces +x.
var gRight = { travelIsX: true, sign: 1 };
var er = _innerEdgeEndpoints([{x:100,y:0}, {x:100,y:40}], 8, gRight);
assertPt("art-right E0", er.E0, 108, 0);
assertPt("art-right E1", er.E1, 108, 40);

// Single-point (circular) spine -> degenerate tangent -> offset along the travel axis.
var es = _innerEdgeEndpoints([{x:5,y:5}], 7, gBelow);
assertPt("circular pill E0 (offset down by r)", es.E0, 5, 12);
assertPt("circular pill E1 (== E0)",            es.E1, 5, 12);

// --- _innerEdgeAt / _shrinkAlongSpine (curve-following balanced shrink) --------

testLog("[seating-test] --- _innerEdgeAt / _shrinkAlongSpine ---");

// Straight horizontal spine, art BELOW (sign +1): inner edge = spine + (0, r). A point at
// fraction t sits on the same straight top → matches the old chord inset (no regression).
var ieS = _innerEdgeAt([{x:0,y:100},{x:100,y:100}], 10, gBelow, 0.15);
assertPt("innerEdgeAt straight t=0.15", ieS, 15, 110);
var shS = _shrinkAlongSpine([{x:0,y:100},{x:100,y:100}], 10, gBelow, 0.15);
assertPt("shrinkAlongSpine straight E0 -> 15%", shS.E0, 15, 110);
assertPt("shrinkAlongSpine straight E1 -> 85%", shS.E1, 85, 110);
assertClose("shrinkAlongSpine keeps centre", (shS.E0.x + shS.E1.x) / 2, 50);

// Curved spine (downward arc, flat apex), art BELOW: the inner edge at t=0.5 must follow the
// ARC (apex y=120 → inner 130), NOT the chord between the ends (y=100 → would give 110). This
// is the bug guard — a chord shrink floats above an arced pill and under-seats it → gap.
var arc = [{x:0,y:100},{x:40,y:120},{x:60,y:120},{x:100,y:100}];
var ieC = _innerEdgeAt(arc, 10, gBelow, 0.5);
assertPt("innerEdgeAt curved t=0.5 follows the arc (not the chord)", ieC, 50, 130);

// --- _kissVector (pin-E0, signed depth, bidirectional) ------------------------

testLog("[seating-test] --- _kissVector ---");
// Art below (sign +1): gap of 5 below the inner edge, depth 3 -> push down 8.
assertClose("kiss: gap 5 + depth 3 -> +8", _kissVector({x:0,y:100}, {x:0,y:105}, gBelow, 3).ty, 8);
// Already 2px into the art, depth 3 -> push 1 more.
assertClose("kiss: shallow overlap -> +1", _kissVector({x:0,y:100}, {x:0,y:98},  gBelow, 3).ty, 1);
// 10px deep, depth 3 -> pull OUT by 7 (bidirectional).
assertClose("kiss: too deep -> -7 (outward)", _kissVector({x:0,y:100}, {x:0,y:90}, gBelow, 3).ty, -7);
// Art above (sign -1): art bottom 5px above the inner edge, depth 3 -> move up 8.
assertClose("kiss: art above -> -8", _kissVector({x:0,y:100}, {x:0,y:95}, gAbove, 3).ty, -8);
// Horizontal travel writes tx, not ty.
var kx = _kissVector({x:100,y:0}, {x:104,y:0}, gRight, 2);
assertClose("kiss: horizontal tx", kx.tx, 6);
assertClose("kiss: horizontal ty", kx.ty, 0);

// --- _rotateSpine / _translateSpine (carried spine tracks the pill) -----------

testLog("[seating-test] --- _rotateSpine / _translateSpine ---");
// +90 deg about the origin in y-down space: (10,0) -> (0,10).
var rot = _rotateSpine([{x:0,y:0}, {x:10,y:0}], {x:0,y:0}, 90);
assertPt("rotate +90 pivot fixed", rot[0], 0, 0);
assertPt("rotate +90 endpoint",    rot[1], 0, 10);
// Rotating about a non-origin pivot leaves the pivot point fixed.
var rotP = _rotateSpine([{x:5,y:5}, {x:15,y:5}], {x:5,y:5}, 90);
assertPt("rotate about pivot: pivot fixed", rotP[0], 5, 5);
var tr = _translateSpine([{x:1,y:2}, {x:3,y:4}], 10, -5);
assertPt("translate s0", tr[0], 11, -3);
assertPt("translate s1", tr[1], 13, -1);

// --- _midProtrusion (convex midpoint bulge, p = sagitta + depth) --------------

testLog("[seating-test] --- _midProtrusion ---");

// Art ABOVE (sign -1) — the Blue Church / Kraslice case. Border facing edge = art BOTTOM.
// Convex bulge: the middle dips DOWN toward the caption (larger y) -> positive sagitta.
assertClose("art-above convex bulge -> sag 12 + depth 3 = 15",
    _midProtrusion({x:0,y:100}, {x:100,y:100}, {x:50,y:112}, gAbove, 3), 15);
// Flat border -> sagitta 0 -> p == depth (no bulge; trigger never fires).
assertClose("art-above flat -> p == depth",
    _midProtrusion({x:0,y:100}, {x:100,y:100}, {x:50,y:100}, gAbove, 3), 3);
// Concave (middle recedes UP, away from caption) -> negative sagitta -> p < depth.
assertClose("art-above concave -> p < depth (-5)",
    _midProtrusion({x:0,y:100}, {x:100,y:100}, {x:50,y:92}, gAbove, 3), -5);

// Art BELOW (sign +1). Border facing edge = art TOP; convex bulge rises UP (smaller y).
assertClose("art-below convex bulge -> 10 + 3 = 13",
    _midProtrusion({x:0,y:100}, {x:100,y:100}, {x:50,y:90}, gBelow, 3), 13);

// Horizontal travel (sign +1, art to the RIGHT). Facing edge = art LEFT; bulge goes -x.
assertClose("art-right convex bulge -> 10 + 2 = 12",
    _midProtrusion({x:100,y:0}, {x:100,y:40}, {x:90,y:20}, gRight, 2), 12);

// Missing midpoint probe (a true mid-notch with no border above it) -> null -> ignore.
assert("null Bm -> null (ignored)",
    _midProtrusion({x:0,y:100}, {x:100,y:100}, null, gAbove, 3), null);

// The shrink relief is real: re-measuring a convex border over the 15%..85% span yields a
// smaller p than the full span (the kiss then pins a deeper point and the pill backs out).
function _convexEdge(x) { return 100 - 12 * Math.pow((x - 50) / 50, 2); }  // art-above bottom
var pFull   = _midProtrusion({x:0, y:_convexEdge(0)},  {x:100, y:_convexEdge(100)},
                             {x:50, y:_convexEdge(50)}, gAbove, 3);
var pShrunk = _midProtrusion({x:15, y:_convexEdge(15)}, {x:85, y:_convexEdge(85)},
                             {x:50, y:_convexEdge(50)}, gAbove, 3);
assertClose("convex full-span p == 15",        pFull,   15, 1e-6);
assertClose("convex shrunk-span p == 8.88",    pShrunk, 8.88, 0.01);
assert("shrink lowers the midpoint protrusion", pShrunk < pFull, true);

// --- SUMMARY ------------------------------------------------------------------

testLog("[seating-test] ====================================");
testLog("[seating-test] " + _passed + " passed, " + _failed + " failed.");

if (!CONFIG.suppressAlerts) {
    alert("Caption-seating unit tests:\n" + _passed + " passed, " + _failed + " failed.\n\n"
        + "Log: " + _logPath);
}
