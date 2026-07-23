// Pure unit tests for _densifyPoly and the shared _bboxEcho plate-echo predicate (aiUtils.jsx).
// Both were review findings: _densifyPoly silently failed to enforce its spacing (Math.floor left
// edges in [maxLen, 2*maxLen) completely unsubdivided), and the echo predicate was duplicated as
// four independent literals across _captionLeafDetached and _matchesAKeepRef — if those drifted, a
// detached caption plate could be deleted as a "crumb" before the fuse re-assert ever saw it.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name){var re=new RegExp('function '+name+'\\s*\\([\\s\\S]*?\\n}');var m=src.match(re);if(!m)throw new Error('could not extract '+name);return m[0];}
function extractVar(name){var re=new RegExp('var '+name+'\\s*=\\s*[^;]+;');var m=src.match(re);if(!m)throw new Error('could not extract var '+name);return m[0];}

eval(extractVar('PLATE_ECHO_DIST_PT'));
eval(extractVar('PLATE_ECHO_AREA_LO'));
eval(extractVar('PLATE_ECHO_AREA_HI'));
eval(extract('_bboxEcho'));
eval(extract('_captionLeafDetached'));
eval(extract('_matchesAKeepRef'));
eval(extract('_densifyPoly'));

var fails=0;
function check(c,m){if(!c){console.log('FAIL: '+m);fails++;}}
function maxEdge(poly){var N=poly.length,best=0,i;for(i=0;i<N;i++){var a=poly[i],b=poly[(i+1)%N];
  var d=Math.sqrt((b.x-a.x)*(b.x-a.x)+(b.y-a.y)*(b.y-a.y));if(d>best)best=d;}return best;}

// --- _densifyPoly: the guarantee is "no edge longer than maxLen" ------------------------------
// REGRESSION: with Math.floor, an edge in [maxLen, 2*maxLen) got cuts===1 and the loop never ran,
// leaving it unsubdivided at up to 2x maxLen. These lengths sit in exactly that window.
(function(){
    var lens = [0.6, 0.9, 0.99, 1.2, 1.9, 3.7], k;
    for (k = 0; k < lens.length; k++) {
        var L = lens[k];
        var sq = [{x:0,y:0},{x:L,y:0},{x:L,y:L},{x:0,y:L}];
        var d = _densifyPoly(sq, 0.5);
        check(maxEdge(d) <= 0.5 + 1e-9,
            'densify enforces maxLen for edge ' + L + ' (got max edge ' + maxEdge(d).toFixed(4) + ')');
    }
})();
// already-finer input is not coarsened
(function(){
    var fine = [{x:0,y:0},{x:0.1,y:0},{x:0.1,y:0.1},{x:0,y:0.1}];
    check(_densifyPoly(fine, 0.5).length >= 4, 'densify never drops points from an already-fine poly');
})();
// degenerate guards
check(_densifyPoly([{x:0,y:0},{x:1,y:0}], 0.5).length === 2, 'densify passes through a <3-point poly');
check(_densifyPoly([{x:0,y:0},{x:1,y:0},{x:1,y:1}], 0).length === 3, 'densify passes through maxLen<=0');

// --- _bboxEcho / the two consumers must stay exact complements --------------------------------
var PLATE = { c:{x:50,y:10}, area:100 };
check(_bboxEcho({c:{x:50,y:10},area:100}, PLATE) === true,  'identical leaf echoes the plate');
check(_bboxEcho({c:{x:50,y:10},area:74},  PLATE) === false, 'area just below the LO band is not an echo');
check(_bboxEcho({c:{x:50,y:10},area:126}, PLATE) === false, 'area just above the HI band is not an echo');
check(_bboxEcho({c:{x:61,y:10},area:100}, PLATE) === false, 'centroid beyond the distance band is not an echo');
check(_bboxEcho({c:{x:50,y:10},area:100}, {c:{x:50,y:10},area:0}) === false, 'zero-area ref never echoes');

// THE INVARIANT: what the sliver remover KEEPS is exactly what the fuse re-assert FLAGS.
// If these ever disagree, a detached pill is deleted before phase 2 can see it and the cutline
// ships with no caption at all.
(function(){
    var leaves = [
        {c:{x:50,y:10},  area:100},   // the detached pill
        {c:{x:50,y:90},  area:9000},  // the real contour
        {c:{x:20,y:70},  area:40},    // a genuine art hole, far from the plate
        {c:{x:50,y:10},  area:400}    // same place, wrong size
    ], i;
    for (i = 0; i < leaves.length; i++) {
        check(_matchesAKeepRef(leaves[i], [PLATE]) === _captionLeafDetached([leaves[i]], PLATE),
            'keeper and detector agree on leaf ' + i + ' (they must be exact complements)');
    }
})();

if(fails===0)console.log('PASS: densify-echo'); else {console.log(fails+' FAIL');process.exit(1);}
