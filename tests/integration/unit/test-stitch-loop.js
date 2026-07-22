var fs = require('fs');
var src = fs.readFileSync(__dirname + '/../../../utils/aiUtils.jsx', 'utf8');
function extract(name){var re=new RegExp('function '+name+'\\s*\\([\\s\\S]*?\\n}');var m=src.match(re);if(!m)throw new Error('could not extract '+name);return m[0];}
eval(extract('_bezierPoint'));
eval(extract('pointInPolygon'));
eval(extract('_splitCubic'));
eval(extract('_arcBetween'));
eval(extract('_arcMidpoint'));
eval(extract('_cubicPolyline'));
eval(extract('_pt2'));
eval(extract('_reverseArc'));
eval(extract('_stitchUnionLoop'));

var fails=0;
function check(c,m){if(!c){console.log('FAIL: '+m);fails++;}}
function near(a,b,e){return Math.abs(a-b)<(e||1e-4);}
function seg(a,b){return {p0:a,c1:[a[0]+(b[0]-a[0])/3,a[1]+(b[1]-a[1])/3],c2:[a[0]+2*(b[0]-a[0])/3,a[1]+2*(b[1]-a[1])/3],p3:b};}
function polyOf(path){var p=_cubicPolyline(path,8),o=[],i;for(i=0;i<p.length;i++)o.push({x:p[i].x,y:p[i].y});return o;}

// _arcBetween: unit square (4 straight cubics CCW): (0,0)->(1,0)->(1,1)->(0,1)->close.
var SQ=[seg([0,0],[1,0]),seg([1,0],[1,1]),seg([1,1],[0,1]),seg([0,1],[0,0])];
(function(){
  // arc from (idx0,t0.5)=(0.5,0) forward to (idx2,t0.5)=(1,0.5? ) -> covers bottom-right corner.
  var arc=_arcBetween(SQ,0,0.5,2,0.5);
  check(arc.length>=1,'arc has segments');
  check(near(arc[0].p0[0],0.5)&&near(arc[0].p0[1],0),'arc starts at (0.5,0)');
  var last=arc[arc.length-1];
  check(near(last.p3[0],0.5)&&near(last.p3[1],1),'arc ends at (0.5,1)');
})();

// _stitchUnionLoop: art = unit square; cap = a box hanging off the bottom edge that overlaps.
// art bottom edge y=0; cap spans x[0.25,0.75], y[-0.5,0.25] -> crosses the bottom edge at
// x=0.25 and x=0.75. Union boundary = square minus the notch + cap's outer (bottom) rectangle.
(function(){
  var cap=[seg([0.25,0.25],[0.75,0.25]),seg([0.75,0.25],[0.75,-0.5]),
           seg([0.75,-0.5],[0.25,-0.5]),seg([0.25,-0.5],[0.25,0.25])];
  var cross={ c0:{x:0.25,y:0, aIdx:0,aT:0.25, bIdx:3,bT:0.6666667},
              c1:{x:0.75,y:0, aIdx:0,aT:0.75, bIdx:0,bT:0.5} };
  var loop=_stitchUnionLoop(SQ,cap,cross,polyOf(cap),polyOf(SQ));
  check(loop!==null,'loop built');
  // The loop must dip BELOW y=0 somewhere (it includes the cap's bottom at y=-0.5).
  var minY=1e9,i;for(i=0;i<loop.length;i++){minY=Math.min(minY,loop[i].p0[1],loop[i].p3[1]);}
  check(near(minY,-0.5,0.01),'union loop reaches the cap bottom y=-0.5 (got '+minY+')');
  // Closed: last.p3 == first.p0
  var f=loop[0].p0,l=loop[loop.length-1].p3;
  check(near(f[0],l[0])&&near(f[1],l[1]),'loop is closed');
})();

if(fails===0)console.log('PASS: stitch-loop'); else {console.log(fails+' FAIL');process.exit(1);}
