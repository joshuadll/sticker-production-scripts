// Pure unit test for _tabAssetItems: given two path-like objects, identify which is the
// CUTLINE (stroked, unfilled) and which is the FILL (filled, unstroked).
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '[\\s\\S]*?\\n}');
    var m = src.match(re); if (!m) throw new Error('could not extract ' + name); return m[0];
}
eval(extract('_tabAssetItems'));

var fails = 0;
function check(c, m) { if (!c) { console.log('FAIL: ' + m); fails++; } }

var cut  = { filled: false, stroked: true,  typename: 'PathItem' };
var fill = { filled: true,  stroked: false, typename: 'PathItem' };

var r1 = _tabAssetItems([cut, fill]);
check(r1 && r1.cutline === cut && r1.fill === fill, 'identifies cutline + fill (cut first)');
var r2 = _tabAssetItems([fill, cut]);
check(r2 && r2.cutline === cut && r2.fill === fill, 'order-independent');
var r3 = _tabAssetItems([fill, fill]);
check(r3 === null, 'ambiguous (two fills) -> null');

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
