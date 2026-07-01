// Pure-geometry unit test for _tabAttachTips (aiUtils.jsx). y-UP coords, AI points.
// A tab's attach-edge endpoints are the "pointy tips" — the vertices extreme along the plate's
// long axis on the ART-FACING side. (The pill inner-edge finder SKIPS these as caps; tabs KEEP
// them.) geom = { travelIsX, sign } points from the plate toward the art.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '[\\s\\S]*?\\n}');
    var m = src.match(re); if (!m) throw new Error('could not extract ' + name); return m[0];
}
eval(extract('_tabAttachTips'));

var fails = 0;
function check(c, m) { if (!c) { console.log('FAIL: ' + m); fails++; } }

// ── Trapezoid tab: WIDE attach edge (tips) toward the art (+y), NARROW outer edge away. ──
// Verts: attach tips (±50,10), cap bases (±40,5), outer corners (±30,0).
(function () {
    var tab = [{x:-50,y:10},{x:-40,y:5},{x:-30,y:0},{x:30,y:0},{x:40,y:5},{x:50,y:10}];
    var tips = _tabAttachTips(tab, { travelIsX: false, sign: 1 });   // art above (+y)
    check(!!tips, 'trapezoid: returns tips');
    // e0 = min-long-axis (x=-50), e1 = max (x=+50); both on the attach edge (y=10).
    check(tips.e0.x === -50 && tips.e1.x === 50, 'trapezoid: tips are the widest attach-edge ends (±50), got ' + tips.e0.x + '/' + tips.e1.x);
    check(tips.e0.y === 10 && tips.e1.y === 10, 'trapezoid: tips lie on the attach edge (y=10)');
})();

// ── Art-side restriction matters: INVERTED trapezoid — WIDE outer edge (away, ±50) + NARROW
// attach edge (toward art, ±30). Tips must be the narrow ATTACH edge, not the wide outer one. ──
(function () {
    var inv = [{x:-30,y:10},{x:-50,y:0},{x:50,y:0},{x:30,y:10}];
    var tips = _tabAttachTips(inv, { travelIsX: false, sign: 1 });   // art above (+y)
    check(tips && tips.e0.x === -30 && tips.e1.x === 30,
        'inverted: tips are the narrow ATTACH edge (±30), not the wide outer (±50), got ' + (tips ? tips.e0.x + '/' + tips.e1.x : 'null'));
})();

// ── Sign flip: art BELOW (-y). Attach edge is the bottom (toward art). ──
(function () {
    var tab = [{x:-50,y:0},{x:-40,y:5},{x:-30,y:10},{x:30,y:10},{x:40,y:5},{x:50,y:0}];
    var tips = _tabAttachTips(tab, { travelIsX: false, sign: -1 });  // art below (-y)
    check(tips && tips.e0.y === 0 && tips.e1.y === 0 && Math.abs(tips.e0.x) === 50 && Math.abs(tips.e1.x) === 50,
        'art-below: tips are the widest bottom attach edge (±50, y=0)');
})();

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
