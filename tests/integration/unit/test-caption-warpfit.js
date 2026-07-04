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
// Task 2 extracts only what _capBottomProfile needs. Task 3 appends more extracts
// (_capSolve3, _capYAt, _capRobustBaselineFit, _capBaseArcFit) directly below these.
eval(extract('_capColumnSpan'));
eval(extract('_capBottomProfile'));
eval(extract('_capSolve3'));
eval(extract('_capYAt'));
eval(extract('_capRobustBaselineFit'));
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

// ── _capBaseArcFit gates. Roundness is SIZE-RELATIVE: warp when the curve's circle is no bigger
// than the element (radius <= tightFactor*elementWidth) OR the edge clearly dips across the caption
// (bow). Tests pass the element width so the size-relative rule is exercised. ──
function profile(fn) { var p = [], x; for (x = 0; x <= 120; x += 2) p.push({ x: x, y: fn(x) }); return p; }
function profileN(fn, xmax, step) { var p = [], x; for (x = 0; x <= xmax; x += step) p.push({ x: x, y: fn(x) }); return p; }
function opt(elWidthPt) { return { minCols: 8, minBowPt: 1.42, maxResidPt: 1.42, tightFactor: 1.0, elementWidthPt: elWidthPt }; }

// 1. Flat base -> NO warp
(function () {
    var r = _capBaseArcFit(profile(function (x) { return 100; }), 0, 120, opt(200));
    check(r.warp === false, 'flat base should not warp (' + r.reason + ')');
})();

// 2. Wavy-but-flat base (sine, amp 3pt) -> NO warp (residual gate)
(function () {
    var r = _capBaseArcFit(profile(function (x) { return 100 + 3 * Math.sin(x / 6); }), 0, 120, opt(200));
    check(r.warp === false, 'wavy-flat base should not warp (' + r.reason + ')');
})();

// 3. Clear dip (high bow) -> WARP via the dip rule, positive (valley) bend
(function () {
    var r = _capBaseArcFit(profile(function (x) { return 100 + 0.0018 * (x - 60) * (x - 60); }), 0, 120, opt(200));
    check(r.warp === true, 'clearly-dipping arc should warp (' + r.reason + ')');
    check(r.bend > 0, 'valley (a>0) should give positive bend, got ' + r.bend);
})();

// 4. Pirohy case: SHORT caption span (0..40), gentle bow (~1.25 < deadband) but the curve's circle
//    (R~160) is smaller than the WIDE element (200) -> WARP via the size-relative rule.
(function () {
    var p = profileN(function (x) { return 100 + 0.003125 * (x - 20) * (x - 20); }, 40, 1);
    var r = _capBaseArcFit(p, 0, 40, opt(200));
    check(r.warp === true, 'tight-circle-vs-wide-element should warp (' + r.reason + ')');
})();

// 5. Castle case: SAME gentle arc, but a NARROW element (100) -> the circle (R~160) is BIGGER than
//    the element and the bow is under the deadband -> NO warp (flat relative to its size).
(function () {
    var p = profileN(function (x) { return 100 + 0.003125 * (x - 20) * (x - 20); }, 40, 1);
    var r = _capBaseArcFit(p, 0, 40, opt(100));
    check(r.warp === false, 'gentle arc on a narrow element should stay flat (' + r.reason + ')');
})();

// 6. Central notch (2 sharp dips) -> NO warp (residual / outlier rejection)
(function () {
    var p = profile(function (x) { return 100; });
    p[29].y = 60; p[31].y = 60;   // sharp central spikes
    var r = _capBaseArcFit(p, 0, 120, opt(200));
    check(r.warp === false, 'central notch should not warp (' + r.reason + ')');
})();

// 7. Mildly-tilted balanced arc -> WARP (tilt cap, 2026-07-04). Vertex sits left of the span centre
//    in the VERTICAL frame, but the chord tilt is gentle (~9deg). The old vertical-vertex "symmetry"
//    gate wrongly rejected this as off-centre; the tilt-cap model warps it, because a quadratic can
//    only be tilted (not skewed) and the Run-2 seat supplies the tilt. (Kapustnica's class.)
(function () {
    var r = _capBaseArcFit(profile(function (x) { return 100 + 0.0018 * (x - 15) * (x - 15); }), 0, 120, opt(200));
    check(r.warp === true, 'mildly-tilted balanced arc should warp (' + r.reason + ')');
})();

// 8. Steeply-tilted base (caption on the side of a small circle) -> NO warp (tilt cap). The chord
//    climbs ~70deg over the span; warping+seating it would run the caption up the side.
(function () {
    var r = _capBaseArcFit(profileN(function (x) { return 0.02 * (x + 40) * (x + 40); }, 60, 1), 0, 60, opt(200));
    check(r.warp === false, 'steeply-tilted base should stay flat (' + r.reason + ')');
    check(/too tilted/.test(r.reason), 'steep base should be rejected by the tilt cap (' + r.reason + ')');
})();

console.log(fails === 0 ? 'PASS warpfit' : ('FAIL warpfit (' + fails + ' failure(s))'));
process.exit(fails === 0 ? 0 : 1);
