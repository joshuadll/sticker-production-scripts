// Pure-geometry unit test for the half-cut endpoint TAIL DIRECTION (aiUtils.jsx). y-UP coords.
//
// The 1mm peel-tab extension at each half-cut end must run ALONG the cut contour AWAY from the
// caption (into the body). The old picker chose the branch farther from the plate outline, which
// TIES on curved/small elements and can pick the branch that runs BACK over the caption — the
// spike + "doesn't follow the curve" the artist reported on Čumil. _pickTailDir chooses the
// branch whose probe endpoint is farther from the caption-seam centroid (a robust "away from the
// caption" signal).
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '\\s*\\([\\s\\S]*?\\n}');
    var m = src.match(re); if (!m) throw new Error('could not extract ' + name); return m[0];
}
eval(extract('_walkCutPolyArc'));
eval(extract('_pickTailDir'));

var fails = 0;
function check(c, m) { if (!c) { console.log('FAIL: ' + m); fails++; } }

// CCW square contour, edges: 0 bottom, 1 right, 2 top, 3 left.
var SQ = [{x:-50,y:-50},{x:50,y:-50},{x:50,y:50},{x:-50,y:50}];
var PROBE = 4;

// Junction on the RIGHT edge (edge 1), caption seam centroid just BELOW it -> tail must go UP
// (dir +1, toward (50,50)), away from the caption.
(function () {
    var P = {x:50, y:-10};
    var dir = _pickTailDir(SQ, P, 1, {x:50,y:-45}, PROBE);
    check(dir === 1, 'right edge, caption below -> tail up/+1 (got ' + dir + ')');
})();

// Junction on the LEFT edge (edge 3), caption seam centroid just BELOW it -> tail must go DOWN
// along the left edge toward (-50,-50)? No: away from caption(below) = UP. On edge 3 (from
// (-50,50) to (-50,-50)), +1 heads toward (-50,-50) i.e. DOWN (toward caption); -1 heads UP
// (away). So dir must be -1.
(function () {
    var P = {x:-50, y:-10};
    var dir = _pickTailDir(SQ, P, 3, {x:-50,y:-45}, PROBE);
    check(dir === -1, 'left edge, caption below -> tail up/-1 (got ' + dir + ')');
})();

// Junction on the BOTTOM edge (edge 0), caption seam centroid to the LEFT -> tail must go RIGHT
// (away from caption). Edge 0 from (-50,-50) to (50,-50): +1 heads right. dir must be +1.
(function () {
    var P = {x:0, y:-50};
    var dir = _pickTailDir(SQ, P, 0, {x:-45,y:-50}, PROBE);
    check(dir === 1, 'bottom edge, caption left -> tail right/+1 (got ' + dir + ')');
})();

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
