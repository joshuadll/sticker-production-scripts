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
eval(extract('_capBottomLineBaseline'));

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

// ── 6. Multi-line, narrow bottom line → full envelope fakes a curve; bottom-line filter is flat ──
// Models a "A | B" caption whose bottom line (B) is narrower than the top (A): the per-column
// bottom-of-ink jumps UP to the top line's baseline at the edge columns the bottom line doesn't
// cover, so the full-width envelope reads as a ∪ valley. _capBottomLineBaseline must keep only the
// bottom line, which is flat. (This is the St Elizabeth's bug: a flat 2-line caption seen as curved.)
(function () {
    var base = [], i;
    for (i = 0; i <= 80; i++) {
        // bottom line covers x in [20,60]; outside it only the top line (higher baseline) shows
        var y = (i >= 20 && i <= 60) ? 100 : 112;
        base.push({ x: i, y: y });
    }
    var full = _capRobustBaselineFit(base, 0, 80, SNAP, MIN);
    check(full.straight === false, 'pre-fix: full envelope of narrow-bottom 2-line should read curved');

    var bottom = _capBottomLineBaseline(base, true);
    check(bottom.length < base.length, 'bottom-line filter should drop the upper-line edge columns');
    var ex0 = bottom[0].x, ex1 = bottom[bottom.length - 1].x;
    var r = _capRobustBaselineFit(bottom, ex0, ex1, SNAP, MIN);
    check(r.straight === true, 'bottom-line of a flat 2-line caption should be straight (bow=' + (r.bow||0).toFixed(2) + ')');
})();

// ── 7. Multi-line that is GENUINELY warped → bottom line still reads curved (don't over-flatten) ──
(function () {
    var base = [], i;
    for (i = 0; i <= 80; i++) {
        var arc = 100 + 0.05 * (i - 40) * (i - 40);          // bottom line bows
        var y = (i >= 20 && i <= 60) ? arc : (arc + 12);     // top line 12pt above, same bow
        base.push({ x: i, y: y });
    }
    var bottom = _capBottomLineBaseline(base, true);
    var ex0 = bottom[0].x, ex1 = bottom[bottom.length - 1].x;
    var r = _capRobustBaselineFit(bottom, ex0, ex1, SNAP, MIN);
    check(r.straight === false, 'a truly warped 2-line caption must stay curved after bottom-line filter');
})();

// ── 8. Single-line text passes through untouched (no clustering when not multi-line) ──
(function () {
    var base = [], i;
    for (i = 0; i <= 14; i++) base.push({ x: i, y: 100 });
    base[5].y = 90;   // a descender — must NOT be treated as a separate "line"
    var same = _capBottomLineBaseline(base, false);
    check(same.length === base.length, 'single-line (isMultiLine=false) must pass through unchanged');
    // and even if mislabeled multi-line, a lone descender cluster is too small to trust → unchanged
    var safe = _capBottomLineBaseline(base, true);
    check(safe.length === base.length, 'a single stray descender must not split a one-line caption');
})();

// ── Helper sanity (unchanged) ──
check(approx(_capPercentile([1,2,3,4,5,6,7,8,9,10], 0.9), 9, 0.0001), 'pctile');
var s3 = _capSolve3(2,0,0, 0,2,0, 0,0,2, 4,6,8);
check(s3 && approx(s3[0],2,1e-6) && approx(s3[1],3,1e-6) && approx(s3[2],4,1e-6), 'solve3');

console.log(fails === 0 ? 'PASS spinefit' : ('FAIL spinefit (' + fails + ' failure(s))'));
process.exit(fails === 0 ? 0 : 1);
