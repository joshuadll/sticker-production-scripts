// test-caption-capend-ai.jsx — IN-ILLUSTRATOR validation of the bezier caption caps.
//
// The node unit test (test-caption-capend.js) proves the geometry in isolation. This one
// answers the two questions node CAN'T: after the change, does the REAL Illustrator pipeline
// keep the smooth cap through
//   (1) the Pathfinder UNITE (deriveCutline — Live Pathfinder Add + expandStyle), and
//   (2) the peel-tab SEAM trace (plateSeamPath)?
//
// Self-contained: builds its own doc, an art shape, and a WC capsule via the real
// buildCapsuleFromSpine, then unites + traces and asserts the cap still rides the true circle.
// Writes [capend-ai] PASS|/FAIL| lines to ~/Desktop; the runner greps for FAIL.
#target illustrator
#include "../../../utils/aiUtils.jsx"

var LOGPATH = "~/Desktop/test-caption-capend-ai.log";
function tlog(s) { var f = new File(LOGPATH); f.open("a"); f.lineFeed = "Unix"; f.writeln(s); f.close(); $.writeln(s); }
function pass(m) { tlog("[capend-ai] PASS | " + m); }
function fail(m) { tlog("[capend-ai] FAIL | " + m); }

function dist(p, cx, cy) { var dx = p.x - cx, dy = p.y - cy; return Math.sqrt(dx * dx + dy * dy); }

// Max |dist-r| over sampled points of `item` that fall on one cap hemisphere (selected by the
// x-filter `keep`), relative to cap centre (cx,cy) radius r.
function maxRadialErr(item, cx, cy, r, keep) {
    var polys = samplePathToPolygons(item, 24);
    var worst = -1, i, j, count = 0;
    for (i = 0; i < polys.length; i++) {
        for (j = 0; j < polys[i].length; j++) {
            var p = polys[i][j];
            if (!keep(p)) continue;
            var d = dist(p, cx, cy);
            if (d < 0.5 * r || d > 1.5 * r) continue;   // ignore points off the arc entirely
            var e = Math.abs(d - r);
            if (e > worst) worst = e;
            count++;
        }
    }
    return { worst: worst, count: count };
}

function main() {
    var lf = new File(LOGPATH); lf.open("w"); lf.write(""); lf.close();
    var prevUI = app.userInteractionLevel;
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    var doc = null;
    try {
        doc = app.documents.add(DocumentColorSpace.RGB, 600, 800);
        var layer = doc.layers[0];

        // WC capsule: horizontal 3-point spine, r = 20pt. Left cap centre (100,300), right (180,300).
        var r = 20;
        var spine = [{ x: 100, y: 300 }, { x: 140, y: 300 }, { x: 180, y: 300 }];
        var plate = buildCapsuleFromSpine(layer, spine, r);

        // ── 0. Pre-unite: the plate itself must carry curved handles (not a raw polygon) ──
        var curved = false, pp = plate.pathPoints, i;
        for (i = 0; i < pp.length; i++) {
            var a = pp[i].anchor, rd = pp[i].rightDirection;
            if (Math.abs(a[0] - rd[0]) > 0.5 || Math.abs(a[1] - rd[1]) > 0.5) { curved = true; break; }
        }
        if (curved) pass("plate carries bezier handles pre-unite (" + pp.length + " anchors)");
        else        fail("plate has NO bezier handles pre-unite — buildCapsuleFromSpine emitted a polygon");

        // Art shape overlapping only the pill's MIDDLE-bottom, leaving both caps free.
        // rectangle(top, left, width, height): top y=300, x 110..170, down to y=100.
        var art = layer.pathItems.rectangle(300, 110, 60, 200);
        art.filled = true; art.stroked = false;

        // ── 2. SEAM trace on the new bezier plate (needs plate seated in art) ──
        var seam = plateSeamPath(plate, art, 16);
        if (seam && seam.length >= 2) pass("plateSeamPath re-traced the bezier plate (" + seam.length + " pts)");
        else                          fail("plateSeamPath returned " + (seam ? ("len " + seam.length) : "null") + " — seam broke on the bezier cap");

        // ── 1. UNITE: deriveCutline unites plate+art; both caps must survive as true arcs ──
        var cut = deriveCutline(art, plate);
        if (!cut) { fail("deriveCutline returned nothing"); return; }

        var left  = maxRadialErr(cut, 100, 300, r, function (p) { return p.x < 99.5; });
        var right = maxRadialErr(cut, 180, 300, r, function (p) { return p.x > 180.5; });
        var TOL = r * 0.01;   // 1% of r = 0.2pt. Bezier stays ~<0.03%; a 10-chord polygon sags ~1.2%.

        if (left.count < 3)  fail("left cap: too few sampled arc points (" + left.count + ")");
        else if (left.worst <= TOL)  pass("left cap rides the circle after UNITE (err " + left.worst.toFixed(4) + "pt <= " + TOL.toFixed(3) + ", n=" + left.count + ")");
        else fail("left cap FACETED after unite (err " + left.worst.toFixed(4) + "pt > " + TOL.toFixed(3) + ")");

        if (right.count < 3) fail("right cap: too few sampled arc points (" + right.count + ")");
        else if (right.worst <= TOL) pass("right cap rides the circle after UNITE (err " + right.worst.toFixed(4) + "pt <= " + TOL.toFixed(3) + ", n=" + right.count + ")");
        else fail("right cap FACETED after unite (err " + right.worst.toFixed(4) + "pt > " + TOL.toFixed(3) + ")");

    } catch (e) {
        fail("EXCEPTION line " + e.line + ": " + e.message);
    } finally {
        try { if (doc) doc.close(SaveOptions.DONOTSAVECHANGES); } catch (eC) {}
        app.userInteractionLevel = prevUI;
    }
}
main();
