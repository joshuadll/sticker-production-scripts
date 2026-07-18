// Pure-geometry unit test for the half-cut endpoint TAIL DIRECTION (aiUtils.jsx). y-UP coords.
//
// The seam now ends at the art∩caption crossing. From there the cut line leaves two ways: down
// the ART path (which peels AWAY from the caption plate) or along the caption's exposed edge
// (which HUGS the plate). The 1mm peel-tab tail must run down the ART path. _pickTailDir probes
// each way and takes the branch whose endpoint is FARTHER from the plate outline.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '\\s*\\([\\s\\S]*?\\n}');
    var m = src.match(re); if (!m) throw new Error('could not extract ' + name); return m[0];
}
eval(extract('_ptSegClosestSq'));
eval(extract('_minDist2ToPolyEdges'));
eval(extract('_walkCutPolyArc'));
eval(extract('_pickTailDir'));

var fails = 0;
function check(c, m) { if (!c) { console.log('FAIL: ' + m); fails++; } }

// CCW square cut contour, edges: 0 bottom, 1 right, 2 top, 3 left.
var SQ = [{x:-50,y:-50},{x:50,y:-50},{x:50,y:50},{x:-50,y:50}];
var PROBE = 4;

// Junction on the RIGHT edge (edge 1), plate (caption) just BELOW it -> tail must run UP (dir +1,
// toward (50,50)), away from the plate.
(function () {
    var plate = [{x:45,y:-50},{x:55,y:-50},{x:55,y:-40},{x:45,y:-40}];   // near the bottom
    var dir = _pickTailDir(SQ, {x:50,y:-10}, 1, plate, PROBE);
    check(dir === 1, 'right edge, plate below -> tail up/+1 (got ' + dir + ')');
})();

// Junction on the RIGHT edge, plate just ABOVE it -> tail must run DOWN (dir -1), away from plate.
(function () {
    var plate = [{x:45,y:40},{x:55,y:40},{x:55,y:50},{x:45,y:50}];       // near the top
    var dir = _pickTailDir(SQ, {x:50,y:10}, 1, plate, PROBE);
    check(dir === -1, 'right edge, plate above -> tail down/-1 (got ' + dir + ')');
})();

// Junction on the BOTTOM edge (edge 0), plate to the RIGHT -> tail must run LEFT (dir -1),
// away from the plate. Edge 0 from (-50,-50) to (50,-50): +1 heads right (toward plate), -1 left.
(function () {
    var plate = [{x:40,y:-55},{x:50,y:-55},{x:50,y:-45},{x:40,y:-45}];   // near the right
    var dir = _pickTailDir(SQ, {x:0,y:-50}, 0, plate, PROBE);
    check(dir === -1, 'bottom edge, plate right -> tail left/-1 (got ' + dir + ')');
})();

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
