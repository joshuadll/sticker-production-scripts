// Step11_FinalFile.jsx — Phase function only.
// #included by AI_ExportFinal.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Saves the working .ai file as {STK_CODE}_final.ai (sibling on disk), then
// strips all non-production layers and standardises the halfcut layer name.
//
// The working file is untouched on disk — saveAs creates a new file and all
// layer edits apply only to the final copy.
//
// Returns: { outputPath: String, layerCount: N }

function runFinalFile(doc) {
    if (CONFIG.dryRun) {
        log("[step11] [DRY RUN] would save final file and strip non-production layers.");
        return { outputPath: "", layerCount: 0 };
    }

    var parentFolder;
    try {
        parentFolder = doc.fullName.parent.fsName;
    } catch (e) {
        throw new Error("Document must be saved before running Step 11.");
    }

    var stkCode   = doc.name.replace(/\.[^.]+$/, "").split(" ")[0];
    var finalFile = new File(parentFolder + "/" + stkCode + "_final.ai");

    log("[step11] saving final file: " + finalFile.fsName);
    doc.saveAs(finalFile, new IllustratorSaveOptions());

    // After saveAs, app.activeDocument is now the final file.
    var fd = app.activeDocument;

    // Standardise halfcut layer name.
    var halfcutLayer = _s11FindHalfcutLayer(fd);
    if (halfcutLayer) {
        halfcutLayer.name = CONFIG.finalHalfcutLayerName;
        log("[step11] halfcut layer → \"" + CONFIG.finalHalfcutLayerName + "\"");
    } else {
        log("[step11] WARN | halfcut layer not found — skipping rename.");
    }

    // Remove non-production layers. Iterate backwards — safe when items are removed.
    // "layout qa" (and legacy "nqi pockets") = the QA overlay — flags + pocket fills;
    // strip by name so a stray QA layer the artist forgot to hide never reaches print.
    var REMOVE = ["margin", "offset path", "grid", "color block",
                  "layout qa", "nqi pockets"];
    var i;
    for (i = fd.layers.length - 1; i >= 0; i--) {
        if (_s11InList(fd.layers[i].name.toLowerCase(), REMOVE)) {
            log("[step11] removing layer: " + fd.layers[i].name);
            fd.layers[i].remove();
        }
    }

    var layerCount = fd.layers.length;
    if (layerCount !== 3) {
        log("[step11] WARN | expected 3 layers in final file, found " + layerCount
            + " — check final file manually.");
    }

    fd.save();
    log("[step11] done | " + finalFile.fsName + " | layers=" + layerCount);
    return { outputPath: finalFile.fsName, layerCount: layerCount };
}


// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

// Finds the halfcut layer by case-insensitive name. Matches any layer whose
// name contains "halfcut" or "half cut" (handles all observed name variants).
function _s11FindHalfcutLayer(doc) {
    for (var i = 0; i < doc.layers.length; i++) {
        var n = doc.layers[i].name.toLowerCase();
        if (n.indexOf("halfcut") !== -1 || n.indexOf("half cut") !== -1) {
            return doc.layers[i];
        }
    }
    return null;
}

function _s11InList(val, arr) {
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] === val) return true;
    }
    return false;
}
