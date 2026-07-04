// Step1_CombineElements.jsx — Phase function only.
// #included by pipeline scripts. Requires: psUtils.jsx, CONFIG in scope.
//
// Extracts all top-level element layers from source PSD files and places
// each as a named Smart Object in the Resize Area Template.
// Accepts both LayerSet (folder groups) and ArtLayer (Smart Objects / flat layers).

// Top-level layers we expect NOT to be elements — stay silent about these.
// Every OTHER top-level layer that isn't importable is warned, so an element that
// was never tagged (no bracket, no style code) can't vanish silently. Background is
// always benign; add more via CONFIG.ignoreTopLevelLayers for source PSDs that
// legitimately keep helper layers (guides, colour references) at the top level.
function isBenignLayer(name) {
    var key = name.replace(/^\s+|\s+$/g, "").toLowerCase();
    if (key === "background") return true;
    var extra = (typeof CONFIG !== "undefined" && CONFIG.ignoreTopLevelLayers) || [];
    for (var i = 0; i < extra.length; i++) {
        if (String(extra[i]).replace(/^\s+|\s+$/g, "").toLowerCase() === key) return true;
    }
    return false;
}

// The only style codes the pipeline understands. A name can match NAME_REGEX yet
// still be unusable downstream.
var VALID_STYLES = { WC: true, GC: true, ST: true };

// A name is importable only if it parses, its style is one we handle, AND we know
// how big to make it. getTargetPx returns null for a missing/unknown category (and
// handles ST's fixed size), so it's the single source of truth for "known category"
// — no need to duplicate the category list here. This rejects names like "[WC-ZZ]"
// (unknown category), "[WC]" (non-stamp with no category) and "[XX-LM]" (unknown
// style) that would otherwise import and then break at resize / caption.
function isImportableName(name) {
    var parsed = parseLayerName(name);
    if (!parsed) return false;
    if (!VALID_STYLES[parsed.styleCode]) return false;
    return getTargetPx(parsed) !== null;
}

function runCombine(templateDoc, folder) {
    var files = folder.getFiles("*.psd");
    if (files.length === 0) {
        log("[step1] WARN: no .psd files found in source folder.");
        return { placed: 0, fileCount: 0, notImported: [] };
    }
    log("[step1] found | " + files.length + " PSD file(s) in source folder.");

    if (CONFIG.dryRun) {
        log("[step1] [DRY RUN] would clear element layers from template.");
    } else {
        log("[step1] clearing element layers from template...");
        clearElementLayers(templateDoc);
        log("[step1] template cleared.");
    }

    var totalPlaced = 0;
    var notImported = [];   // {name, file, reason} — layers we couldn't import (each warned)

    app.playbackDisplayDialogs = DialogModes.NO;
    try {
        // Pre-scan every file to count importable names. A name that appears more
        // than once (within one file or across files) is a DUPLICATE — we can't tell
        // which layer is the real one, so we import NONE of them and warn.
        var nameCounts = {};
        for (var pf = 0; pf < files.length; pf++) {
            var preDoc = app.open(files[pf]);
            for (var pl = 0; pl < preDoc.layers.length; pl++) {
                var preLayer = preDoc.layers[pl];
                if (preLayer.typename === "ArtLayer" && isImportableName(preLayer.name)) {
                    nameCounts[preLayer.name] = (nameCounts[preLayer.name] || 0) + 1;
                }
            }
            preDoc.close(SaveOptions.DONOTSAVECHANGES);
        }
        var dupWarned = {};   // warn each duplicated name once (it recurs across layers/files)

        for (var i = 0; i < files.length; i++) {
            var fileName  = files[i].name;
            var sourceDoc = app.open(files[i]);
            log("[step1] opened | " + fileName);

            // First pass: classify each TOP-LEVEL layer. An element must be an
            // ungrouped Smart Object at the top level with a valid, unique name.
            // Anything else that isn't a benign helper (Background /
            // CONFIG.ignoreTopLevelLayers) is recorded so the artist is warned
            // instead of it silently dropping:
            //   • LayerSet (folder)          → not allowed; elements must be top-level
            //   • duplicate valid name       → ambiguous; import none
            //   • un-importable, not benign  → invalid / mis-coded name
            // Using names (not references) — indices can shift after duplications.
            var groupNames = [];
            var fails      = [];   // {name, reason} for THIS file, logged after the count
            for (var j = 0; j < sourceDoc.layers.length; j++) {
                var srcLayer = sourceDoc.layers[j];
                if (srcLayer.typename === "LayerSet") {
                    fails.push({ name: srcLayer.name, reason: "folder" });
                } else if (srcLayer.typename === "ArtLayer") {
                    if (isImportableName(srcLayer.name)) {
                        if (nameCounts[srcLayer.name] >= 2) {
                            if (!dupWarned[srcLayer.name]) {
                                dupWarned[srcLayer.name] = true;
                                fails.push({ name: srcLayer.name, reason: "duplicate name" });
                            }
                        } else {
                            groupNames.push(srcLayer.name);
                        }
                    } else if (!isBenignLayer(srcLayer.name)) {
                        fails.push({ name: srcLayer.name, reason: "invalid name" });
                    }
                }
            }
            log("[step1] found | " + groupNames.length + " group(s) in " + fileName);
            for (var b = 0; b < fails.length; b++) {
                log("[step1] NOT IMPORTED (" + fails[b].reason + ") | \"" + fails[b].name + "\" in " + fileName);
                notImported.push({ name: fails[b].name, file: fileName, reason: fails[b].reason });
            }

            // Second pass: place each group or log what would happen.
            for (var k = 0; k < groupNames.length; k++) {
                var groupName  = groupNames[k];
                // groupNames only holds importable names, so getTargetPx is always
                // non-null here (isImportableName already gated on it).
                var targetPx   = getTargetPx(parseLayerName(groupName));
                var resizeNote = " -> resize to " + targetPx + "px";

                if (CONFIG.dryRun) {
                    log("[step1] [DRY RUN] would place | " + groupName + " from " + fileName + resizeNote);
                    totalPlaced++;
                    continue;
                }

                // Re-find by name in case indices shifted during previous duplications.
                var layerToDuplicate = null;
                for (var m = 0; m < sourceDoc.layers.length; m++) {
                    if (sourceDoc.layers[m].name === groupName) {
                        layerToDuplicate = sourceDoc.layers[m];
                        break;
                    }
                }
                if (!layerToDuplicate) {
                    log("[step1] SKIP | \"" + groupName + "\" not found at placement time in " + fileName);
                    continue;
                }

                layerToDuplicate.duplicate(templateDoc, ElementPlacement.PLACEATBEGINNING);
                app.activeDocument = templateDoc;
                templateDoc.activeLayer = templateDoc.layers[0];
                convertToSmartObject();
                templateDoc.activeLayer.name = groupName; // re-assert after SO conversion
                app.activeDocument = sourceDoc;

                log("[step1] placed | " + groupName + " from " + fileName + resizeNote);
                totalPlaced++;
            }

            sourceDoc.close(SaveOptions.DONOTSAVECHANGES);
            log("[step1] closed | " + fileName);

            if (!CONFIG.dryRun) {
                app.activeDocument = templateDoc;
            }
        }
    } finally {
        app.playbackDisplayDialogs = DialogModes.ERROR;
    }

    importCaptionPlateFile(folder, templateDoc);

    return { placed: totalPlaced, fileCount: files.length, notImported: notImported };
}

// Imports Caption_Plate.psd from the source folder into the template as a
// top-level group named "Caption plate". Only needed for GC-LM SKUs — silently
// skips if the file is absent (WC-only SKUs don't include it).
function importCaptionPlateFile(folder, templateDoc) {
    var plateFile = new File(folder.fsName + "/Caption_Plate.psd");
    if (!plateFile.exists) return;

    if (CONFIG.dryRun) {
        log("[step1] [DRY RUN] would import | Caption_Plate.psd");
        return;
    }

    var plateDoc = app.open(plateFile);

    var sourcePlate = (plateDoc.layers.length > 0) ? plateDoc.layers[0] : null;
    if (!sourcePlate) {
        plateDoc.close(SaveOptions.DONOTSAVECHANGES);
        log("[step1] WARN | Caption_Plate.psd has no layers — skipping.");
        return;
    }

    sourcePlate.duplicate(templateDoc, ElementPlacement.PLACEATBEGINNING);
    plateDoc.close(SaveOptions.DONOTSAVECHANGES);

    app.activeDocument = templateDoc;

    // Replace any existing Caption plate (re-run guard).
    var existing = findLayerByName(templateDoc, "Caption plate");
    if (existing && existing !== templateDoc.layers[0]) existing.remove();

    templateDoc.layers[0].name = "Caption plate";
    log("[step1] imported | Caption plate from Caption_Plate.psd");
}
