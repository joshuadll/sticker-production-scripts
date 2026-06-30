// Pure unit test for _tabAssetItems: given the asset's two top-level items, identify which is the
// CUTLINE (a stroked, unfilled PathItem/CompoundPathItem) and which is the FILL (the OTHER item —
// which in the real assets is a GroupItem named "Sign", not a bare path).
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '[\\s\\S]*?\\n}');
    var m = src.match(re); if (!m) throw new Error('could not extract ' + name); return m[0];
}
eval(extract('_tabAssetItems'));

var fails = 0;
function check(c, m) { if (!c) { console.log('FAIL: ' + m); fails++; } }

var cut       = { filled: false, stroked: true,  typename: 'PathItem' };
var fill      = { filled: true,  stroked: false, typename: 'PathItem' };
var groupFill = { typename: 'GroupItem' };   // the real "Sign" fill — no filled/stroked props

var r1 = _tabAssetItems([cut, fill]);
check(r1 && r1.cutline === cut && r1.fill === fill, 'identifies cutline + path-fill (cut first)');
var r2 = _tabAssetItems([fill, cut]);
check(r2 && r2.cutline === cut && r2.fill === fill, 'order-independent');
var r3 = _tabAssetItems([fill, fill]);
check(r3 === null, 'ambiguous (two fills, no cutline) -> null');

// The REAL asset shape: cutline PathItem + "Sign" GroupItem as the fill.
var r4 = _tabAssetItems([cut, groupFill]);
check(r4 && r4.cutline === cut && r4.fill === groupFill, 'fill may be a GroupItem (Sign)');
var r5 = _tabAssetItems([groupFill, cut]);
check(r5 && r5.cutline === cut && r5.fill === groupFill, 'GroupItem-fill order-independent');
// Two cutlines (both stroked-unfilled paths) is ambiguous too.
var r6 = _tabAssetItems([cut, { filled: false, stroked: true, typename: 'PathItem' }]);
check(r6 === null, 'ambiguous (two cutlines, no single fill) -> null');

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
