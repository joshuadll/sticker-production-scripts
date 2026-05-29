#target photoshop

// ─── CONFIG ───────────────────────────────────────────────────────────────────

var CONFIG = {
    dryRun: false,

    // ⚠️  CONFIRM WITH ARTIST before first run:
    // Exact name of the sheet-boundary / guide layer in the Resize Area Template.
    // This layer is preserved when the template is cleared on re-run.
    // All other top-level layers are removed. Wrong name = that layer gets deleted.
    skipLayerName: "Guide",

    templateWidthCm: 42,
    templateDPI:     300,

    // For automated testing only — leave empty ("") for normal interactive use.
    // When set, the folder-picker dialog is skipped and this path is used instead.
    sourceFolderPath: "",

    // For automated testing only — suppresses alert() dialogs so the script
    // can run headlessly. All alerts are still written to the log file.
    suppressAlerts: false,

    logPath: "", // resolved below — same folder as this script

    // Pixel targets at 300 DPI (longest edge).
    // Keys are category codes from the element naming convention.
    sizeTable: {
        "TL": 900,  // Title / location name        3 in
        "LM": 690,  // Landmark / attraction         2.3 in
        "MP": 570,  // Map / subway / station sign   1.9 in (midpoint 1.8–2)
        "TR": 570,  // Transportation                1.9 in (midpoint 1.8–2)
        "IC": 540,  // Cultural icon / symbol        1.8 in
        "FD": 525,  // Food / local cuisine          1.75 in (midpoint 1.5–2)
        "ST": 450   // Stamp (style code, no cat)    1.5 in
    }
};

// Log to the same folder as this script; fall back to Desktop if path unavailable.
CONFIG.logPath = ($.fileName
    ? new File($.fileName).parent.fsName
    : Folder.desktop.fsName) + "/ProductionFileScript.log";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

var STEP_NAME = "step1-2";

// Matches "Horseshoe Bend [WC-LM]" → captures (Horseshoe Bend)(WC)(LM)
// Matches "Orlando Stamp [ST]"     → captures (Orlando Stamp)(ST)(undefined)
var NAME_REGEX = /^(.+)\s\[([A-Z]+)(?:-([A-Z]+))?\]$/;

// ─── PURE HELPERS ─────────────────────────────────────────────────────────────
// No Adobe API calls — logic only.

function parseLayerName(name) {
    var m = name.match(NAME_REGEX);
    if (!m) return null;
    return {
        displayName: m[1],
        styleCode:   m[2],
        catCode:     m[3] || null
    };
}

// Returns target pixel size, or null if unrecognised.
// Stamps use styleCode "ST" directly — no catCode in their name.
function getTargetPx(parsed) {
    if (!parsed) return null;
    if (parsed.styleCode === "ST") return CONFIG.sizeTable["ST"];
    if (parsed.catCode && CONFIG.sizeTable[parsed.catCode] !== undefined) {
        return CONFIG.sizeTable[parsed.catCode];
    }
    return null;
}

function longestEdge(bounds) {
    var w = bounds[2] - bounds[0];
    var h = bounds[3] - bounds[1];
    return (w >= h) ? w : h;
}

function scalePercent(currentPx, targetPx) {
    return (targetPx / currentPx) * 100;
}

// ─── DOM HELPERS ──────────────────────────────────────────────────────────────
// Thin wrappers around Adobe API — no logic.

function log(msg) {
    var line = "[" + STEP_NAME + "] " + msg;
    $.writeln(line);
    var f = new File(CONFIG.logPath);
    f.open("a");
    f.writeln(line);
    f.close();
}

function scriptAlert(msg) {
    log("alert | " + msg);
    if (!CONFIG.suppressAlerts) {
        alert(msg);
    }
}

// Removes all top-level layers except CONFIG.skipLayerName.
// Loops backwards to avoid index shifting on removal.
function clearNonGuideLayers(doc) {
    for (var i = doc.layers.length - 1; i >= 0; i--) {
        if (doc.layers[i].name !== CONFIG.skipLayerName) {
            doc.layers[i].remove();
        }
    }
}

// Converts the currently active layer to an embedded Smart Object.
function convertToSmartObject() {
    executeAction(
        stringIDToTypeID("newPlacedLayer"),
        new ActionDescriptor(),
        DialogModes.NO
    );
}

// Resizes layer proportionally so its longest edge equals targetPx,
// anchored at layer centre. Caller must set ruler units to PIXELS first.
// Returns false if layer has zero bounds (hidden or empty); true otherwise.
function resizeLayerToTarget(layer, targetPx) {
    var bounds  = layer.bounds;
    var longest = longestEdge(bounds);
    if (longest === 0) return false;
    var pct = scalePercent(longest, targetPx);
    layer.resize(pct, pct, AnchorPosition.MIDDLECENTER);
    return true;
}

// ─── PHASE 1: COMBINE ─────────────────────────────────────────────────────────

function runCombine(templateDoc, folder) {
    var files = folder.getFiles("*.psd");
    if (files.length === 0) {
        log("WARN: no .psd files found in source folder.");
        return { placed: 0, fileCount: 0 };
    }
    log("found | " + files.length + " PSD file(s) in source folder.");

    // Verify the skip layer exists before clearing — wrong name = data loss.
    var skipLayerFound = false;
    for (var g = 0; g < templateDoc.layers.length; g++) {
        if (templateDoc.layers[g].name === CONFIG.skipLayerName) {
            skipLayerFound = true;
            break;
        }
    }
    if (!skipLayerFound) {
        log("WARN: layer \"" + CONFIG.skipLayerName + "\" not found in template. "
            + "Update CONFIG.skipLayerName. Skipping clear step — old layers preserved.");
    }

    if (CONFIG.dryRun) {
        log("[DRY RUN] would clear non-\"" + CONFIG.skipLayerName + "\" layers from template.");
    } else if (skipLayerFound) {
        log("clearing template (preserving \"" + CONFIG.skipLayerName + "\" layer)...");
        clearNonGuideLayers(templateDoc);
        log("template cleared.");
    }

    var totalPlaced = 0;

    app.playbackDisplayDialogs = DialogModes.NO;
    try {
        for (var i = 0; i < files.length; i++) {
            var fileName  = files[i].name;
            var sourceDoc = app.open(files[i]);
            log("opened | " + fileName);

            // First pass: collect matching group names only.
            // Names are stable; layer references can shift after duplications.
            var groupNames = [];
            for (var j = 0; j < sourceDoc.layers.length; j++) {
                var srcLayer = sourceDoc.layers[j];
                if (srcLayer.typename === "LayerSet" && NAME_REGEX.test(srcLayer.name)) {
                    groupNames.push(srcLayer.name);
                }
            }
            log("found | " + groupNames.length + " element group(s) in " + fileName);

            // Second pass: place or log each group.
            for (var k = 0; k < groupNames.length; k++) {
                var groupName  = groupNames[k];
                var parsed     = parseLayerName(groupName);
                var targetPx   = getTargetPx(parsed);
                var resizeNote = (targetPx !== null)
                    ? " -> resize to " + targetPx + "px"
                    : " -> WARN: unrecognised category, will skip at resize";

                if (CONFIG.dryRun) {
                    log("[DRY RUN] would place | " + groupName + " from " + fileName + resizeNote);
                    totalPlaced++;
                    continue;
                }

                // Re-find layer by name in case indices shifted during previous duplications.
                var layerToDuplicate = null;
                for (var m = 0; m < sourceDoc.layers.length; m++) {
                    if (sourceDoc.layers[m].name === groupName) {
                        layerToDuplicate = sourceDoc.layers[m];
                        break;
                    }
                }
                if (!layerToDuplicate) {
                    log("SKIP | \"" + groupName + "\" not found in " + fileName + " at placement time.");
                    continue;
                }

                layerToDuplicate.duplicate(templateDoc, ElementPlacement.PLACEATBEGINNING);
                app.activeDocument = templateDoc;
                templateDoc.activeLayer = templateDoc.layers[0];
                convertToSmartObject();
                templateDoc.activeLayer.name = groupName; // re-assert name after SO conversion
                app.activeDocument = sourceDoc;

                log("placed | " + groupName + " from " + fileName + resizeNote);
                totalPlaced++;
            }

            sourceDoc.close(SaveOptions.DONOTSAVECHANGES);
            log("closed | " + fileName);

            if (!CONFIG.dryRun) {
                app.activeDocument = templateDoc;
            }
        }
    } finally {
        app.playbackDisplayDialogs = DialogModes.ERROR;
    }

    return { placed: totalPlaced, fileCount: files.length };
}

// ─── PHASE 2: RESIZE ──────────────────────────────────────────────────────────

function runResize(doc) {
    var origUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var resized = 0;
    var skipped = [];

    try {
        for (var i = 0; i < doc.layers.length; i++) {
            var layer = doc.layers[i];

            if (!layer.name) {
                log("SKIP | unnamed layer at index " + i);
                skipped.push("(unnamed at index " + i + ")");
                continue;
            }

            if (layer.name === CONFIG.skipLayerName) continue;

            var parsed = parseLayerName(layer.name);
            if (!parsed) {
                log("SKIP | \"" + layer.name + "\" — no [STYLE-CAT] code.");
                skipped.push(layer.name + " (no [STYLE-CAT] code)");
                continue;
            }

            var targetPx = getTargetPx(parsed);
            if (targetPx === null) {
                var code = parsed.catCode || parsed.styleCode;
                log("SKIP | \"" + layer.name + "\" — unrecognised category \"" + code + "\".");
                skipped.push(layer.name + " (unrecognised category: " + code + ")");
                continue;
            }

            var ok = resizeLayerToTarget(layer, targetPx);
            if (!ok) {
                log("SKIP | \"" + layer.name + "\" — zero bounds (hidden or empty).");
                skipped.push(layer.name + " (zero bounds)");
                continue;
            }

            log("resized | " + layer.name + " -> " + targetPx + "px");
            resized++;
        }
    } finally {
        app.preferences.rulerUnits = origUnits;
    }

    return { resized: resized, skipped: skipped };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

function main() {

    // ── Validate document ──────────────────────────────────────────
    if (app.documents.length === 0) {
        scriptAlert("No document open.\nPlease open the Resize Area Template first.");
        return;
    }
    var doc = app.activeDocument;

    var docWidthCm = Math.round(doc.width.as("cm"));
    if (docWidthCm !== CONFIG.templateWidthCm) {
        scriptAlert("Active document does not look like the Resize Area Template.\n"
            + "Expected: " + CONFIG.templateWidthCm + " cm wide\n"
            + "Got: " + docWidthCm + " cm\n\n"
            + "Please activate the Resize Area Template and try again.");
        return;
    }

    // ── Init log ───────────────────────────────────────────────────
    log("=== ProductionFileScript start ===");
    log("dryRun: " + CONFIG.dryRun);
    log("template: " + doc.name);

    if (doc.resolution !== CONFIG.templateDPI) {
        log("WARN: document resolution is " + doc.resolution
            + " DPI, expected " + CONFIG.templateDPI
            + ". Pixel targets may be inaccurate.");
    }

    // ── Resolve source folder ──────────────────────────────────────
    var folder;
    if (CONFIG.sourceFolderPath) {
        folder = new Folder(CONFIG.sourceFolderPath);
        if (!folder.exists) {
            scriptAlert("Source folder not found:\n" + CONFIG.sourceFolderPath
                + "\n\nUpdate CONFIG.sourceFolderPath and try again.");
            return;
        }
        log("source folder: " + folder.name);
    } else {
        folder = Folder.selectDialog("Select folder containing source PSD files");
        if (!folder) {
            log("cancelled by user.");
            return;
        }
        log("source folder: " + folder.name);
    }

    // ── Dry run: inspect only, no template changes ─────────────────
    if (CONFIG.dryRun) {
        var dryResult = runCombine(doc, folder);
        log("[DRY RUN] complete. Would place " + dryResult.placed
            + " element(s) from " + dryResult.fileCount + " file(s). No changes made.");
        scriptAlert("[DRY RUN] Complete.\n\n"
            + "Would place:  " + dryResult.placed + " element(s)\n"
            + "From:         " + dryResult.fileCount + " file(s)\n\n"
            + "No changes made to template.\n"
            + "See log: " + CONFIG.logPath);
        return;
    }

    // ── Phase 1: Combine ───────────────────────────────────────────
    log("--- Phase 1: Combine ---");
    var snapshotA = doc.activeHistoryState;
    var combineResult;

    try {
        combineResult = runCombine(doc, folder);
    } catch (e) {
        doc.activeHistoryState = snapshotA;
        log("ERROR | combine phase line " + e.line + ": " + e.message
            + " — rolled back to initial template state.");
        scriptAlert("ERROR in combine phase.\n"
            + "Line " + e.line + ": " + e.message + "\n\n"
            + "Template has been rolled back to its initial state.\n"
            + "Log: " + CONFIG.logPath);
        return;
    }

    log("combine complete | " + combineResult.placed + " element(s) from "
        + combineResult.fileCount + " file(s).");

    // ── Phase 2: Resize ────────────────────────────────────────────
    log("--- Phase 2: Resize ---");
    var snapshotB = doc.activeHistoryState;
    var resizeResult;

    try {
        resizeResult = runResize(doc);
    } catch (e) {
        doc.activeHistoryState = snapshotB;
        log("ERROR | resize phase line " + e.line + ": " + e.message
            + " — rolled back to post-combine state. All elements preserved.");
        scriptAlert("ERROR in resize phase.\n"
            + "Line " + e.line + ": " + e.message + "\n\n"
            + "All " + combineResult.placed + " element(s) are still in the template.\n"
            + "Resize was rolled back to the start of Phase 2.\n"
            + "Fix the issue and re-run.\n"
            + "Log: " + CONFIG.logPath);
        return;
    }

    log("resize complete | " + resizeResult.resized + " element(s) resized.");

    // ── Completion summary ─────────────────────────────────────────
    log("=== ProductionFileScript done ===");

    var msg = "Done.\n\n"
        + "  Combined:  " + combineResult.placed + " element(s) from "
        + combineResult.fileCount + " file(s).\n"
        + "  Resized:   " + resizeResult.resized + " element(s).";

    if (resizeResult.skipped.length > 0) {
        msg += "\n  Skipped (" + resizeResult.skipped.length + "):";
        for (var s = 0; s < resizeResult.skipped.length; s++) {
            msg += "\n    - " + resizeResult.skipped[s];
        }
    }

    msg += "\n\nLog: " + CONFIG.logPath
        + "\n\nRun Step 3 (auto-caption) next.";

    scriptAlert(msg);
}

main();
