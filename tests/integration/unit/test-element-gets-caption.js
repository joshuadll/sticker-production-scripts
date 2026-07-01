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
eval(extract('_peelTabCategory'));   // dependency of elementGetsCaption; CONFIG is undefined in node
eval(extract('elementGetsCaption')); // so _peelTabCategory falls back to ["MP","LM","TR"]

var fails = 0;
function check(cond, msg) { if (!cond) { console.log('FAIL: ' + msg); fails++; } }

// Style-only decisions.
check(elementGetsCaption('WC') === true,       'WC (no category) gets a caption');
check(elementGetsCaption('GC') === true,       'GC gets a caption');
check(elementGetsCaption('GC', 'LM') === true, 'GC-LM always captions (decorative plate)');
check(elementGetsCaption('ST') === false,      'ST gets a default tab');
check(elementGetsCaption('')   === false,      'unparsed/blank gets a default tab');
check(elementGetsCaption(null) === false,      'null gets a default tab');

// Category override on WC: self-labelled categories (Map/Location-Name) → peel tab;
// landmarks/transport/icons/food keep their caption.
check(elementGetsCaption('WC', 'MP') === false, 'WC-MP (map) gets a peel tab');
check(elementGetsCaption('WC', 'TL') === false, 'WC-TL (location name) gets a peel tab');
check(elementGetsCaption('WC', 'TR') === true,  'WC-TR (transport) keeps its caption');
check(elementGetsCaption('WC', 'LM') === true,  'WC-LM (landmark) keeps its caption');
check(elementGetsCaption('WC', 'IC') === true,  'WC-IC (cultural/icon) keeps its caption');
check(elementGetsCaption('WC', 'FD') === true,  'WC-FD (food) keeps its caption');

if (fails) { console.log(fails + ' failure(s)'); process.exit(1); }
console.log('all passed');
