// tests/integration/test-caption-note.js
// Pure string helpers — node-compatible (ES3). Eval the two _capNote* sources from aiUtils.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
eval(src.match(/function _capNoteFormat[\s\S]*?\n}\n/)[0]);
eval(src.match(/function _capNoteParse[\s\S]*?\n}\n/)[0]);
eval(src.match(/function parseNote[\s\S]*?\n}\n/)[0]);

var fails = 0;
function ok(c, m){ if(!c){ console.log('FAIL: '+m); fails++; } }

// Round-trips (area token 'a', rotation-invariant scale reference).
ok(_capNoteFormat('WC',1,720,false) === 'WC|1|a720', 'WC no-review format');
ok(_capNoteFormat('GC',2,540,true)  === 'GC|2|a540|R', 'GC review format');

var a = _capNoteParse('WC|1|a720');
ok(a.styleCode==='WC' && a.lines===1 && a.pillArea===720 && a.review===false, 'parse WC');
var b = _capNoteParse('GC|2|a540|R');
ok(b.styleCode==='GC' && b.lines===2 && b.pillArea===540 && b.review===true, 'parse GC review');

// Back-compat: old note with no area -> pillArea null, still parses style/lines/review.
var c = _capNoteParse('WC|1|R');
ok(c.styleCode==='WC' && c.lines===1 && c.pillArea===null && c.review===true, 'parse legacy |R');
var d = _capNoteParse('GC|2');
ok(d.styleCode==='GC' && d.lines===2 && d.pillArea===null && d.review===false, 'parse legacy bare');

// parseNote (the simpler parser used by syncHalfcut/Step9A/Step7B/Step8c) must also read "R"
// from ANY trailing slot — the area field pushed it past the old fixed parts[2] check.
var pn1 = parseNote('ST|0|a90|R');
ok(pn1.styleCode==='ST' && pn1.capLines===0 && pn1.needsReview===true, 'parseNote tab review (R after area)');
var pn2 = parseNote('WC|1|a720|R');
ok(pn2.needsReview===true, 'parseNote caption review (R after area)');
var pn3 = parseNote('WC|1|a720');
ok(pn3.needsReview===false, 'parseNote no review');
var pn4 = parseNote('WC|1|R');
ok(pn4.needsReview===true, 'parseNote legacy |R (no area)');

console.log(fails===0 ? 'PASS caption-note' : ('FAIL caption-note ('+fails+')'));
process.exit(fails===0?0:1);
