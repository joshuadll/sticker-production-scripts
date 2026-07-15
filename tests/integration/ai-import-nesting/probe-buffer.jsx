// Spacing-buffer placement probe. Run on the working doc AFTER an import: asserts the live
// keep-out halos live in a dedicated TOP-LEVEL "Spacing Buffer" layer (not as children of the
// cutline groups, and not a Cutlines sublayer — the 2026-07-15 structure), positioned directly
// ABOVE the Cutlines layer (between Cutlines and Halfcut), and that none leaked into a cutline
// group. Prints (as the last expression) a compact result the runner parses:
//   layer=<0|1> items=<N halos> aboveCut=<0|1> strays=<N "{name} buffer" left in a group>
var res = "";
try {
  var d = app.activeDocument, i;
  // Index of the buffer layer and the Cutlines layer in the top-level stack (0 = top).
  var bi = -1, ci = -1;
  for (i = 0; i < d.layers.length; i++) {
    if (d.layers[i].name === "Spacing Buffer") bi = i;
    if (d.layers[i].name === "Cutlines") ci = i;
  }
  var bl = (bi >= 0) ? d.layers[bi] : null;
  var items = bl ? bl.pageItems.length : 0;
  // Directly above Cutlines == buffer index is exactly one less (higher in the stack).
  var aboveCut = (bi >= 0 && ci >= 0 && bi === ci - 1) ? 1 : 0;
  // Any "{name} buffer" still sitting inside a cutline group == a leak (old structure).
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
  res = "layer=" + (bl ? 1 : 0) + " items=" + items + " aboveCut=" + aboveCut + " strays=" + strays;
} catch (e) { res = "ERR line " + e.line + ": " + e.message; }
res;
