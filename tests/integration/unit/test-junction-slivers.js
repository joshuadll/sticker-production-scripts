// Pure-geometry unit test for caption-junction sliver selection (_junctionSliverLeaves in
// aiUtils.jsx). A fused-cut leaf is a sliver iff it is NOT the largest AND its centroid lies
// inside BOTH the plate and the art (the plate∩art overlap). No band, no area cap. y-UP coords.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '\\s*\\([\\s\\S]*?\\n}');
    var m = src.match(re); if (!m) throw new Error('could not extract ' + name); return m[0];
}
eval(extract('pointInPolygon'));
eval(extract('_pointInPolysEO'));
eval(extract('_junctionSliverLeaves'));

var fails = 0;
function check(c, m) { if (!c) { console.log('FAIL: ' + m); fails++; } }
function arrEq(a, b) { return a.length === b.length && a.join(',') === b.join(','); }

// art = 100x100 square; plate = pill straddling the bottom edge -> overlap = x[20,80], y[0,20].
var ART   = [[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]];
var PLATE = [[{x:20,y:-10},{x:80,y:-10},{x:80,y:20},{x:20,y:20}]];

// contour (largest) + two blobs in the overlap + one real hole up in the art body.
(function () {
    var leaves = [
        { c:{x:50,y:50}, area:10000 },   // 0 real contour (largest, art body)
        { c:{x:50,y:10}, area:50 },      // 1 blob in overlap        -> doomed
        { c:{x:50,y:70}, area:40 },      // 2 real hole (art only)   -> keep
        { c:{x:40,y:5},  area:30 }       // 3 blob in overlap        -> doomed
    ];
    var d = _junctionSliverLeaves(leaves, PLATE, ART);
    check(arrEq(d, [1, 3]), 'two overlap blobs doomed, real hole + contour kept (got [' + d + '])');
})();

// the LARGEST leaf is never doomed, even if its centroid is in the overlap.
(function () {
    var leaves = [
        { c:{x:50,y:10}, area:10000 },   // 0 largest, centroid in overlap -> still kept
        { c:{x:50,y:12}, area:50 }       // 1 blob                          -> doomed
    ];
    var d = _junctionSliverLeaves(leaves, PLATE, ART);
    check(arrEq(d, [1]), 'largest kept even if in overlap; blob doomed (got [' + d + '])');
})();

// a single leaf (already clean) -> nothing doomed (idempotent no-op).
(function () {
    var d = _junctionSliverLeaves([{ c:{x:50,y:50}, area:10000 }], PLATE, ART);
    check(arrEq(d, []), 'single leaf -> no-op (got [' + d + '])');
})();

if (fails === 0) { console.log('PASS: junction-sliver selection'); }
else { console.log(fails + ' FAIL'); process.exit(1); }
