// Step5b_ExportHandoff.jsx — export helpers for Pipeline 1 (Build Elements).
// #included by PS_BuildElements.jsx. Requires: psUtils.jsx, json2.jsx, Step5_Silhouette.jsx
// (createSilhouetteLayer), CONFIG in scope.
//
// Owns the per-SKU export artifacts written next to the working PSD, before the BridgeTalk
// handoff to Illustrator:
//   {name}_silhouette.png      element-art-only flat black PNG (captions excluded; AI adds them)
//   {name}_elements.json       SLIM sidecar: { psdWidth, psdHeight, elements:[{displayName,
//                              styleCode, left, top, right, bottom}] } — NO caption payload
//                              (captions are authored natively in Illustrator; styleCode alone
//                              tells AI which elements get a caption/plate).
//   {name}_elements/           per-element ART PNGs (one per element group; no caption PNGs).
//   {name}_caption_plate.png   GC SKUs only: the decorative plate artwork (imported by Step 1),
//                              for AI to place + scale behind the native caption text.
// (handOffToIllustrator — the BridgeTalk orchestration — lives in the pipeline, PS_BuildElements.)


// ─── SILHOUETTE PNG ────────────────────────────────────────────────────────────
// Builds the transient element-art-only silhouette layer (createSilhouetteLayer, Step 5),
// exports it to {name}_silhouette.png, then removes it. The working PSD is never polluted.
function exportSilhouettePng(doc) {
    var silLayer = createSilhouetteLayer(doc); // transient; removed below
    if (!silLayer) {
        log("[step5b] ERROR | could not build silhouette — cannot export PNG.");
        return null;
    }

    var pngPath = doc.fullName.fsName.replace(/\.psd$/i, "_silhouette.png");

    var i;
    var layers = doc.layers;
    var visibilities = [];
    for (i = 0; i < layers.length; i++) {
        visibilities[i] = layers[i].visible;
        layers[i].visible = false;
    }
    silLayer.visible = true;

    var opts = new ExportOptionsSaveForWeb();
    opts.format       = SaveDocumentType.PNG;
    opts.PNG8         = false;
    opts.transparency = false;
    opts.interlaced   = false;
    // Save-for-Web sanitises spaces/punctuation OUT of the output filename and silently
    // NO-OPs over an existing file. Export to a space-free temp name, then rename to the
    // real (spaced/unicode) target so Step 6 finds the exact name it expects.
    var outFile  = new File(pngPath);
    var leafName = pngPath.substring(pngPath.lastIndexOf("/") + 1);
    var tmpFile  = new File(outFile.parent.fsName + "/__silhouette_tmp.png");
    if (tmpFile.exists) tmpFile.remove();
    doc.exportDocument(tmpFile, ExportType.SAVEFORWEB, opts);
    if (tmpFile.exists) {
        if (outFile.exists) outFile.remove();
        tmpFile.rename(leafName);
    }

    for (i = 0; i < layers.length; i++) {
        layers[i].visible = visibilities[i];
    }
    silLayer.remove();

    if (!outFile.exists) {
        log("[step5b] ERROR | silhouette PNG not written (Save-for-Web no-op?): " + pngPath);
        return null;
    }

    log("[step5b] exported silhouette PNG (transient layer removed): " + pngPath);
    return pngPath;
}


// ─── SLIM SIDECAR ──────────────────────────────────────────────────────────────
// Writes {name}_elements.json: doc dims + per element {displayName, styleCode, bounds}.
// NO caption payload — captions are native in Illustrator; styleCode decides caption/plate.
function writeElementsFile(doc) {
    var elementsGroup = findLayerByName(doc, "Elements");
    if (!elementsGroup) {
        log("[step5b] ERROR | Elements group not found — cannot write elements sidecar.");
        return null;
    }

    var prevUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var psdW = Math.round(doc.width.as("px"));
    var psdH = Math.round(doc.height.as("px"));
    var data = { psdWidth: psdW, psdHeight: psdH, elements: [] };

    var i;
    for (i = 0; i < elementsGroup.layerSets.length; i++) {
        var grp    = elementsGroup.layerSets[i];
        var parsed = parseLayerName(grp.name);
        if (!parsed) continue;
        var b = grp.bounds; // [left, top, right, bottom] UnitValues
        data.elements.push({
            displayName: parsed.displayName,
            styleCode:   parsed.styleCode,
            left:   Math.round(b[0].as("px")),
            top:    Math.round(b[1].as("px")),
            right:  Math.round(b[2].as("px")),
            bottom: Math.round(b[3].as("px"))
        });
    }

    app.preferences.rulerUnits = prevUnits;

    var jsonPath = doc.fullName.fsName.replace(/\.psd$/i, "_elements.json");
    var f = new File(jsonPath);
    f.encoding = "UTF-8";
    if (!f.open("w")) {
        log("[step5b] ERROR | could not open elements sidecar for writing: " + jsonPath);
        return null;
    }
    if (!f.write(JSON.stringify(data))) {
        log("[step5b] ERROR | write failed for elements sidecar: " + jsonPath);
        f.close();
        return null;
    }
    f.close();

    log("[step5b] wrote elements sidecar: " + jsonPath + " (" + data.elements.length + " element(s))");
    return jsonPath;
}


// ─── PER-ELEMENT ART PNGs ────────────────────────────────────────────────────────
// Exports each element group as a trimmed transparent PNG into {name}_elements/. ART ONLY —
// no caption PNGs (captions are native in Illustrator). Returns the folder path, or null.
function exportElementPngs(doc) {
    var elementsGroup = findLayerByName(doc, "Elements");
    if (!elementsGroup) {
        log("[step5b] WARN | Elements group not found — skipping element PNG export.");
        return null;
    }

    var baseName   = doc.fullName.fsName.replace(/\.psd$/i, "");
    var folderPath = baseName + "_elements";
    var folder     = new Folder(folderPath);
    if (!folder.exists) folder.create();

    var prevUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var topLayers = doc.layers, topVis = [], i;
    for (i = 0; i < topLayers.length; i++) {
        topVis[i] = topLayers[i].visible;
        topLayers[i].visible = false;
    }
    elementsGroup.visible = true;

    var subVis = [], sv;
    for (sv = 0; sv < elementsGroup.layerSets.length; sv++) {
        subVis[sv] = elementsGroup.layerSets[sv].visible;
    }

    var artCount = _exportElementPass(doc, elementsGroup, folderPath);

    for (sv = 0; sv < elementsGroup.layerSets.length; sv++) {
        elementsGroup.layerSets[sv].visible = subVis[sv];
    }
    for (i = 0; i < topLayers.length; i++) {
        topLayers[i].visible = topVis[i];
    }

    app.preferences.rulerUnits = prevUnits;
    log("[step5b] element PNGs: " + artCount + " art file(s) → " + folderPath);
    return folderPath;
}

// Exports each element group as "{displayName}.png" (trimmed transparent). Isolates each
// group (hides siblings) before the trim. Returns the count exported.
function _exportElementPass(doc, elementsGroup, folderPath) {
    var count = 0, j, k, grp, parsed, safeName;
    for (j = 0; j < elementsGroup.layerSets.length; j++) {
        grp    = elementsGroup.layerSets[j];
        parsed = parseLayerName(grp.name);
        if (!parsed) continue;

        for (k = 0; k < elementsGroup.layerSets.length; k++) {
            elementsGroup.layerSets[k].visible = false;
        }
        grp.visible = true;

        safeName = parsed.displayName.replace(/[\/\\:*?"<>|]/g, "_");
        if (CONFIG.dryRun) {
            log("[step5b] [DRY RUN] would export element PNG: " + safeName);
            continue;
        }
        if (_exportTrimmedPng(doc, folderPath, safeName)) {
            count++;
            log("[step5b] element PNG: " + safeName);
        }
    }
    return count;
}

// Duplicate → trim to transparent bounds → export PNG → rename (temp-name dance works around
// PS 2026 Save-For-Web no-op-over-existing + space-mangle quirks). Returns true on success.
function _exportTrimmedPng(doc, folderPath, fileBase) {
    var dup = null, ok = false;
    try {
        dup = doc.duplicate();
        dup.trim(TrimType.TRANSPARENT, true, true, true, true);
        var pngOpts          = new ExportOptionsSaveForWeb();
        pngOpts.format       = SaveDocumentType.PNG;
        pngOpts.PNG8         = false;
        pngOpts.transparency = true;
        pngOpts.interlaced   = false;
        var tmpFile = new File(folderPath + "/__export_tmp.png");
        if (tmpFile.exists) tmpFile.remove();
        dup.exportDocument(tmpFile, ExportType.SAVEFORWEB, pngOpts);
        var outFile = new File(folderPath + "/" + fileBase + ".png");
        if (outFile.exists) outFile.remove();
        tmpFile.rename(fileBase + ".png");
        ok = true;
    } catch (e) {
        log("[step5b] WARN | failed to export " + fileBase + ": " + e.message);
    }
    if (dup) dup.close(SaveOptions.DONOTSAVECHANGES);
    app.activeDocument = doc;
    return ok;
}


// ─── GC CAPTION PLATE PNG ────────────────────────────────────────────────────────
// GC SKUs only: exports the decorative "Caption plate" layer (imported by Step 1 from
// Caption_Plate.psd) to {name}_caption_plate.png, for AI to place + scale behind the native
// caption text. Returns the path, or null when there is no plate layer (WC-only SKU).
function exportCaptionPlatePng(doc) {
    var plate = findLayerByName(doc, "Caption plate");
    if (!plate) {
        log("[step5b] no Caption plate layer — WC-only SKU, skipping plate PNG.");
        return null;
    }

    var pngPath  = doc.fullName.fsName.replace(/\.psd$/i, "_caption_plate.png");
    var prevUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var layers = doc.layers, vis = [], i;
    for (i = 0; i < layers.length; i++) { vis[i] = layers[i].visible; layers[i].visible = false; }
    plate.visible = true;

    var ok = false, dup = null;
    try {
        dup = doc.duplicate();
        dup.trim(TrimType.TRANSPARENT, true, true, true, true);
        var o = new ExportOptionsSaveForWeb();
        o.format = SaveDocumentType.PNG; o.PNG8 = false; o.transparency = true; o.interlaced = false;
        var tmp = new File(doc.fullName.parent.fsName + "/__plate_tmp.png");
        if (tmp.exists) tmp.remove();
        dup.exportDocument(tmp, ExportType.SAVEFORWEB, o);
        var leaf = pngPath.substring(pngPath.lastIndexOf("/") + 1);
        var out  = new File(pngPath);
        if (tmp.exists) { if (out.exists) out.remove(); tmp.rename(leaf); ok = true; }
    } catch (e) {
        log("[step5b] WARN | plate PNG export failed: " + e.message);
    }
    if (dup) dup.close(SaveOptions.DONOTSAVECHANGES);
    app.activeDocument = doc;

    for (i = 0; i < layers.length; i++) layers[i].visible = vis[i];
    app.preferences.rulerUnits = prevUnits;

    if (!ok) { log("[step5b] ERROR | caption plate PNG not written: " + pngPath); return null; }
    log("[step5b] exported caption plate PNG: " + pngPath);
    return pngPath;
}
