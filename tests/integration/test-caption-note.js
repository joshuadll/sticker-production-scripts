// tests/integration/test-caption-note.js
// Pure string helpers — node-compatible (ES3). Eval the two _capNote* sources from aiUtils.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../utils/aiUtils.jsx', 'utf8');
eval(src.match(/function _capNoteFormat[\s\S]*?\n}\n/)[0]);
eval(src.match(/function _capNoteParse[\s\S]*?\n}\n/)[0]);

var fails = 0;
function ok(c, m){ if(!c){ console.log('FAIL: '+m); fails++; } }

// Round-trips.
ok(_capNoteFormat('WC',1,42,false) === 'WC|1|h42', 'WC no-review format');
ok(_capNoteFormat('GC',2,57,true)  === 'GC|2|h57|R', 'GC review format');

var a = _capNoteParse('WC|1|h42');
ok(a.styleCode==='WC' && a.lines===1 && a.pillHeightPt===42 && a.review===false, 'parse WC');
var b = _capNoteParse('GC|2|h57|R');
ok(b.styleCode==='GC' && b.lines===2 && b.pillHeightPt===57 && b.review===true, 'parse GC review');

// Back-compat: old note with no height -> pillHeightPt null, still parses style/lines/review.
var c = _capNoteParse('WC|1|R');
ok(c.styleCode==='WC' && c.lines===1 && c.pillHeightPt===null && c.review===true, 'parse legacy |R');
var d = _capNoteParse('GC|2');
ok(d.styleCode==='GC' && d.lines===2 && d.pillHeightPt===null && d.review===false, 'parse legacy bare');

console.log(fails===0 ? 'PASS caption-note' : ('FAIL caption-note ('+fails+')'));
process.exit(fails===0?0:1);
