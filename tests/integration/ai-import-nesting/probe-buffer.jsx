// Spacing-buffer placement probe. Run on the working doc AFTER an import: asserts the live
// keep-out halos live in a dedicated TOP-LEVEL "Spacing Buffer" layer (not as children of the
// cutline groups, and not a Cutlines sublayer — the 2026-07-15 structure) and that none leaked
// into a cutline group. Prints (as the last expression) a compact result the runner parses:
//   layer=<0|1> items=<N halos in the layer> strays=<N "{name} buffer" left inside a group>
var res = "";
try {
  var d = app.activeDocument, i;
  // The dedicated top-level layer + its halo count.
  var bl = null, j;
  for (j = 0; j < d.layers.length; j++) {
    if (d.layers[j].name === "Spacing Buffer") bl = d.layers[j];
  }
  var items = bl ? bl.pageItems.length : 0;
  // Any "{name} buffer" still sitting inside a cutline group == a leak (old structure).
  var ci = -1;
  for (i = 0; i < d.layers.length; i++) if (d.layers[i].name === "Cutlines") ci = i;
  var strays = 0, g, k, nm;
  if (ci >= 0) {
    for (i = 0; i < d.layers[ci].groupItems.length; i++) {
      g = d.layers[ci].groupItems[i];
      if (g.parent !== d.layers[ci]) continue;
      for (k = 0; k < g.pageItems.length; k++) {
        nm = g.pageItems[k].name;
        if (nm && nm.length >= 7 && nm.substring(nm.length - 7) === " buffer") strays++;
      }
    }
  }
  res = "layer=" + (bl ? 1 : 0) + " items=" + items + " strays=" + strays;
} catch (e) { res = "ERR line " + e.line + ": " + e.message; }
res;
