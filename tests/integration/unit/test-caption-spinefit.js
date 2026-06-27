// tests/integration/unit/test-caption-spinefit.js
// Pure-geometry unit test for the caption spine-fit helpers in aiUtils.
//
// The pill spine is derived from the text BASELINE (per-column bottom-of-ink), NOT the
// ink midpoint: the baseline is glyph-height-invariant (caps/x-height/ascenders don't move
// it), so straight text fits flat regardless of glyph mix. Descenders (sit below) and
// floating marks like apostrophes/dots (sit above) are robustly rejected (median/MAD).
//
// ES3 function bodies are node-compatible; we extract the declarations from aiUtils.jsx and
// eval them into scope (dependencies first). Column-0 closing brace (\n}) ends each match.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');

function extract(name) {
    var re = new RegExp('function ' + name + '[\\s\\S]*?\\n}');
    var m = src.match(re);
    if (!m) throw new Error('could not extract ' + name + ' from aiUtils.jsx');
    return m[0];
}
// Order matters: dependencies first.
eval(extract('_capSolve3'));
eval(extract('_capPercentile'));
eval(extract('_capStraightSpine'));
eval(extract('_capYAt'));
eval(extract('_capColumnSpan'));
eval(extract('_capBandSpan'));
eval(extract('_capRobustBaselineFit'));

function approx(a, b, t) { return Math.abs(a - b) <= t; }
var fails = 0;
function check(cond, msg) { if (!cond) { console.log('FAIL: ' + msg); fails++; } }

var SNAP = 1.7;   // ~0.6mm @ 72dpi
var MIN  = 8;

// ── 1. Straight baseline with glyph noise + descenders + floating marks → STRAIGHT ──
// Baseline flat at y=100. Descenders (cols 5,6) dip to 90; a floating mark (col 10) sits at 115.
// The robust fit must reject those 3 outliers and report a flat, straight baseline.
(function () {
    var pts = [];
    for (var i = 0; i <= 14; i++) pts.push({ x: i, y: 100 });
    pts[5].y = 90; pts[6].y = 90;     // descenders (below)
    pts[10].y = 115;                  // floating mark (above)
    var r = _capRobustBaselineFit(pts, 0, 14, SNAP, MIN);
    check(r.straight === true, 'flat-with-outliers should be straight (got curved, bow=' + (r.bow||0).toFixed(2) + ')');
    check(r.bow < 0.5, 'flat baseline bow should be ~0, got ' + (r.bow||0).toFixed(2));
    check(r.nIn <= 13, 'should reject the 3 outliers (nIn=' + r.nIn + ' of 15)');
})();

// ── 2. Genuinely arced baseline (+ outliers) → CURVED, fit follows the arc ──
(function () {
    var pts = [];
    for (var i = 0; i <= 14; i++) { var x = i; pts.push({ x: x, y: 100 + 0.4 * (x - 7) * (x - 7) }); }
    pts[3].y -= 9;    // a descender outlier on the arc
    pts[11].y += 12;  // a floating-mark outlier on the arc
    var r = _capRobustBaselineFit(pts, 0, 14, SNAP, MIN);
    check(r.straight === false, 'arced baseline should be curved');
    check(r.bow > 5, 'arc bow should be large, got ' + (r.bow||0).toFixed(2));
    // This parabola has its vertex (minimum) at x=7, so the middle sits below the ends.
    var midY = _capYAt(r.fit, 7), endY = _capYAt(r.fit, 0);
    check(midY < endY - 3, 'curved fit should follow the arc (mid below ends)');
})();

// ── 3. Too few columns → STRAIGHT (can't trust a curve from sparse data) ──
(function () {
    var pts = [{x:0,y:5},{x:1,y:5},{x:2,y:9},{x:3,y:5},{x:4,y:5}];   // 5 < MIN
    var r = _capRobustBaselineFit(pts, 0, 4, SNAP, MIN);
    check(r.straight === true, 'sparse columns should force straight');
})();

// ── 4. Pure flat, no outliers → STRAIGHT, bow 0, nothing rejected ──
(function () {
    var pts = [];
    for (var i = 0; i <= 11; i++) pts.push({ x: i, y: 50 });
    var r = _capRobustBaselineFit(pts, 0, 11, SNAP, MIN);
    check(r.straight === true, 'pure flat should be straight');
    check(approx(r.bow, 0, 0.01), 'pure flat bow should be 0, got ' + (r.bow||0).toFixed(3));
    check(r.nIn === 12, 'pure flat should keep all 12 points, got ' + r.nIn);
})();

// ── 5. _capBandSpan: union of vertical span over a band of sub-scanlines ──
(function () {
    var square = [{x:2,y:10},{x:8,y:10},{x:8,y:20},{x:2,y:20}];
    var s = _capBandSpan([square], 3, 7, 8);
    check(s !== null && approx(s.lo, 10, 0.001) && approx(s.hi, 20, 0.001),
          'band inside square should span 10..20, got ' + JSON.stringify(s));
    var out = _capBandSpan([square], 20, 25, 8);   // band right of the square
    check(out === null, 'band outside the geometry should be null, got ' + JSON.stringify(out));
})();

// ── Helper sanity (unchanged) ──
check(approx(_capPercentile([1,2,3,4,5,6,7,8,9,10], 0.9), 9, 0.0001), 'pctile');
var s3 = _capSolve3(2,0,0, 0,2,0, 0,0,2, 4,6,8);
check(s3 && approx(s3[0],2,1e-6) && approx(s3[1],3,1e-6) && approx(s3[2],4,1e-6), 'solve3');

console.log(fails === 0 ? 'PASS spinefit' : ('FAIL spinefit (' + fails + ' failure(s))'));
process.exit(fails === 0 ? 0 : 1);
