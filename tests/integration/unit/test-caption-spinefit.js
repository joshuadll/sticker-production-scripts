// tests/integration/test-caption-spinefit.js
// Pure-geometry unit test for the caption spine-fit helpers ported into aiUtils.
// ES3 function bodies are node-compatible; we extract the four _cap* declarations from
// aiUtils.jsx and eval them into scope (dependencies first). Column-0 closing brace (\n})
// ends each match, so nested/indented braces don't terminate it early.
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
eval(extract('_capQuadFitSpine'));

function approx(a, b, t) { return Math.abs(a - b) <= t; }
var fails = 0;

// Straight points (flat line) -> straight = true.
var flat = [];
for (var i = 0; i <= 10; i++) flat.push({ x: i, y: 5 });
var r1 = _capQuadFitSpine(flat, 0, 10, 0.5);
if (!r1.straight) { console.log('FAIL: flat not detected straight'); fails++; }
if (r1.spine.length !== 2) { console.log('FAIL: straight spine should be 2 points'); fails++; }

// Arc points (parabola, sagitta ~3 >> 0.5 snap) -> straight = false, spine follows.
var arc = [];
for (var j = 0; j <= 10; j++) { var x = j; arc.push({ x: x, y: 0.12 * (x - 5) * (x - 5) }); }
var r2 = _capQuadFitSpine(arc, 0, 10, 0.5);
if (r2.straight) { console.log('FAIL: arc wrongly snapped straight'); fails++; }
if (r2.spine.length < 10) { console.log('FAIL: arc spine too coarse'); fails++; }
// Spine should dip in the middle (parabola vertex near x=5 has lower y than the ends).
var midY = r2.spine[Math.floor(r2.spine.length / 2)].y;
if (!(midY < r2.spine[0].y - 1)) { console.log('FAIL: arc spine does not follow the curve'); fails++; }

// Percentile sanity.
if (!approx(_capPercentile([1,2,3,4,5,6,7,8,9,10], 0.9), 9, 0.0001)) { console.log('FAIL: pctile'); fails++; }

// Solve a trivial diagonal system -> identity-ish.
var s = _capSolve3(2,0,0, 0,2,0, 0,0,2, 4,6,8);
if (!s || !approx(s[0],2,1e-6) || !approx(s[1],3,1e-6) || !approx(s[2],4,1e-6)) { console.log('FAIL: solve3'); fails++; }

console.log(fails === 0 ? 'PASS spinefit' : ('FAIL spinefit (' + fails + ' failure(s))'));
process.exit(fails === 0 ? 0 : 1);
