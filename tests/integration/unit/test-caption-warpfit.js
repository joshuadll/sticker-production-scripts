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

console.log(fails === 0 ? 'PASS warpfit' : ('FAIL warpfit (' + fails + ' failure(s))'));
process.exit(fails === 0 ? 0 : 1);
