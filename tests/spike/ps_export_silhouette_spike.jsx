// tests/spike/ps_export_silhouette_spike.jsx — THROWAWAY spike (delete after recipe lock).
// Exports a clean BLACK-ON-WHITE, trimmed-to-element silhouette PNG per element from the
// active source PSD, using the proven alpha -> smooth -> harden recipe. Black-on-white
// (not transparent) so Image Trace reads luminance cleanly and never traces a canvas frame;
// trimmed so the element fills the image at usable resolution.
//
// Run: open a real source PSD whose top-level layers are element art named per the
// convention, then File > Scripts > Browse... -> this file.
#target photoshop
#include "../../utils/psUtils.jsx"

var CONFIG = {
    smoothRadiusPx: 12,                 // SPIKE TUNABLE — blur to kill jaggedness without losing detail
    padPx:          12,                 // crop padding around the element (>= smoothRadiusPx)
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

        // Per-element history anchor: all the per-element edits (silhouette layer, white bg,
        // crop, visibility) are reverted by restoring to this state, leaving the doc pristine
        // for the next element. The anchor is the same pristine state every iteration, so it
        // is never purged from the history buffer.
        var snap = doc.activeHistoryState;
        try {
            exportSilhouette(doc, refs, lyr, out.fsName + "/" + base + "_silhouette.png");
            $.writeln(base + "  " + lyr.name);
        } catch (e) {
            $.writeln("ERR " + base + " line " + e.line + ": " + e.message);
        }
        doc.activeHistoryState = snap;                  // revert crop + temp layers + visibility
    }

    app.preferences.rulerUnits = origUnits;
    alert("Spike: exported " + n + " silhouette(s) to\n" + out.fsName);
}

function exportSilhouette(doc, refs, lyr, path) {
    // 1. Black silhouette of the art alpha: load transparency -> smooth -> harden -> fill black.
    loadLayerTransparency(lyr);
    smoothSelection(CONFIG.smoothRadiusPx);
    hardenSelection(doc);
    var sil = doc.artLayers.add();
    sil.name = "__sil";
    doc.activeLayer = sil;
    doc.selection.fill(solidBlack());
    doc.selection.deselect();

    // 2. White background BELOW the silhouette so the export is black-on-white (clean trace).
    var bg = doc.artLayers.add();
    bg.name = "__bg";
    bg.move(sil, ElementPlacement.PLACEAFTER);
    doc.activeLayer = bg;
    doc.selection.selectAll();
    doc.selection.fill(solidWhite());
    doc.selection.deselect();

    // 3. Isolate: only the silhouette + white bg visible.
    var j;
    for (j = 0; j < refs.length; j++) refs[j].visible = false;
    sil.visible = true;
    bg.visible  = true;

    // 4. Crop to the padded element bounds so the element fills the image.
    var b = lyr.bounds, p = CONFIG.padPx;
    doc.crop([ b[0].as("px") - p, b[1].as("px") - p, b[2].as("px") + p, b[3].as("px") + p ]);

    // 5. Export black-on-white (no transparency).
    var opt = new ExportOptionsSaveForWeb();
    opt.format       = SaveDocumentType.PNG;
    opt.PNG8         = false;
    opt.transparency = false;
    doc.exportDocument(new File(path), ExportType.SAVEFORWEB, opt);
}

try { main(); }
catch (e) { alert("Spike error line " + e.line + ": " + e.message); }
