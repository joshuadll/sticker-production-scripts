// Step11_FinalFile.jsx — Phase function only.
// #included by AI_ExportFinal.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Saves the working .ai file as {STK_CODE}_export/{STK_CODE}_final.ai (in the
// organized export tree beside the working file), then strips all non-production
// layers and standardises the halfcut layer name.
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
    // Ship the final file into the organized export tree (same {stkCode}_export/ root as
    // Step 10's previews/elements), not flat beside the working .ai.
    var exportRoot = ensureExportFolders(parentFolder, stkCode).root;
    var finalFile  = new File(exportRoot + "/" + stkCode + "_final.ai");

    log("[step11] saving final file: " + finalFile.fsName);
    // Ship a SELF-CONTAINED final file: embed every linked asset so {STK}_final.ai survives
    // being handed to another machine / the printer (a linked placement stores an absolute
    // path that breaks off-machine). Art is already embedded upstream (Step 7B); this also
    // catches the GC caption-plate raster and any other straggler at save time.
    var saveOpts = new IllustratorSaveOptions();
    saveOpts.embedLinkedFiles = true;
    doc.saveAs(finalFile, saveOpts);

    // After saveAs, app.activeDocument is now the final file.
    var fd = app.activeDocument;

    // Safety net: drop the spacing-buffer sublayer if it slipped through (AI_ExportFinal tears it
    // down up front, but a direct runFinalFile call would not) — the halo must never print.
    try { removeAllSpacingBuffers(fd); } catch (eBuf) {}

    // Standardise halfcut layer name.
    var halfcutLayer = _s11FindHalfcutLayer(fd);
    if (halfcutLayer) {
        halfcutLayer.name = CONFIG.finalHalfcutLayerName;
        log("[step11] halfcut layer → \"" + CONFIG.finalHalfcutLayerName + "\"");
    } else {
        log("[step11] WARN | halfcut layer not found — skipping rename.");
    }

    // Remove non-production layers. Iterate backwards — safe when items are removed.
    // The QA overlay (flags + pocket fills) is stripped by its shared name
    // (QA_LAYER_NAME, lowercased to match _s11InList); "nqi pockets" is the legacy
    // name. Strip by name so a stray QA layer the artist forgot to hide never prints.
    var REMOVE = ["margin", "offset path", "grid", "color block",
                  QA_LAYER_NAME.toLowerCase(), "nqi pockets"];
    var i;
    for (i = fd.layers.length - 1; i >= 0; i--) {
        if (_s11InList(fd.layers[i].name.toLowerCase(), REMOVE)) {
            log("[step11] removing layer: " + fd.layers[i].name);
            // buildWorkingDocument creates Margin/Grid/Color Block LOCKED, and
            // layer.remove() throws "Trying to delete locked layer" — unlock first.
            fd.layers[i].locked  = false;
            fd.layers[i].visible = true;
            fd.layers[i].remove();
        }
    }

    var layerCount = fd.layers.length;
    if (layerCount !== 3) {
        log("[step11] WARN | expected 3 layers in final file, found " + layerCount
            + " — check final file manually.");
    }

    // Persist the layer-stripped file with EXPLICIT save options. A bare fd.save()
    // pops Illustrator's native "Options" save dialog, which blocks a headless/
    // scripted run (AppleEvent hangs). Re-use the same IllustratorSaveOptions as the
    // saveAs above so the write is silent and self-contained (links embedded).
    fd.saveAs(finalFile, saveOpts);
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
