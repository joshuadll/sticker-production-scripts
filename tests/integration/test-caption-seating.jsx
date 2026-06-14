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

// --- _shrinkEndpoints (balanced 15% inset stays centred) ----------------------

testLog("[seating-test] --- _shrinkEndpoints ---");
var sh = _shrinkEndpoints({x:0,y:0}, {x:100,y:0}, 0.15);
assertPt("shrink 15% E0 -> 15", sh.E0, 15, 0);
assertPt("shrink 15% E1 -> 85", sh.E1, 85, 0);
// midpoint preserved (centred mask)
assertClose("shrink keeps centre", (sh.E0.x + sh.E1.x) / 2, 50);

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

// --- SUMMARY ------------------------------------------------------------------

testLog("[seating-test] ====================================");
testLog("[seating-test] " + _passed + " passed, " + _failed + " failed.");

if (!CONFIG.suppressAlerts) {
    alert("Caption-seating unit tests:\n" + _passed + " passed, " + _failed + " failed.\n\n"
        + "Log: " + _logPath);
}
