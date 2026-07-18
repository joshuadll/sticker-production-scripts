// Pure-geometry unit test for _capArcToCrossing (aiUtils.jsx). y-UP coords.
//
// The half-cut seam must follow the caption plate's edge — including the submerged part of the
// rounded cap — up to the art∩caption crossing, instead of chording straight across it. From the
// last inner-edge vertex, _capArcToCrossing walks the plate loop collecting each still-submerged
// vertex, then stops at the crossing (returned as the last point, on the art border).
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '\\s*\\([\\s\\S]*?\\n}');
    var m = src.match(re); if (!m) throw new Error('could not extract ' + name); return m[0];
}
eval(extract('pointInPolygon'));
eval(extract('_pointInPolysEO'));
eval(extract('_segCrossArt'));
eval(extract('_capArcToCrossing'));

var fails = 0;
function check(c, m) { if (!c) { console.log('FAIL: ' + m); fails++; } }
function near(a, b, tol, m) { check(Math.abs(a - b) <= (tol || 1e-6), m + ' (got ' + a + ', want ' + b + ')'); }

// Art occupies y <= 0 (a wide rectangle). A plate vertex is "inside" when y < 0.
var ART = [[{x:-100,y:-100},{x:100,y:-100},{x:100,y:0},{x:-100,y:0}]];

// Plate loop: A,B,C submerged (y<0), D,E exposed (y>0). Walking +1 from A should collect the
// still-submerged cap vertices B, C, then stop at the crossing between C (in) and D (out) at y≈0.
var PP = [{x:0,y:-30},{x:5,y:-20},{x:8,y:-5},{x:10,y:10},{x:5,y:20}];
var INSIDE = [];
for (var i = 0; i < PP.length; i++) INSIDE.push(PP[i].y < 0);

(function () {
    var arc = _capArcToCrossing(PP, INSIDE, ART, 0, 1);
    check(arc !== null && arc.length === 3, 'collected 2 cap verts + crossing (got ' + (arc ? arc.length : 'null') + ')');
    near(arc[0].x, 5, 1e-9, 'first collected vert = B.x');
    near(arc[0].y, -20, 1e-9, 'first collected vert = B.y');
    near(arc[1].x, 8, 1e-9, 'second collected vert = C.x');
    near(arc[1].y, -5, 1e-9, 'second collected vert = C.y');
    near(arc[2].y, 0, 1e-4, 'crossing lands on the art border (y=0)');
    near(arc[2].x, 8.667, 1e-2, 'crossing x interpolated between C and D');
})();

// Immediate crossing: start vertex's neighbour is already exposed → just [crossing], no cap verts.
(function () {
    var pp2 = [{x:0,y:-5},{x:2,y:10},{x:-2,y:10}];
    var in2 = [true, false, false];
    var arc = _capArcToCrossing(pp2, in2, ART, 0, 1);
    check(arc !== null && arc.length === 1, 'immediate crossing -> [crossing] only (got ' + (arc ? arc.length : 'null') + ')');
    near(arc[0].y, 0, 1e-4, 'crossing on art border');
})();

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
