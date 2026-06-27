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

console.log(fails === 0 ? 'PASS warpfit' : ('FAIL warpfit (' + fails + ' failure(s))'));
process.exit(fails === 0 ? 0 : 1);
