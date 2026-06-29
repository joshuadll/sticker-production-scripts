// tests/spike/ai_trace_offset_spike.jsx — THROWAWAY spike (delete after recipe lock).
// Traces each silhouette PNG, offsets outward for the white edge, bakes to geometry, and
// lays the outline + cut side-by-side for cut-quality inspection. Reuses the proven
// Step6 trace recipe + the aiUtils Offset Path effect string.
//
// Run: after ps_export_silhouette_spike.jsx has populated CONFIG.inFolder, in Illustrator
// File > Scripts > Browse... -> this file.
#target illustrator
#include "../../utils/aiUtils.jsx"

var CONFIG = {
    inFolder:    "~/Desktop/spine-spike",
    whiteEdgeMm: 1.69,        // SPIKE TUNABLE — white-edge offset
    bleedMm:     0.0,         // decision 7.3: >0 adds a second offset (cut = edge + bleed)
    cellMm:      60,          // layout cell size
    gapMm:       10,
    colsPerRow:  4,
    // Optional trace tuning (null = use the "Silhouettes" preset value):
    traceThreshold:      null,
    tracePathFidelity:   null,
    traceCornerFidelity: null,
    traceNoiseFidelity:  null
};

function main() {
    var inF = new Folder(CONFIG.inFolder);
    var doc = app.documents.add();                 // default RGB spike doc
    var layer = doc.layers[0];
    layer.name = "spine-spike";

    var cell = mmToPoints(CONFIG.cellMm), gap = mmToPoints(CONFIG.gapMm), m = mmToPoints(10);
    var built = 0, idx = 0;

    // Loop elem_01.. by stat (Folder.getFiles is unreliable on some macOS dirs).
    while (true) {
        idx++;
        var base = "elem_" + (idx < 10 ? "0" : "") + idx;
        var sil = new File(inF.fsName + "/" + base + "_silhouette.png");
        if (!sil.exists) break;

        var col = built % CONFIG.colsPerRow, row = Math.floor(built / CONFIG.colsPerRow);
        var ox = m + col * (cell + gap);
        var oy = -(m + row * (cell + gap));        // AI y-up: rows go downward (negative)
        buildOne(doc, layer, sil, ox, oy, cell);
        built++;
    }

    app.redraw();
    alert("Spine spike: built " + built + " element(s).\nInspect each cut vs its outline.");
}

function buildOne(doc, layer, silFile, ox, oy, cell) {
    // -- 1. Trace the silhouette --------------------------------------------------
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
    app.redraw();                                  // trace is async — force it
    var tg = pi.tracing.expandTracing();           // GroupItem of paths = the outline (all parts)

    // -- 2. White-edge offset -> bake to geometry --------------------------------
    // Offset the WHOLE traced group, not a single path, so multi-part elements
    // (wordmarks, maps with islands) all get a cut — not just their largest piece.
    var cut = tg.duplicate();
    applyOffset(doc, cut, CONFIG.whiteEdgeMm);
    cut = app.selection[0];
    if (CONFIG.bleedMm > 0) { applyOffset(doc, cut, CONFIG.bleedMm); cut = app.selection[0]; }

    // -- 3. Style for inspection: outline = light grey fill, cut = black stroke ---
    applyToPathTree(tg, function (p) {
        p.filled = true; p.stroked = false;
        try { p.fillColor = _grey(85); } catch (e) {}
    });
    strokeRecursive(cut, 0.5, blackCmyk());         // strokeRecursive also clears fill
}

// Applies one live Offset Path (round joins) and bakes it with expandStyle. The baked
// path is left as the sole selection. mlim=miter limit, ofst=offset pt, jntp=1 round.
function applyOffset(doc, item, mm) {
    var ofst = mmToPoints(mm);
    item.applyEffect('<LiveEffect name="Adobe Offset Path"><Dict data="R mlim 4 R ofst '
        + ofst + ' I jntp 1 "/></LiveEffect>');
    deselectAll(doc);
    item.selected = true;
    app.executeMenuCommand("expandStyle");
}

function deselectAll(doc) {
    var s = app.selection, i;
    if (!s) return;
    for (i = 0; i < s.length; i++) { try { s[i].selected = false; } catch (e) {} }
}

function _grey(pct) { var c = new GrayColor(); c.gray = pct; return c; }

try { main(); }
catch (e) { alert("Spike error line " + e.line + ": " + e.message); }
