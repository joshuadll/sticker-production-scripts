// tests/spike/ps_export_silhouette_spike.jsx — THROWAWAY spike (delete after recipe lock).
// Exports a clean black silhouette PNG per element from the active source PSD, using the
// proven alpha -> smooth -> harden recipe (the thin-PS exporter's core), minus the white edge.
//
// Run: open a real source PSD whose top-level layers are element art named per the
// convention, then File > Scripts > Browse... -> this file.
#target photoshop
#include "../../utils/psUtils.jsx"

var CONFIG = {
    smoothRadiusPx: 12,                 // SPIKE TUNABLE — blur to kill jaggedness without losing detail
    outFolder:      "~/Desktop/spine-spike"
};

function main() {
    var doc = app.activeDocument;
    var origUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var out = new Folder(CONFIG.outFolder);
    if (!out.exists) out.create();

    // Snapshot top-level layers (adding/removing layers re-indexes doc.layers mid-loop).
    var refs = [], i;
    for (i = 0; i < doc.layers.length; i++) refs.push(doc.layers[i]);

    var n = 0;
    for (i = 0; i < refs.length; i++) {
        var lyr = refs[i];
        if (!parseLayerName(lyr.name)) continue;        // only named element layers
        n++;
        var base = "elem_" + (n < 10 ? "0" : "") + n;

        // Build the silhouette: alpha -> smooth -> harden -> fill black on a temp layer.
        loadLayerTransparency(lyr);
        smoothSelection(CONFIG.smoothRadiusPx);
        hardenSelection(doc);
        var sil = doc.artLayers.add();
        sil.name = "__sil";
        doc.selection.fill(solidBlack());
        doc.selection.deselect();

        // Isolate the black shape: hide every other layer, keep only the temp silhouette.
        var j;
        for (j = 0; j < refs.length; j++) refs[j].visible = false;
        sil.visible = true;

        exportPng(doc, out.fsName + "/" + base + "_silhouette.png");
        $.writeln(base + "  " + lyr.name);

        // Cleanup: remove temp layer, restore all visibility for the next element.
        sil.remove();
        for (j = 0; j < refs.length; j++) refs[j].visible = true;
    }

    app.preferences.rulerUnits = origUnits;
    alert("Spike: exported " + n + " silhouette(s) to\n" + out.fsName);
}

function exportPng(doc, path) {
    var opt = new ExportOptionsSaveForWeb();
    opt.format       = SaveDocumentType.PNG;
    opt.PNG8         = false;
    opt.transparency = true;
    doc.exportDocument(new File(path), ExportType.SAVEFORWEB, opt);
}

try { main(); }
catch (e) { alert("Spike error line " + e.line + ": " + e.message); }
