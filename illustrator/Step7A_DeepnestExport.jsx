// Step7A_DeepnestExport.jsx — Phase function only.
// #included by AI_BuildCutlines.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Classifies every PathItem and CompoundPathItem in the Cutlines layer as
// "regular" or "irregular" using the extent ratio:
//
//   extentRatio = Math.abs(path.area) / (boundsWidth * boundsHeight)
//
// Regular shapes (extentRatio >= CONFIG.deepnestRectThreshold) fill their
// bounding box well and should be run in Deepnest with 90°-only rotation.
// Irregular shapes need free rotation.
//
// Exports two SVG files sibling to the working .ai file:
//   {docName}_regular.svg
//   {docName}_irregular.svg
//
// Each export hides paths that don't belong, exports SVG, then restores visibility.
//
// Returns: { regular, irregular, regularPath, irregularPath }

function runDeepnestExport(doc) {

    // ── 1. Find Cutlines layer ─────────────────────────────────────────────────
    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        log("[step7a] ERROR | layer not found: " + CONFIG.cutlinesLayerName);
        return null;
    }

    // ── 2. Collect and classify paths ─────────────────────────────────────────
    var regularNames   = {};
    var irregularNames = {};
    var regularCount   = 0;
    var irregularCount = 0;

    var allPaths = _collectPaths(cutlinesLayer);
    var i;
    for (i = 0; i < allPaths.length; i++) {
        var path   = allPaths[i];
        var bounds = path.geometricBounds; // [left, top, right, bottom]
        var w      = Math.abs(bounds[2] - bounds[0]);
        var h      = Math.abs(bounds[1] - bounds[3]);
        var bboxArea = w * h;

        // Guard: skip zero-area bounding boxes (degenerate paths).
        if (bboxArea === 0) {
            log("[step7a] SKIP | zero bbox — " + path.name);
            continue;
        }

        var extentRatio = Math.abs(path.area) / bboxArea;
        var isRegular   = extentRatio >= CONFIG.deepnestRectThreshold;

        log("[step7a] " + (isRegular ? "regular  " : "irregular")
            + " | ratio=" + _fmt(extentRatio)
            + " | " + path.name);

        if (isRegular) {
            regularNames[path.name] = true;
            regularCount++;
        } else {
            irregularNames[path.name] = true;
            irregularCount++;
        }
    }

    log("[step7a] classified: " + regularCount + " regular, "
        + irregularCount + " irregular (threshold=" + CONFIG.deepnestRectThreshold + ")");

    if (CONFIG.dryRun) {
        log("[step7a] [DRY RUN] would export regular.svg and irregular.svg.");
        return { regular: regularCount, irregular: irregularCount,
                 regularPath: null, irregularPath: null };
    }

    // ── 3. Resolve output paths ───────────────────────────────────────────────
    var docPath  = doc.fullName.fsName;
    var basePath = docPath.replace(/\.ai$/i, "");
    var regularSvgPath   = basePath + "_regular.svg";
    var irregularSvgPath = basePath + "_irregular.svg";

    // ── 4. Export each group ──────────────────────────────────────────────────
    var regularOk   = _exportSvgGroup(doc, regularNames,   regularSvgPath);
    var irregularOk = _exportSvgGroup(doc, irregularNames, irregularSvgPath);

    if (regularOk)   { log("[step7a] exported: " + regularSvgPath); }
    if (irregularOk) { log("[step7a] exported: " + irregularSvgPath); }

    return {
        regular:       regularCount,
        irregular:     irregularCount,
        regularPath:   regularOk   ? regularSvgPath   : null,
        irregularPath: irregularOk ? irregularSvgPath : null
    };
}


// ── Private helpers ───────────────────────────────────────────────────────────

// Returns a flat array of all PathItems and CompoundPathItems in a layer.
function _collectPaths(layer) {
    var result = [];
    var i;
    for (i = 0; i < layer.pathItems.length; i++) {
        result.push(layer.pathItems[i]);
    }
    for (i = 0; i < layer.compoundPathItems.length; i++) {
        result.push(layer.compoundPathItems[i]);
    }
    return result;
}

// Hides all paths whose names are NOT in keepNames (and hides non-Cutlines layers),
// exports as SVG, then restores visibility. Illustrator has no doc.duplicate().
function _exportSvgGroup(doc, keepNames, outputPath) {
    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        log("[step7a] WARN | Cutlines layer missing — skipping export of " + outputPath);
        return;
    }

    var i;

    // Hide every layer except Cutlines.
    var layerVisible = [];
    for (i = 0; i < doc.layers.length; i++) {
        layerVisible.push(doc.layers[i].visible);
        doc.layers[i].visible = (doc.layers[i].name === cutlinesLayer.name);
    }

    // Hide paths not in keepNames.
    var paths      = _collectPaths(cutlinesLayer);
    var pathHidden = [];
    for (i = 0; i < paths.length; i++) {
        pathHidden.push(paths[i].hidden);
        paths[i].hidden = !keepNames[paths[i].name];
    }

    var exportOk = false;
    try {
        var svgOpts = new ExportOptionsSVG();
        svgOpts.embedRasterImages    = false;
        svgOpts.preserveEditability  = false;
        svgOpts.includeFileInfo      = false;
        svgOpts.includeUnusedStyles  = false;
        doc.exportFile(new File(outputPath), ExportType.SVG, svgOpts);
        exportOk = true;
    } catch (e) {
        log("[step7a] ERROR | export failed for " + outputPath + ": " + e.message);
    }
    return exportOk;

    // Restore path visibility.
    for (i = 0; i < paths.length; i++) {
        paths[i].hidden = pathHidden[i];
    }

    // Restore layer visibility.
    for (i = 0; i < doc.layers.length; i++) {
        doc.layers[i].visible = layerVisible[i];
    }
}

// Formats a float to 3 decimal places (ES3-safe).
function _fmt(n) {
    return Math.round(n * 1000) / 1000;
}
