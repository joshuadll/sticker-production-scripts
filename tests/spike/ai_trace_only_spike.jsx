// tests/spike/ai_trace_only_spike.jsx — THROWAWAY spike variant (delete after recipe lock).
// Traces the WHITE-EDGED silhouettes (PS already did the offset/expand) and lays them out as the
// cut directly — NO AI offset. Tests whether doing the white edge in PS sidesteps the AI-offset
// edge cases (wordmark union, tram orphan, flower self-intersection).
//
// Run: after ps_export_whiteedge_spike.jsx has populated CONFIG.inFolder, in Illustrator
// File > Scripts > Browse... -> this file.
#target illustrator
#include "../../utils/aiUtils.jsx"

var CONFIG = {
    inFolder:    "~/Desktop/spine-spike-we",
    cellMm:      60,
    gapMm:       10,
    colsPerRow:  4,
    traceThreshold:      null,
    tracePathFidelity:   null,
    traceCornerFidelity: null,
    traceNoiseFidelity:  null
};

function main() {
    var inF = new Folder(CONFIG.inFolder);
    var doc = app.documents.add();
    var layer = doc.layers[0];
    layer.name = "spine-spike-we";

    var cell = mmToPoints(CONFIG.cellMm), gap = mmToPoints(CONFIG.gapMm), m = mmToPoints(10);
    var built = 0, idx = 0;

    while (true) {
        idx++;
        var base = "elem_" + (idx < 10 ? "0" : "") + idx;
        var sil = new File(inF.fsName + "/" + base + "_silhouette.png");
        if (!sil.exists) break;

        var col = built % CONFIG.colsPerRow, row = Math.floor(built / CONFIG.colsPerRow);
        var ox = m + col * (cell + gap);
        var oy = -(m + row * (cell + gap));
        buildOne(doc, layer, sil, ox, oy, cell);
        built++;
    }

    app.redraw();
    alert("Trace-only spike: built " + built + " element(s).");
}

function buildOne(doc, layer, silFile, ox, oy, cell) {
    var placed = layer.placedItems.add();
    placed.file = silFile;
    var sc = cell / Math.max(placed.width, placed.height) * 100;
    placed.resize(sc, sc);
    placed.position = [ox, oy];

    var pi = placed.trace();
    var to = pi.tracing.tracingOptions;
    to.loadFromPreset("Silhouettes");
    if (CONFIG.traceThreshold      !== null) to.threshold      = CONFIG.traceThreshold;
    if (CONFIG.tracePathFidelity   !== null) to.pathFidelity   = CONFIG.tracePathFidelity;
    if (CONFIG.traceCornerFidelity !== null) to.cornerFidelity = CONFIG.traceCornerFidelity;
    if (CONFIG.traceNoiseFidelity  !== null) to.noiseFidelity  = CONFIG.traceNoiseFidelity;
    app.redraw();
    var tg = pi.tracing.expandTracing();           // = the white-edged silhouette = THE CUT (no offset)

    // Style: light grey fill so the shape reads, black 0.5pt stroke = the cut line.
    applyToPathTree(tg, function (p) {
        p.filled = true;  try { p.fillColor = _grey(85); } catch (e) {}
        p.stroked = true; p.strokeWidth = 0.5; try { p.strokeColor = blackCmyk(); } catch (e2) {}
    });
}

function _grey(pct) { var c = new GrayColor(); c.gray = pct; return c; }

try { main(); }
catch (e) { alert("Spike error line " + e.line + ": " + e.message); }
