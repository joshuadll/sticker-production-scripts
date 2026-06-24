// tests/spike/ps_export_whiteedge_spike.jsx — THROWAWAY spike variant (delete after recipe lock).
// Like ps_export_silhouette_spike.jsx but exports the WHITE-EDGED silhouette: the proven Step2B
// recipe loadTransparency -> EXPAND(whiteEdgePx) -> smooth -> harden. The expand (raster dilation)
// merges nearby parts (wordmark letters), reconnects thin details (tram roof), and never
// self-intersects (flower notches) — so the traced boundary is the CUT, no AI offset needed.
// Black-on-white, trimmed.
//
// Run: open a real source PSD (named element art), then File > Scripts > Browse... -> this file.
#target photoshop
#include "../../utils/psUtils.jsx"

var CONFIG = {
    whiteEdgePx:    20,                 // raster dilation = the white edge (1.69mm @300DPI), Step2B value
    smoothRadiusPx: 20,                 // Step2B smooth radius
    padPx:          50,                 // crop padding (> whiteEdgePx + smoothRadiusPx)
    outFolder:      "~/Desktop/spine-spike-we"
};

function main() {
    var doc = app.activeDocument;
    var origUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var out = new Folder(CONFIG.outFolder);
    if (!out.exists) out.create();

    var refs = [], i;
    for (i = 0; i < doc.layers.length; i++) refs.push(doc.layers[i]);

    var n = 0;
    for (i = 0; i < refs.length; i++) {
        var lyr = refs[i];
        if (!parseLayerName(lyr.name)) continue;
        n++;
        var base = "elem_" + (n < 10 ? "0" : "") + n;
        var snap = doc.activeHistoryState;
        try {
            exportWhiteEdged(doc, refs, lyr, out.fsName + "/" + base + "_silhouette.png");
            $.writeln(base + "  " + lyr.name);
        } catch (e) {
            $.writeln("ERR " + base + " line " + e.line + ": " + e.message);
        }
        doc.activeHistoryState = snap;
    }

    app.preferences.rulerUnits = origUnits;
    alert("White-edge spike: exported " + n + " silhouette(s) to\n" + out.fsName);
}

function exportWhiteEdged(doc, refs, lyr, path) {
    // White-edged silhouette = Step2B recipe: alpha -> EXPAND -> smooth -> harden -> fill black.
    loadLayerTransparency(lyr);
    doc.selection.expand(CONFIG.whiteEdgePx);       // <-- the raster white edge (the offset)
    smoothSelection(CONFIG.smoothRadiusPx);
    hardenSelection(doc);
    var sil = doc.artLayers.add();
    sil.name = "__sil";
    doc.activeLayer = sil;
    doc.selection.fill(solidBlack());
    doc.selection.deselect();

    // White background below (black-on-white => clean Image Trace, no frame).
    var bg = doc.artLayers.add();
    bg.name = "__bg";
    bg.move(sil, ElementPlacement.PLACEAFTER);
    doc.activeLayer = bg;
    doc.selection.selectAll();
    doc.selection.fill(solidWhite());
    doc.selection.deselect();

    var j;
    for (j = 0; j < refs.length; j++) refs[j].visible = false;
    sil.visible = true;
    bg.visible  = true;

    // Crop to padded element bounds (+ the expand reach).
    var b = lyr.bounds, p = CONFIG.padPx;
    doc.crop([ b[0].as("px") - p, b[1].as("px") - p, b[2].as("px") + p, b[3].as("px") + p ]);

    var opt = new ExportOptionsSaveForWeb();
    opt.format       = SaveDocumentType.PNG;
    opt.PNG8         = false;
    opt.transparency = false;
    doc.exportDocument(new File(path), ExportType.SAVEFORWEB, opt);
}

try { main(); }
catch (e) { alert("Spike error line " + e.line + ": " + e.message); }
