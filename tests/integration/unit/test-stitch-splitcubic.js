// Pure-geometry unit test for _splitCubic (de Casteljau) in aiUtils.jsx.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name){var re=new RegExp('function '+name+'\\s*\\([\\s\\S]*?\\n}');var m=src.match(re);if(!m)throw new Error('could not extract '+name);return m[0];}
eval(extract('_bezierPoint'));
eval(extract('_splitCubic'));

var fails=0;
function check(c,m){if(!c){console.log('FAIL: '+m);fails++;}}
function near(a,b){return Math.abs(a-b)<1e-6;}
function ptNear(p,q,msg){check(near(p[0],q[0])&&near(p[1],q[1]),msg+' got ['+p+'] want ['+q+']');}

// Straight segment (0,0)->(9,0): split at t=1/3 -> point (3,0); halves stay straight.
(function(){
  var seg={p0:[0,0],c1:[3,0],c2:[6,0],p3:[9,0]};
  var s=_splitCubic(seg,1/3);
  ptNear(s.left.p0,[0,0],'left.p0'); ptNear(s.left.p3,[3,0],'left.p3 = split point');
  ptNear(s.right.p0,[3,0],'right.p0 = split point'); ptNear(s.right.p3,[9,0],'right.p3');
})();

// Split point must equal _bezierPoint at t for a curved segment.
(function(){
  var seg={p0:[0,0],c1:[0,10],c2:[10,10],p3:[10,0]};
  var t=0.4, bp=_bezierPoint(seg.p0,seg.c1,seg.c2,seg.p3,t);
  var s=_splitCubic(seg,t);
  ptNear(s.left.p3,[bp.x,bp.y],'split point == _bezierPoint(t)');
  ptNear(s.right.p0,[bp.x,bp.y],'right.p0 == split point');
})();

if(fails===0)console.log('PASS: splitcubic'); else {console.log(fails+' FAIL');process.exit(1);}
