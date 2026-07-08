// Pure unit test for artFactorFromData (aiUtils.jsx): AI points per PSD pixel = 72/sourceDPI,
// with a fallback DPI when the sidecar omits sourceDPI, and 0 when the data is unusable.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '[\\s\\S]*?\\n}');
    var m = src.match(re);
    if (!m) throw new Error('could not extract ' + name);
    return m[0];
}
eval(extract('artFactorFromData'));

var fails = 0;
function near(a, b) { return Math.abs(a - b) < 1e-9; }
function check(cond, msg) { if (!cond) { console.log('FAIL: ' + msg); fails++; } }

check(near(artFactorFromData({ psdWidth: 1000, sourceDPI: 300 }, 300), 0.24), '300 DPI -> 0.24');
check(near(artFactorFromData({ psdWidth: 1000, sourceDPI: 600 }, 300), 0.12), 'sidecar 600 DPI wins over fallback');
check(near(artFactorFromData({ psdWidth: 1000 }, 72), 1.0), 'fallback DPI used when sidecar omits sourceDPI');
check(artFactorFromData({ sourceDPI: 300 }, 300) === 0, 'no psdWidth -> 0');
check(artFactorFromData(null, 300) === 0, 'null data -> 0');
check(artFactorFromData({ psdWidth: 1000, sourceDPI: 0 }, 0) === 0, 'no usable DPI -> 0');

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
