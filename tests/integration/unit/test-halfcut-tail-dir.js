// Pure-geometry unit test for the half-cut endpoint TAIL DIRECTION (aiUtils.jsx). y-UP coords.
//
// The seam ends at the art∩caption crossing. From there the cut line leaves two ways: down the
// ART path (which peels AWAY from the caption plate) or along the caption's exposed edge (which
// HUGS the plate). The 1mm peel-tab tail must run down the ART path.
//
// _pickTailDir(cutPoly, P, edgeIdx, platePoly, artPoly, probe) walks `probe` arc length each way:
//   * PRIMARY (artPoly given): take the branch that stays CLOSER to the ART OUTLINE, summed over
//     the walk. The art branch lies ON the art outline (sum ≈ 0); the caption branch peels onto
//     the plate (sum large). Robust regardless of element size/tilt — no near-tie fallback.
//   * LEGACY FALLBACK (artPoly null/absent): the pre-d466fe5 heuristic — take the branch whose
//     endpoint is FARTHER from the plate, breaking a near-tie by summed distance-to-plate.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '\\s*\\([\\s\\S]*?\\n}');
    var m = src.match(re); if (!m) throw new Error('could not extract ' + name); return m[0];
}
var log = function () {};   // stub the side-effect log used by _pickTailDir's near-tie branch
eval(extract('mmToPoints'));
eval(extract('_ptSegClosestSq'));
eval(extract('_minDist2ToPolyEdges'));
eval(extract('_sumDist2ToPoly'));
eval(extract('_walkCutPolyArc'));
eval(extract('_pickTailDir'));

var fails = 0;
function check(c, m) { if (!c) { console.log('FAIL: ' + m); fails++; } }

// CCW square cut contour, edges: 0 bottom, 1 right, 2 top, 3 left.
var SQ = [{x:-50,y:-50},{x:50,y:-50},{x:50,y:50},{x:-50,y:50}];
var PROBE = 4;

// ---------------------------------------------------------------------------------------------
// PRIMARY PATH — art-outline proximity. The tail follows whichever branch coincides with the ART
// outline. artPoly is a half-plane polygon whose boundary runs along the cut contour on the art
// side; the branch that hugs it sums ≈0 and wins.
// ---------------------------------------------------------------------------------------------

// Junction on the RIGHT edge (edge 1) at (50,10). Art occupies the LOWER half, so the art outline
// runs down the right edge below the junction -> tail must run DOWN (dir -1) onto the art.
(function () {
    var art   = [{x:-50,y:-50},{x:50,y:-50},{x:50,y:10},{x:-50,y:10}];   // bottom half
    var plate = [{x:45,y:40},{x:55,y:40},{x:55,y:50},{x:45,y:50}];       // caption up top (unused by primary)
    var dir = _pickTailDir(SQ, {x:50,y:10}, 1, plate, art, PROBE);
    check(dir === -1, 'right edge, art below -> tail down/-1 (got ' + dir + ')');
})();

// Junction on the RIGHT edge at (50,10). Art occupies the UPPER half -> tail must run UP (dir +1).
(function () {
    var art   = [{x:-50,y:10},{x:50,y:10},{x:50,y:50},{x:-50,y:50}];     // top half
    var plate = [{x:45,y:-50},{x:55,y:-50},{x:55,y:-40},{x:45,y:-40}];   // caption at bottom (unused by primary)
    var dir = _pickTailDir(SQ, {x:50,y:10}, 1, plate, art, PROBE);
    check(dir === 1, 'right edge, art above -> tail up/+1 (got ' + dir + ')');
})();

// Junction on the BOTTOM edge (edge 0) at (0,-50). Art occupies the LEFT half, so the art outline
// runs left along the bottom edge -> tail must run LEFT (dir -1). Edge 0 goes (-50,-50)->(50,-50):
// +1 heads right, -1 heads left.
(function () {
    var art   = [{x:-50,y:-50},{x:0,y:-50},{x:0,y:50},{x:-50,y:50}];     // left half
    var plate = [{x:40,y:-55},{x:50,y:-55},{x:50,y:-45},{x:40,y:-45}];   // caption to the right (unused by primary)
    var dir = _pickTailDir(SQ, {x:0,y:-50}, 0, plate, art, PROBE);
    check(dir === -1, 'bottom edge, art left -> tail left/-1 (got ' + dir + ')');
})();

// ---------------------------------------------------------------------------------------------
// LEGACY FALLBACK — no art outline (artPoly = null). Falls back to farther-from-plate. These are
// the original pre-rework cases; the tail runs AWAY from the caption plate.
// ---------------------------------------------------------------------------------------------

// Junction on the RIGHT edge, plate just BELOW it -> tail must run UP (dir +1), away from the plate.
(function () {
    var plate = [{x:45,y:-50},{x:55,y:-50},{x:55,y:-40},{x:45,y:-40}];   // near the bottom
    var dir = _pickTailDir(SQ, {x:50,y:-10}, 1, plate, null, PROBE);
    check(dir === 1, 'legacy: right edge, plate below -> tail up/+1 (got ' + dir + ')');
})();

// Junction on the RIGHT edge, plate just ABOVE it -> tail must run DOWN (dir -1), away from plate.
(function () {
    var plate = [{x:45,y:40},{x:55,y:40},{x:55,y:50},{x:45,y:50}];       // near the top
    var dir = _pickTailDir(SQ, {x:50,y:10}, 1, plate, null, PROBE);
    check(dir === -1, 'legacy: right edge, plate above -> tail down/-1 (got ' + dir + ')');
})();

// Junction on the BOTTOM edge (edge 0), plate to the RIGHT -> tail must run LEFT (dir -1),
// away from the plate. Edge 0 from (-50,-50) to (50,-50): +1 heads right (toward plate), -1 left.
(function () {
    var plate = [{x:40,y:-55},{x:50,y:-55},{x:50,y:-45},{x:40,y:-45}];   // near the right
    var dir = _pickTailDir(SQ, {x:0,y:-50}, 0, plate, null, PROBE);
    check(dir === -1, 'legacy: bottom edge, plate right -> tail left/-1 (got ' + dir + ')');
})();

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
