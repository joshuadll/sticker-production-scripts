// Pure-geometry unit test for caption-junction sliver selection (_junctionSliverLeaves in
// aiUtils.jsx). A non-largest fused leaf is a SLIVER (delete) when NO outline subpath matches it
// (centroid within 10pt AND area within +/-25%); a leaf that DOES match an outline subpath is a
// genuine art hole (keep). The largest fused leaf is never deleted. Numbers mirror live data:
// real echoes coincide (dist~0, ratio~1.0); slivers miss (dist>>10, ratio~0).
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '\\s*\\([\\s\\S]*?\\n}');
    var m = src.match(re); if (!m) throw new Error('could not extract ' + name); return m[0];
}
eval(extract('_matchesAnOutlineLeaf'));
eval(extract('_junctionSliverLeaves'));

var fails = 0;
function check(c, m) { if (!c) { console.log('FAIL: ' + m); fails++; } }
function arrEq(a, b) { return a.length === b.length && a.join(',') === b.join(','); }

// the art-alone trace: main contour + a genuine art hole (like Tram's).
var OUTLINE = [
    { c:{x:365,y:338}, area:14696 },   // art main contour
    { c:{x:510,y:361}, area:299 }      // a genuine art hole
];

// fused: main + the real hole (echoes OUTLINE) + two junction slivers (no echo).
(function () {
    var fused = [
        { c:{x:365,y:332}, area:16145 },   // 0 main contour (largest)            -> keep
        { c:{x:510,y:361}, area:299 },     // 1 echoes the art hole (dist0, r1.0) -> keep
        { c:{x:386,y:287}, area:49 },      // 2 sliver (dist~56, ratio~0.003)     -> doomed
        { c:{x:332,y:286}, area:15 }       // 3 sliver (dist~61, ratio~0.001)     -> doomed
    ];
    var d = _junctionSliverLeaves(fused, OUTLINE);
    check(arrEq(d, [2, 3]), 'slivers doomed; main + real hole kept (got [' + d + '])');
})();

// the LARGEST fused leaf is never doomed, even with no outline match.
(function () {
    var fused = [
        { c:{x:0,y:0}, area:9999 },        // 0 largest, no outline match -> still kept
        { c:{x:400,y:300}, area:20 }       // 1 sliver                    -> doomed
    ];
    var d = _junctionSliverLeaves(fused, OUTLINE);
    check(arrEq(d, [1]), 'largest kept even with no match; sliver doomed (got [' + d + '])');
})();

// a clean cut (every non-largest leaf echoes an outline subpath) -> no-op.
(function () {
    var fused = [
        { c:{x:365,y:332}, area:16145 },   // main (largest)
        { c:{x:510,y:361}, area:299 }      // real hole, matches OUTLINE -> kept
    ];
    var d = _junctionSliverLeaves(fused, OUTLINE);
    check(arrEq(d, []), 'all non-largest leaves matched -> no-op (got [' + d + '])');
})();

// single leaf -> no-op.
(function () {
    var d = _junctionSliverLeaves([{ c:{x:0,y:0}, area:100 }], OUTLINE);
    check(arrEq(d, []), 'single leaf -> no-op (got [' + d + '])');
})();

if (fails === 0) { console.log('PASS: junction-sliver selection'); }
else { console.log(fails + ' FAIL'); process.exit(1); }
