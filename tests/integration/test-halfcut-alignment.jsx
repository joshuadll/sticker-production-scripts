// test-halfcut-alignment.jsx — regression guard for the HALF-CUT ENDPOINT EXTENSION.
//
// Asserts the invariant fixed in commit d996451: every half-cut END lands ON the cut line
// (the 1mm overshoot runs ALONG the contour, not off along the art-operand tangent). A
// regression — e.g. a future change reverting to a tangent-based overshoot — pushes the
// endpoints OFF the nearest cut-line edge and trips this test.
//
// Direct-call test (no golden): runs the real syncHalfcut (cut-line-aligned extension) on the
// open fixture's caption
// groups, then measures each half-cut endpoint's PERPENDICULAR distance to the nearest
// cut-line edge. Writes [halfcut-test] PASS|/FAIL| lines; the runner greps for FAIL.
//
// The runner opens tests/integration/fixtures/import-nesting.ai before evaluating this file.
#target illustrator
#include "../../utils/aiUtils.jsx"

var CONFIG = {
    logPath:           "~/Desktop/test-halfcut-alignment.log",
    suppressAlerts:    true,
    halfcutSeamSteps:  16,
    halfcutExtendMm:   1.0,
    halfcutLayerName:  "Halfcut",
    halfcutStrokePt:   0.25,
    cutlinesLayerName: "Cutlines",
    stickersLayerName: "Sticker"
};

var TOL_PT = 1.5;   // an on-contour endpoint sits ~0pt off the nearest cut-line edge; the
                    // tangent-based bug pushed it ~2-3pt off. 1.5pt cleanly separates them.

function _t_findWorkingDoc() {
    for (var i = 0; i < app.documents.length; i++) {
        var d = app.documents[i];
        for (var j = 0; j < d.layers.length; j++) if (d.layers[j].name === "Cutlines") return d;
    }
    return app.activeDocument;
}

// Min perpendicular distance from pt {x,y} to the EDGES of a sampled polygon set.
function _t_distToEdges(pt, polys) {
    var best = Infinity, i, j, poly, c;
    for (i = 0; i < polys.length; i++) {
        poly = polys[i];
        for (j = 0; j < poly.length; j++) {
            c = _ptSegClosestSq(pt, poly[j], poly[(j + 1) % poly.length]);
            if (c.dist2 < best) best = c.dist2;
        }
    }
    return Math.sqrt(best);
}

function main() {
    // fresh log
    var lf = new File(CONFIG.logPath); lf.open("w"); lf.write(""); lf.close();

    var doc = _t_findWorkingDoc();
    var cutL = findLayer(doc, CONFIG.cutlinesLayerName), hcL = null, i;
    for (i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i].name.toLowerCase().indexOf("halfcut") >= 0) hcL = doc.layers[i];
        try { doc.layers[i].locked = false; } catch (eL) {}
    }
    if (!cutL) { log("[halfcut-test] FAIL | no Cutlines layer in fixture"); return; }

    // Run the real half-cut sync on every caption group.
    var groups = [], g;
    for (g = 0; g < cutL.groupItems.length; g++) groups.push(cutL.groupItems[g]);
    var processed = 0;
    for (g = 0; g < groups.length; g++) {
        var grp = groups[g];
        var plate   = findGroupMember(grp, " plate");
        var outline = findGroupMember(grp, " outline");
        var cut     = findGroupMember(grp, "");
        if (!plate || !outline || !cut) continue;        // stamp / uncaptioned
        try {
            syncHalfcut(doc, grp, {});
            processed++;
        } catch (eP) {
            log("[halfcut-test] FAIL | " + grp.name + " threw: " + eP.message);
        }
    }

    if (!hcL) for (i = 0; i < doc.layers.length; i++) if (doc.layers[i].name.toLowerCase().indexOf("halfcut") >= 0) hcL = doc.layers[i];
    if (!hcL) { log("[halfcut-test] FAIL | no Halfcut layer after sync"); return; }

    // Measure each half-cut's two endpoints against its element's cut-line edges.
    var worst = 0, worstName = "", checked = 0, fails = 0;
    for (g = 0; g < groups.length; g++) {
        var grp2 = groups[g];
        var cut2 = findGroupMember(grp2, "");
        if (!cut2) continue;
        var hc = null, h;
        for (h = 0; h < hcL.pathItems.length; h++) {
            if (hcL.pathItems[h].name === grp2.name + " halfcut") { hc = hcL.pathItems[h]; break; }
        }
        if (!hc) continue;                                // GC/WC only; others have no half-cut
        var cutPolys = samplePathToPolygons(cut2, 40);
        if (cutPolys.length === 0) continue;
        var pts = hc.pathPoints, n = pts.length;
        if (n < 2) continue;
        var e0 = { x: pts[0].anchor[0], y: pts[0].anchor[1] };
        var e1 = { x: pts[n - 1].anchor[0], y: pts[n - 1].anchor[1] };
        var d0 = _t_distToEdges(e0, cutPolys), d1 = _t_distToEdges(e1, cutPolys);
        var dm = (d0 > d1) ? d0 : d1;
        checked++;
        if (dm > worst) { worst = dm; worstName = grp2.name; }
        if (dm > TOL_PT) {
            fails++;
            log("[halfcut-test] FAIL | " + grp2.name + " endpoint " + dm.toFixed(2)
                + "pt off cut line (> " + TOL_PT + "pt)");
        }
    }

    log("[halfcut-test] processed " + processed + " caption group(s), checked " + checked
        + " half-cut(s); worst endpoint gap " + worst.toFixed(2) + "pt (" + worstName + ").");
    if (fails === 0 && checked > 0) {
        log("[halfcut-test] PASS | all " + checked + " half-cut endpoint(s) on the cut line (<= "
            + TOL_PT + "pt).");
    } else if (checked === 0) {
        log("[halfcut-test] FAIL | no half-cuts measured (fixture has no caption half-cuts?).");
    }
}

try { main(); }
catch (e) { log("[halfcut-test] FAIL | uncaught: " + e.message + " (line " + e.line + ")"); }
