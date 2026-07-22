// Pure-geometry unit test for _segSegIntersect / _cubicCrossings / _twoOutermost in aiUtils.jsx.
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name){var re=new RegExp('function '+name+'\\s*\\([\\s\\S]*?\\n}');var m=src.match(re);if(!m)throw new Error('could not extract '+name);return m[0];}
eval(extract('_bezierPoint'));
eval(extract('_segSegIntersect'));
eval(extract('_cubicPolyline'));
eval(extract('_cubicCrossings'));
eval(extract('_twoOutermost'));

var fails=0;
function check(c,m){if(!c){console.log('FAIL: '+m);fails++;}}
function near(a,b,e){return Math.abs(a-b)<(e||1e-4);}

// straight-cubic helper: cubic that is the straight segment a->b
function seg(a,b){return {p0:a,c1:[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],c2:[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],p3:b};}

// _segSegIntersect: a '+' crossing at origin.
(function(){
  var r=_segSegIntersect([-1,0],[1,0],[0,-1],[0,1]);
  check(r&&near(r.x,0)&&near(r.y,0),'segseg crosses at origin (got '+JSON.stringify(r)+')');
  check(_segSegIntersect([0,0],[1,0],[0,1],[1,1])===null,'parallel/no-cross -> null');
})();

// _cubicCrossings: A is a horizontal line y=0 from x=-2..2 (as 1 straight cubic);
// B is a "V" that dips below and crosses A twice (two straight cubics).
(function(){
  var A=[seg([-2,0],[2,0])];
  var B=[seg([-1,1],[0,-1]), seg([0,-1],[1,1])];
  var cr=_cubicCrossings(A,B,20);
  check(cr.length===2,'two crossings found (got '+cr.length+')');
  // crossings near x=-0.5 and x=0.5, y=0
  var xs=[cr[0].x,cr[1].x].sort(function(a,b){return a-b;});
  check(near(xs[0],-0.5,0.05)&&near(xs[1],0.5,0.05),'crossings near x=-0.5,0.5 (got '+xs+')');
  check(cr[0].aIdx===0&&cr[1].aIdx===0,'both on A cubic 0');
})();

// _twoOutermost: pick the farthest-apart pair.
(function(){
  var cs=[{x:0,y:0},{x:1,y:0},{x:10,y:0}];
  var r=_twoOutermost(cs);
  var pair=[r.c0.x,r.c1.x].sort(function(a,b){return a-b;});
  check(pair[0]===0&&pair[1]===10,'outermost = 0 and 10 (got '+pair+')');
})();

if(fails===0)console.log('PASS: crossings'); else {console.log(fails+' FAIL');process.exit(1);}
