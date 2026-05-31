// Step7A_DeepnestExport.jsx — Phase function only.
// #included by AI_Deepnest.jsx. Requires: aiUtils.jsx, CONFIG in scope.
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
// Each export duplicates the document, deletes the paths that don't belong,
// exports SVG, then closes the duplicate without saving.
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
    _exportSvgGroup(doc, regularNames,   regularSvgPath);
    _exportSvgGroup(doc, irregularNames, irregularSvgPath);

    log("[step7a] exported: " + regularSvgPath);
    log("[step7a] exported: " + irregularSvgPath);

    return {
        regular:       regularCount,
        irregular:     irregularCount,
        regularPath:   regularSvgPath,
        irregularPath: irregularSvgPath
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

// Duplicates the document, removes all paths whose names are NOT in keepNames,
// exports as SVG, then closes the duplicate without saving.
function _exportSvgGroup(doc, keepNames, outputPath) {
    var tmp = doc.duplicate();

    try {
        var tmpLayer = findLayer(tmp, CONFIG.cutlinesLayerName);
        if (!tmpLayer) {
            log("[step7a] WARN | Cutlines layer missing in duplicate — skipping export.");
            tmp.close(SaveOptions.DONOTSAVECHANGES);
            return;
        }

        // Remove paths NOT in keepNames. Collect first, then remove.
        var paths   = _collectPaths(tmpLayer);
        var toRemove = [];
        var i;
        for (i = 0; i < paths.length; i++) {
            if (!keepNames[paths[i].name]) {
                toRemove.push(paths[i]);
            }
        }
        for (i = 0; i < toRemove.length; i++) {
            toRemove[i].remove();
        }

        var svgOpts = new ExportOptionsSVG();
        svgOpts.embedRasterImages    = false;
        svgOpts.preserveEditability  = false;
        svgOpts.includeFileInfo      = false;
        svgOpts.includeUnusedStyles  = false;

        tmp.exportFile(new File(outputPath), ExportType.SVG, svgOpts);
    } catch (e) {
        log("[step7a] ERROR | export failed for " + outputPath + ": " + e.message);
    }

    tmp.close(SaveOptions.DONOTSAVECHANGES);
}

// Formats a float to 3 decimal places (ES3-safe).
function _fmt(n) {
    return Math.round(n * 1000) / 1000;
}
