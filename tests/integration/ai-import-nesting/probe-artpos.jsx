// Art-position/rotation probe for the re-run phase. Prints (as the last expression) the
// count of art items whose bbox W/H swaps vs their cutline outline — the 90° re-run signature.
// Run on the working doc AFTER an import. Irregular (non-90°) elements legitimately differ
// (rotated raster-rect vs traced silhouette), so this only flags AXIS-ALIGNED (±90°) swaps.
var res = "";
try {
  var d = app.activeDocument, ci=-1, si=-1, i;
  for (i=0;i<d.layers.length;i++){ if(d.layers[i].name==="Cutlines")ci=i; if(d.layers[i].name==="Sticker")si=i; }
  var art={};
  for(i=0;i<d.layers[si].pageItems.length;i++){ var a=d.layers[si].pageItems[i]; if(a.parent===d.layers[si]) art[a.name]=a; }
  var swaps=0, tot=0, out=[];
  for(i=0;i<d.layers[ci].groupItems.length;i++){
    var g=d.layers[ci].groupItems[i]; if(g.parent!==d.layers[ci]) continue;
    var om=null; for(var k=0;k<g.pageItems.length;k++){ if(g.pageItems[k].name===g.name+" outline"){ om=g.pageItems[k]; break; } }
    var ob=om?om.geometricBounds:g.geometricBounds; var ow=Math.abs(ob[2]-ob[0]), oh=Math.abs(ob[1]-ob[3]);
    var a2=art[g.name]; if(!a2) continue; var ab=a2.geometricBounds; var aw=Math.abs(ab[2]-ab[0]), ah=Math.abs(ab[1]-ab[3]);
    tot++;
    // W/H swap: art wide where outline is tall (and vice versa) within 10pt = a 90° miss.
    if(Math.abs(aw-oh)<10 && Math.abs(ah-ow)<10 && Math.abs(aw-ow)>15) { swaps++; out.push(g.name.substring(0,12)); }
  }
  res = "checked="+tot+" bboxSwaps("+swaps+"): "+out.join(",");
} catch(e){ res="ERR line "+e.line+": "+e.message; }
res;
