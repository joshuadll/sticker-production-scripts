// Pure-geometry unit test for the upright-rotation core (aiUtils.jsx). y-UP coords.
// _uprightRotationDeg(refPts, artPts) returns the degrees to rotate an element so its
// caption reference is horizontal AND below the art (the Step-6 design orientation).
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '[\\s\\S]*?\\n}');
    var m = src.match(re); if (!m) throw new Error('could not extract ' + name); return m[0];
}
eval(extract('_anchorCentroid'));
eval(extract('_longAxisAngleDeg'));
eval(extract('_uprightRotationDeg'));

var fails = 0;
function check(c, m) { if (!c) { console.log('FAIL: ' + m); fails++; } }
function near(a, b, tol, m) { check(Math.abs(a - b) <= (tol || 1e-6), m + ' (got ' + a + ', want ' + b + ')'); }

// ── _anchorCentroid ──
(function () {
    check(_anchorCentroid([]) === null, 'centroid: empty -> null');
    var c = _anchorCentroid([{x:0,y:0},{x:10,y:20},{x:20,y:40}]);
    near(c.x, 10, 1e-9, 'centroid x'); near(c.y, 20, 1e-9, 'centroid y');
})();

// ── _longAxisAngleDeg (farthest pair direction, modulo sign of the pair order) ──
(function () {
    check(_longAxisAngleDeg([{x:0,y:0}]) === null, 'longaxis: <2 pts -> null');
    // Horizontal pill: ends at (-50,0),(50,0) with mid noise -> 0deg (or 180, same axis).
    var h = _longAxisAngleDeg([{x:-50,y:0},{x:0,y:3},{x:50,y:0}]);
    check(Math.abs(h) < 1e-6 || Math.abs(Math.abs(h) - 180) < 1e-6, 'longaxis: horizontal -> 0/180, got ' + h);
    // Vertical pill: ends at (0,-50),(0,50) -> 90 (or -90).
    var v = _longAxisAngleDeg([{x:0,y:-50},{x:3,y:0},{x:0,y:50}]);
    check(Math.abs(Math.abs(v) - 90) < 1e-6, 'longaxis: vertical -> +-90, got ' + v);
})();

// ── _uprightRotationDeg ──
// Case A: plate already horizontal, art already above plate -> ~0 rotation.
(function () {
    var ref = [{x:-50,y:0},{x:50,y:0}];      // plate long axis horizontal, centroid (0,0)
    var art = [{x:-20,y:100},{x:20,y:100}];  // art centroid (0,100) -> above plate
    var t = _uprightRotationDeg(ref, art);
    check(Math.abs(t) < 1e-6, 'upright A: already upright -> 0, got ' + t);
})();

// Case B: plate horizontal but art BELOW plate (upside down) -> 180.
(function () {
    var ref = [{x:-50,y:0},{x:50,y:0}];
    var art = [{x:-20,y:-100},{x:20,y:-100}];  // art below plate
    var t = _uprightRotationDeg(ref, art);
    check(Math.abs(Math.abs(t) - 180) < 1e-6, 'upright B: upside down -> 180, got ' + t);
})();

// Case C: plate vertical (ends (0,+-50)), art to the RIGHT (+x). Upright needs
// plate horizontal + below art. Correct answer rotates so art ends up ABOVE plate.
(function () {
    var ref = [{x:0,y:-50},{x:0,y:50}];       // centroid (0,0)
    var art = [{x:100,y:0}];                    // centroid (100,0), right of plate
    var t = _uprightRotationDeg(ref, art);
    // After rotating everything by t, art must be above plate. Verify by rotating the
    // art-minus-plate vector (100,0) by t and checking its y becomes > 0.
    var r = t * Math.PI / 180;
    var ry = 100 * Math.sin(r) + 0 * Math.cos(r);
    check(ry > 0, 'upright C: art ends above plate (ry>0), got t=' + t + ' ry=' + ry);
    // And the plate long axis becomes horizontal: rotate a plate end (0,50) by t -> y ~ 0.
    var py = 0 * Math.sin(r) + 50 * Math.cos(r);
    check(Math.abs(py) < 1e-6, 'upright C: plate horizontal after rotate, plate-end y=' + py);
})();

// Case D: null reference -> null.
(function () {
    check(_uprightRotationDeg([{x:0,y:0}], [{x:0,y:9}]) === null, 'upright D: <2 ref pts -> null');
})();

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
