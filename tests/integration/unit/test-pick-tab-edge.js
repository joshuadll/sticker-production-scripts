// Pure-geometry unit test for pickTabEdge + helpers (aiUtils.jsx). y-UP coords, AI points.
// pickTabEdge calls samplePathToPolygons, which needs the Adobe DOM — so the test injects a
// fake samplePathToPolygons that returns a supplied polygon, isolating the pure edge logic.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '[\\s\\S]*?\\n}');
    var m = src.match(re);
    if (!m) throw new Error('could not extract ' + name);
    return m[0];
}
eval(extract('pointsToMm'));
eval(extract('_angDiff180'));
eval(extract('_polyCentroid'));
eval(extract('_edgeRadialAlign'));
eval(extract('_polyBbox'));
eval(extract('_largestPoly'));
eval(extract('pickTabEdge'));

// Fakes used by pickTabEdge's body:
var FAKE_POLY = null;
function samplePathToPolygons() { return [FAKE_POLY]; }
var mmToPoints = function (mm) { return mm * 2.834645; }; // only for tolerance math if referenced

var fails = 0;
function check(cond, msg) { if (!cond) { console.log('FAIL: ' + msg); fails++; } }
function approx(a, b, t) { return Math.abs(a - b) <= (t == null ? 1e-6 : t); }
var HALF_PI = Math.PI / 2;

// ── Wide rectangle: longest edges are the two horizontals (length 100 vs 40). ──
// Bottom edge y=0 (y-up), top y=40, centroid at y=20. The chosen edge is horizontal
// (dirAngle 0 or π) and the outward normal points away from centroid (down = -π/2 for
// the bottom edge, up = +π/2 for the top edge). Either horizontal edge is acceptable;
// assert the edge is horizontal and the outward normal is vertical & points away.
(function () {
    FAKE_POLY = [{x:0,y:0},{x:100,y:0},{x:100,y:40},{x:0,y:40}];
    var e = pickTabEdge({}, { steps: 1, straightToleranceDeg: 5 });
    check(e.ok, 'rect: ok');
    check(approx(e.lengthMm, pointsToMm(100), 0.01), 'rect: longest edge is 100pt, got ' + e.lengthMm);
    check(approx(_angDiff180(e.dirAngle, 0), 0, 1e-6), 'rect: chosen edge is horizontal');
    // outward normal vertical:
    check(approx(_angDiff180(e.outwardAngle, HALF_PI), 0, 1e-6), 'rect: outward normal is vertical');
    // outward points away from centroid (y=20): midY<20 -> sin<0 ; midY>20 -> sin>0
    var away = (e.midY < 20) ? (Math.sin(e.outwardAngle) < 0) : (Math.sin(e.outwardAngle) > 0);
    check(away, 'rect: outward normal points away from centroid');
})();

// ── Diagonal edge is the longest. Right triangle with hypotenuse from (0,0)->(120,120)
// (length ~169) vs legs 120. Chosen edge dir ~45deg. ──
(function () {
    FAKE_POLY = [{x:0,y:0},{x:120,y:0},{x:120,y:120}];
    // edges: (0,0)-(120,0)=120 ; (120,0)-(120,120)=120 ; (120,120)-(0,0)=169.7 (hypotenuse)
    var e = pickTabEdge({}, { steps: 1, straightToleranceDeg: 5 });
    check(e.ok, 'tri: ok');
    check(approx(e.lengthMm, pointsToMm(Math.sqrt(120*120+120*120)), 0.05), 'tri: longest is hypotenuse');
    check(approx(_angDiff180(e.dirAngle, Math.PI/4), 0, 1e-6), 'tri: edge dir ~45deg');
})();

// ── Collinear run across multiple samples merges into one edge ──
(function () {
    // bottom split into 3 collinear samples; should still measure ~150 total span.
    FAKE_POLY = [{x:0,y:0},{x:50,y:0},{x:100,y:0},{x:150,y:0},{x:150,y:30},{x:0,y:30}];
    var e = pickTabEdge({}, { steps: 1, straightToleranceDeg: 5 });
    check(e.ok, 'collinear: ok');
    check(approx(e.lengthMm, pointsToMm(150), 0.01), 'collinear: merged span is 150pt, got ' + e.lengthMm);
})();

// ── _edgeRadialAlign: cos between the outward normal and the centroid→midpoint radial. ──
(function () {
    check(approx(_edgeRadialAlign(0, 40, 0, 1, 0, 0), 1, 1e-9), 'align: normal radial (up) = 1');
    check(approx(_edgeRadialAlign(0, 40, 1, 0, 0, 0), 0, 1e-9), 'align: normal tangential = 0');
    check(approx(_edgeRadialAlign(0, 40, Math.SQRT1_2, Math.SQRT1_2, 0, 0), Math.SQRT1_2, 1e-9), 'align: 45deg ~0.707');
    check(approx(_edgeRadialAlign(0, 0, 1, 0, 0, 0), 1, 1e-9), 'align: mid==centroid -> 1');
})();

// ── Radial preference distinguishes the scoring from pure-longest. A square (x -40..40,
// y -40..40) with a long thin SPIKE on the right pulls the vertex centroid to x=40. Several
// edges are ~80pt long, but the LEFT edge's normal points straight away from the centroid
// (align 1) while the top/bottom are tilted (align ~0.707) and the spike runs radially
// (align ~0.12). So the LEFT edge wins and the tab points left (outward ~π) — the tab faces
// "away" from the bulk. Pure-longest would have tied/picked a different ~80pt edge. ──
(function () {
    FAKE_POLY = [{x:-40,y:40},{x:40,y:40},{x:40,y:5},{x:120,y:2},{x:120,y:-2},{x:40,y:-5},{x:40,y:-40},{x:-40,y:-40}];
    var e = pickTabEdge({}, { steps: 1, straightToleranceDeg: 5 });
    check(e.ok, 'radial: ok');
    check(approx(_angDiff180(e.outwardAngle, Math.PI), 0, 1e-6), 'radial: chosen edge faces left (outward ~pi), got ' + (e.outwardAngle * 180 / Math.PI));
    check(e.midX < -30, 'radial: chosen edge is the left edge (midX ~ -40), got ' + e.midX);
})();

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
