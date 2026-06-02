// Step1_CombineElements.jsx — Phase function only.
// #included by pipeline scripts. Requires: psUtils.jsx, CONFIG in scope.
//
// Extracts all top-level element groups from source PSD files and places
// each as a named Smart Object in the Resize Area Template.

function runCombine(templateDoc, folder) {
    var files = folder.getFiles("*.psd");
    if (files.length === 0) {
        log("[step1] WARN: no .psd files found in source folder.");
        return { placed: 0, fileCount: 0 };
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

    app.playbackDisplayDialogs = DialogModes.NO;
    try {
        for (var i = 0; i < files.length; i++) {
            var fileName  = files[i].name;
            var sourceDoc = app.open(files[i]);
            log("[step1] opened | " + fileName);

            // First pass: collect matching group names only.
            // Using names (not references) — indices can shift after duplications.
            var groupNames = [];
            for (var j = 0; j < sourceDoc.layers.length; j++) {
                var srcLayer = sourceDoc.layers[j];
                if (srcLayer.typename === "LayerSet" && NAME_REGEX.test(srcLayer.name)) {
                    groupNames.push(srcLayer.name);
                }
            }
            log("[step1] found | " + groupNames.length + " group(s) in " + fileName);

            // Second pass: place each group or log what would happen.
            for (var k = 0; k < groupNames.length; k++) {
                var groupName  = groupNames[k];
                var parsed     = parseLayerName(groupName);
                var targetPx   = getTargetPx(parsed);
                var resizeNote = (targetPx !== null)
                    ? " -> resize to " + targetPx + "px"
                    : " -> WARN: unrecognised category, will skip at resize";

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

    return { placed: totalPlaced, fileCount: files.length };
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
