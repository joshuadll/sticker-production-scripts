// Pure unit test for _farthestPairDist in aiUtils.jsx — the caption junction span is the
// largest distance between the outermost plate-art crossings.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name){var re=new RegExp('function '+name+'\\s*\\([\\s\\S]*?\\n}');var m=src.match(re);if(!m)throw new Error('could not extract '+name);return m[0];}
eval(extract('_farthestPairDist'));

var fails=0;
function check(c,m){if(!c){console.log('FAIL: '+m);fails++;}}
function near(a,b){return Math.abs(a-b)<1e-9;}

check(near(_farthestPairDist([{x:0,y:0},{x:3,y:4}]), 5), 'two points -> 5 (3-4-5)');
check(near(_farthestPairDist([{x:0,y:0},{x:1,y:0},{x:10,y:0}]), 10), 'picks the farthest pair, not adjacent');
check(near(_farthestPairDist([{x:0,y:0},{x:0,y:0}]), 0), 'coincident points -> 0 (tangent pinch)');
check(near(_farthestPairDist([{x:5,y:5}]), 0), 'single point -> 0');
check(near(_farthestPairDist([]), 0), 'empty -> 0');
check(near(_farthestPairDist(null), 0), 'null -> 0 (guard)');

if(fails===0)console.log('PASS: junction-span'); else {console.log(fails+' FAIL');process.exit(1);}
