// Pure unit test for elementGetsCaption (aiUtils.jsx). The default peel tab fires
// for every styleCode where this returns false.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name) {
    var re = new RegExp('function ' + name + '[\\s\\S]*?\\n}');
    var m = src.match(re);
    if (!m) throw new Error('could not extract ' + name);
    return m[0];
}
eval(extract('elementGetsCaption'));

var fails = 0;
function check(cond, msg) { if (!cond) { console.log('FAIL: ' + msg); fails++; } }

check(elementGetsCaption('WC') === true,  'WC gets a caption');
check(elementGetsCaption('GC') === true,  'GC gets a caption');
check(elementGetsCaption('ST') === false, 'ST gets a default tab');
check(elementGetsCaption('')   === false, 'unparsed/blank gets a default tab');
check(elementGetsCaption(null) === false, 'null gets a default tab');

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
