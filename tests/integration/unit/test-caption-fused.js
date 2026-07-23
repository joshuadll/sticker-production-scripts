// Pure-geometry unit test for _captionLeafDetached in aiUtils.jsx: is a fused-cut leaf actually
// the (un-fused) caption plate? centroid within 10pt AND area within 0.75-1.25x of the plate.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name){var re=new RegExp('function '+name+'\\s*\\([\\s\\S]*?\\n}');var m=src.match(re);if(!m)throw new Error('could not extract '+name);return m[0];}
function extractVar(name){var re=new RegExp('var '+name+'\\s*=\\s*[^;]+;');var m=src.match(re);if(!m)throw new Error('could not extract var '+name);return m[0];}
eval(extractVar('PLATE_ECHO_DIST_PT'));
eval(extractVar('PLATE_ECHO_AREA_LO'));
eval(extractVar('PLATE_ECHO_AREA_HI'));
eval(extract('_bboxEcho'));   // shared plate-echo predicate both consumers delegate to
eval(extract('_captionLeafDetached'));

var fails=0;
function check(c,m){if(!c){console.log('FAIL: '+m);fails++;}}

var PLATE = { c:{x:50,y:10}, area:50 };

// Detached: a leaf coincident with the plate (centroid + area match) alongside the big contour.
check(_captionLeafDetached([{c:{x:50,y:50},area:16000},{c:{x:50,y:10.2},area:49}], PLATE) === true,
  'plate-matching leaf => detached');

// Fused: single contour, no plate-matching leaf.
check(_captionLeafDetached([{c:{x:50,y:50},area:16000}], PLATE) === false,
  'single contour => fused');

// Fused: a real art hole (small leaf, but far from the plate centroid) is NOT the plate.
check(_captionLeafDetached([{c:{x:50,y:50},area:16000},{c:{x:50,y:70},area:40}], PLATE) === false,
  'real hole far from plate => not detached');

// Fused: a leaf at the plate location but wrong area (ratio 4) is not the plate.
check(_captionLeafDetached([{c:{x:50,y:50},area:16000},{c:{x:50,y:10},area:200}], PLATE) === false,
  'wrong-area leaf at plate location => not detached');

// Guard: zero-area plate never matches.
check(_captionLeafDetached([{c:{x:50,y:10},area:0}], {c:{x:50,y:10},area:0}) === false,
  'zero-area plate => not detached (guard)');

if(fails===0)console.log('PASS: caption-fused'); else {console.log(fails+' FAIL');process.exit(1);}
