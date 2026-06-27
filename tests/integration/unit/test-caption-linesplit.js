// tests/integration/unit/test-caption-linesplit.js
// Pure unit test for _capSplitLines (caption display name -> stacked lines on "|").
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '[\\s\\S]*?\\n}');
    var m = src.match(re);
    if (!m) throw new Error('could not extract ' + name + ' from aiUtils.jsx');
    return m[0];
}
eval(extract('_capSplitLines'));

var fails = 0;
function eq(a, b, msg) {
    var A = JSON.stringify(a), B = JSON.stringify(b);
    if (A !== B) { console.log('FAIL: ' + msg + ' got ' + A + ' want ' + B); fails++; }
}

eq(_capSplitLines('The Blue Church | Manila Cathedral'),
   ['The Blue Church', 'Manila Cathedral'], 'two lines, trimmed');
eq(_capSplitLines('A|B|C'), ['A', 'B', 'C'], 'three lines no spaces');
eq(_capSplitLines('Horseshoe Bend'), ['Horseshoe Bend'], 'no pipe -> single line');
eq(_capSplitLines('  A  |  B  '), ['A', 'B'], 'trims each segment');
eq(_capSplitLines('A || | B'), ['A', 'B'], 'drops empty segments');

console.log(fails === 0 ? 'PASS linesplit' : ('FAIL linesplit (' + fails + ' failure(s))'));
process.exit(fails === 0 ? 0 : 1);
