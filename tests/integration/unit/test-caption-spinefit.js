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
eval(extract('_capSlopeAt'));
eval(extract('_capSpinePoints'));
eval(extract('_capColumnSpan'));
eval(extract('_capBandSpan'));
eval(extract('_capRobustBaselineFit'));
eval(extract('_capBottomLineBaseline'));
eval(extract('_capLineCount'));

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

    var bottom = _capBottomLineBaseline(base, true, 12);   // ~12pt line height (gap to top line = 12)
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
    var bottom = _capBottomLineBaseline(base, true, 12);
    var ex0 = bottom[0].x, ex1 = bottom[bottom.length - 1].x;
    var r = _capRobustBaselineFit(bottom, ex0, ex1, SNAP, MIN);
    check(r.straight === false, 'a truly warped 2-line caption must stay curved after bottom-line filter');
})();

// ── 8. Single-line text passes through untouched (no clustering when not multi-line) ──
(function () {
    var base = [], i;
    for (i = 0; i <= 14; i++) base.push({ x: i, y: 100 });
    base[5].y = 90;   // a descender — must NOT be treated as a separate "line"
    var same = _capBottomLineBaseline(base, false, 12);
    check(same.length === base.length, 'single-line (isMultiLine=false) must pass through unchanged');
    // and even if mislabeled multi-line, a lone descender cluster is too small to trust → unchanged
    var safe = _capBottomLineBaseline(base, true, 12);
    check(safe.length === base.length, 'a single stray descender must not split a one-line caption');
})();

// ── 9. Line-break threshold is SIZE-RELATIVE: the same gap splits at a small line height but
//       not at a large one (so a font-size change can't break the gate — replaces the old fixed 3pt) ──
(function () {
    var base = [], i;
    for (i = 0; i <= 80; i++) base.push({ x: i, y: (i >= 20 && i <= 60) ? 100 : 105 }); // gap = 5pt
    var small = _capBottomLineBaseline(base, true, 12);   // threshold 0.3*12=3.6 < 5 → splits
    check(small.length < base.length, 'gap 5pt should split when line height is small (thr 3.6)');
    var large = _capBottomLineBaseline(base, true, 20);   // threshold 0.3*20=6.0 > 5 → no split
    check(large.length === base.length, 'same gap 5pt should NOT split when line height is large (thr 6.0)');
})();

// ── 10. _capLineCount — non-empty visual lines from point-text contents (drives multi-line + line height) ──
(function () {
    check(_capLineCount({ contents: 'Pirohy' }) === 1, 'one line → 1');
    check(_capLineCount({ contents: 'St Elizabeth\'s Cathedral\r(Dóm Svätej Alzbety)' }) === 2, 'two lines → 2');
    check(_capLineCount({ contents: 'A\r\rB' }) === 2, 'blank middle line is not counted');
    check(_capLineCount({ contents: 'A\nB\nC' }) === 3, 'three lines → 3');
})();


// ── 4. END TANGENT: the spine's ends must follow the curve, not flatten ──
// REGRESSION (artist, 2026-07-17): a curved caption produced a pill with HORIZONTAL ends.
// buildCapsuleFromSpine takes each cap's orientation from spine[0]->spine[1], so if the spine
// flattens at its ends the cap is laid perpendicular to a horizontal — axis-aligned — on a pill
// whose end genuinely rises. The old guard clamped the VALUE outside the fitted range
// (y = y(fx0) for every sx < fx0), which is exactly that flattening. It must extend along the
// endpoint TANGENT instead.
//
// Geometry mirrors the real case: the sampler's first baseline point is the MIDPOINT of a 1mm
// band, so fx0 sits ~1.4pt inside the text box while the spine still spans the full box.
(function () {
    var fit = { a: 0.004, b: 0, c: 0, xm: 30 };   // gentle bow, vertex mid-text
    var x0 = 0, x1 = 60, fx0 = 1.42, fx1 = 58.58, halfBody = 0, M = 40;
    var spine = _capSpinePoints(fit, x0, x1, fx0, fx1, halfBody, M);

    check(spine.length === M + 1, 'spine should have M+1 points, got ' + spine.length);
    check(approx(spine[0].x, x0, 1e-9) && approx(spine[M].x, x1, 1e-9),
          'spine must span the full text box [' + x0 + ',' + x1 + ']');

    // The cap tangent buildCapsuleFromSpine will actually use.
    var usedStart = (spine[1].y - spine[0].y) / (spine[1].x - spine[0].x);
    var trueStart = _capSlopeAt(fit, fx0);
    check(approx(usedStart, trueStart, 0.02),
          'START cap tangent must match the fit slope: used ' + usedStart.toFixed(4) +
          ' vs true ' + trueStart.toFixed(4) + ' (a flattened end = the horizontal-cap bug)');

    var usedEnd = (spine[M].y - spine[M - 1].y) / (spine[M].x - spine[M - 1].x);
    var trueEnd = _capSlopeAt(fit, fx1);
    check(approx(usedEnd, trueEnd, 0.02),
          'END cap tangent must match the fit slope: used ' + usedEnd.toFixed(4) +
          ' vs true ' + trueEnd.toFixed(4));

    // Guard the specific failure mode: a near-zero end slope on a genuinely sloped end.
    check(Math.abs(usedStart) > Math.abs(trueStart) * 0.5,
          'START end must not be flattened (|used| ' + Math.abs(usedStart).toFixed(4) +
          ' collapsed vs |true| ' + Math.abs(trueStart).toFixed(4) + ')');
})();

// ── 5. Outside the fitted range the spine extends LINEARLY (no parabola overshoot) ──
// The clamp existed to stop the quadratic flaring past its data — a real concern. A tangent
// extension must keep that property: beyond fx0/fx1 the spine is a straight line, so it can
// never bend away faster than the curve was already going.
(function () {
    var fit = { a: 0.02, b: 0, c: 0, xm: 30 };    // strong curvature -> parabola would flare
    var x0 = 0, x1 = 60, fx0 = 12, fx1 = 48, halfBody = 0, M = 40;   // narrow bottom line
    var spine = _capSpinePoints(fit, x0, x1, fx0, fx1, halfBody, M);

    // collect the points left of fx0 — they must be collinear (a straight tangent extension)
    var out = [], i;
    for (i = 0; i < spine.length; i++) if (spine[i].x < fx0 - 1e-9) out.push(spine[i]);
    check(out.length >= 3, 'test needs >=3 points outside fx0, got ' + out.length);
    var s01 = (out[1].y - out[0].y) / (out[1].x - out[0].x);
    var s12 = (out[2].y - out[1].y) / (out[2].x - out[1].x);
    check(approx(s01, s12, 1e-6), 'outside the fit the spine must be STRAIGHT (slopes ' +
          s01.toFixed(4) + ' vs ' + s12.toFixed(4) + ') — no quadratic flare');
    check(approx(s01, _capSlopeAt(fit, fx0), 1e-6),
          'the extension slope must equal the fit tangent at fx0');

    // and it must not overshoot what the parabola would have done (the original bug it guarded)
    var parabolaY = _capYAt(fit, x0);
    check(Math.abs(out[0].y) < Math.abs(parabolaY),
          'tangent extension must stay inside the parabola extrapolation (' +
          out[0].y.toFixed(2) + ' vs ' + parabolaY.toFixed(2) + ')');
})();

// ── Helper sanity (unchanged) ──
check(approx(_capPercentile([1,2,3,4,5,6,7,8,9,10], 0.9), 9, 0.0001), 'pctile');
var s3 = _capSolve3(2,0,0, 0,2,0, 0,0,2, 4,6,8);
check(s3 && approx(s3[0],2,1e-6) && approx(s3[1],3,1e-6) && approx(s3[2],4,1e-6), 'solve3');

console.log(fails === 0 ? 'PASS spinefit' : ('FAIL spinefit (' + fails + ' failure(s))'));
process.exit(fails === 0 ? 0 : 1);
