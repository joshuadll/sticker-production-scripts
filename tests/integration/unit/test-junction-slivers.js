// Pure-geometry unit test for caption-junction sliver selection (_junctionSliverLeaves in
// aiUtils.jsx). A non-largest fused leaf is a CRUMB (delete) when it echoes no KEEP-reference
// (centroid within 10pt AND area within +/-25%); a leaf that DOES echo a keep-ref — an outline
// subpath (a genuine art hole) OR the caption plate (a shallow-seated pill left as its own leaf)
// — is kept. The largest fused leaf is never deleted. Numbers mirror live data: real echoes
// coincide (dist~0, ratio~1.0); crumbs miss (dist>>10, ratio~0).
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '\\s*\\([\\s\\S]*?\\n}');
    var m = src.match(re); if (!m) throw new Error('could not extract ' + name); return m[0];
}
function extractVar(name){var re=new RegExp('var '+name+'\\s*=\\s*[^;]+;');var m=src.match(re);if(!m)throw new Error('could not extract var '+name);return m[0];}
eval(extractVar('PLATE_ECHO_DIST_PT'));
eval(extractVar('PLATE_ECHO_AREA_LO'));
eval(extractVar('PLATE_ECHO_AREA_HI'));
eval(extract('_bboxEcho'));   // shared plate-echo predicate both consumers delegate to
eval(extract('_matchesAKeepRef'));
eval(extract('_junctionSliverLeaves'));

var fails = 0;
function check(c, m) { if (!c) { console.log('FAIL: ' + m); fails++; } }
function arrEq(a, b) { return a.length === b.length && a.join(',') === b.join(','); }

// keep-refs = the art-alone outline (main contour + a genuine art hole, like Tram's) PLUS the
// caption plate (the pill). The wrapper builds this same combined list from `outline` + `plate`.
var KEEP = [
    { c:{x:365,y:338}, area:14696 },   // art main contour
    { c:{x:510,y:361}, area:299 },     // a genuine art hole (outline subpath)
    { c:{x:71,y:391},  area:632 }      // the caption plate (pill) — a shallow seat leaves it loose
];

// fused: main + the real hole + the loose caption pill (all echo a keep-ref) + two crumbs.
(function () {
    var fused = [
        { c:{x:365,y:332}, area:16145 },   // 0 main contour (largest)               -> keep
        { c:{x:510,y:361}, area:299 },     // 1 echoes the art hole (dist0, r1.0)    -> keep
        { c:{x:71,y:391},  area:632 },     // 2 echoes the plate (Tatra loose pill)  -> keep
        { c:{x:386,y:287}, area:49 },      // 3 crumb (dist~56, ratio~0.003)         -> doomed
        { c:{x:332,y:286}, area:15 }       // 4 crumb (dist~61, ratio~0.001)         -> doomed
    ];
    var d = _junctionSliverLeaves(fused, KEEP);
    check(arrEq(d, [3, 4]), 'crumbs doomed; main + hole + loose caption pill kept (got [' + d + '])');
})();

// REGRESSION (Tatra chamois): a shallow-seated caption is a separate leaf echoing the plate —
// it must NOT be deleted (that stripped the caption out of the cutline).
(function () {
    var fused = [
        { c:{x:71,y:328}, area:13693 },    // 0 art contour (largest, caption NOT fused in)
        { c:{x:71,y:391}, area:632 }       // 1 the loose caption pill -> KEEP (echoes plate)
    ];
    var d = _junctionSliverLeaves(fused, KEEP);
    check(arrEq(d, []), 'loose caption pill kept, not deleted as a crumb (got [' + d + '])');
})();

// the LARGEST fused leaf is never doomed, even with no keep-ref match.
(function () {
    var fused = [
        { c:{x:0,y:0}, area:9999 },        // 0 largest, no keep-ref match -> still kept
        { c:{x:400,y:300}, area:20 }       // 1 crumb                      -> doomed
    ];
    var d = _junctionSliverLeaves(fused, KEEP);
    check(arrEq(d, [1]), 'largest kept even with no match; crumb doomed (got [' + d + '])');
})();

// a clean cut (every non-largest leaf echoes a keep-ref) -> no-op.
(function () {
    var fused = [
        { c:{x:365,y:332}, area:16145 },   // main (largest)
        { c:{x:510,y:361}, area:299 }      // real hole, echoes KEEP -> kept
    ];
    var d = _junctionSliverLeaves(fused, KEEP);
    check(arrEq(d, []), 'all non-largest leaves matched -> no-op (got [' + d + '])');
})();

// single leaf -> no-op.
(function () {
    var d = _junctionSliverLeaves([{ c:{x:0,y:0}, area:100 }], KEEP);
    check(arrEq(d, []), 'single leaf -> no-op (got [' + d + '])');
})();

if (fails === 0) { console.log('PASS: junction-sliver selection'); }
else { console.log(fails + ' FAIL'); process.exit(1); }
