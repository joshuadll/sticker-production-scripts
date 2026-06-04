// Step7A_DeepnestExport.jsx — Phase function only.
// #included by AI_BuildCutlines.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Classifies every top-level item in the Cutlines layer as "regular" or
// "irregular" using the extent ratio:
//
//   extentRatio = pathArea / (boundsWidth * boundsHeight)
//
// Regular shapes (extentRatio >= CONFIG.deepnestRectThreshold) fill their
// bounding box well and should be run in Deepnest with 90°-only rotation.
// Irregular shapes need free rotation.
//
// Exports two SVG files sibling to the working .ai file:
//   {docName}_regular.svg
//   {docName}_irregular.svg
//
// Each export hides items that don't belong, exports SVG, then restores visibility.
//
// Returns: { regular, irregular, regularPath, irregularPath }

function runDeepnestExport(doc) {

    // ── 1. Find Cutlines layer ─────────────────────────────────────────────────
    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        log("[step7a] ERROR | layer not found: " + CONFIG.cutlinesLayerName);
        return null;
    }

    // ── 2. Collect and classify top-level items ───────────────────────────────
    var regularNames   = {};
    var irregularNames = {};
    var regularCount   = 0;
    var irregularCount = 0;

    var entries = _collectCutlineEntries(cutlinesLayer);
    var i;
    for (i = 0; i < entries.length; i++) {
        var entry    = entries[i];
        var bounds   = entry.bounds;
        var bboxArea = _bboxArea(bounds);

        if (bboxArea === 0) {
            log("[step7a] SKIP | zero bbox — " + entry.name);
            continue;
        }

        var extentRatio = entry.area / bboxArea;
        var isRegular   = extentRatio >= CONFIG.deepnestRectThreshold;

        log("[step7a] " + (isRegular ? "regular  " : "irregular")
            + " | ratio=" + _fmt(extentRatio)
            + " | " + entry.name);

        if (isRegular) {
            regularNames[entry.name] = true;
            regularCount++;
        } else {
            irregularNames[entry.name] = true;
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

// Returns one entry per top-level item in the Cutlines layer:
//   { name, item, area (for extent ratio), bounds [l,t,r,b] }
// Uses layer.pageItems to stay top-level only — layer.pathItems is recursive
// and would pick up hidden sub-paths inside GroupItems.
function _collectCutlineEntries(layer) {
    var entries = [];
    var i, j, item, sub, bounds;

    for (i = 0; i < layer.pageItems.length; i++) {
        item = layer.pageItems[i];

        if (item.typename === "GroupItem") {
            // Skip unnamed groups — expandStyle artifacts leaked by deriveCutline.
            if (!item.name || item.name.length === 0) { continue; }
            // Caption element group: find the cutline child (named = group.name).
            // Use pageItems on the group — GroupItem has no .pathItems collection.
            sub = null;
            for (j = 0; j < item.pageItems.length; j++) {
                if (item.pageItems[j].name === item.name) { sub = item.pageItems[j]; break; }
            }
            bounds = sub ? sub.geometricBounds : item.geometricBounds;
            entries.push({ name: item.name, item: item,
                           area: sub ? _pathArea(sub) : _bboxArea(bounds) * 0.7,
                           bounds: bounds });

        } else if (item.typename === "PathItem" || item.typename === "CompoundPathItem") {
            // Skip unnamed paths — these are dupOutline leftovers leaked by deriveCutline.
            if (!item.name || item.name.replace(/\s/g, "") === "") { continue; }
            // No-caption bare path (e.g. Slovakia Map, Bratislava(text)).
            entries.push({ name: item.name, item: item,
                           area: _pathArea(item), bounds: item.geometricBounds });

        } else if (item.typename === "PlacedItem") {
            // Stamp template — ovals have ~0.785 fill ratio; always classify regular.
            bounds = item.geometricBounds;
            entries.push({ name: item.name, item: item,
                           area: 0.785 * _bboxArea(bounds), bounds: bounds });
        }
    }
    return entries;
}

// Returns the absolute area of a path-like item.
// CompoundPathItem has no .area — sum sub-path areas.
// GroupItem (expandStyle sometimes wraps result in a group) — recurse via pageItems.
function _pathArea(item) {
    var k, total;
    if (item.typename === "PathItem") {
        return isNaN(item.area) ? 0 : Math.abs(item.area);
    }
    if (item.typename === "CompoundPathItem") {
        total = 0;
        for (k = 0; k < item.pathItems.length; k++) {
            if (!isNaN(item.pathItems[k].area)) { total += Math.abs(item.pathItems[k].area); }
        }
        return total;
    }
    if (item.typename === "GroupItem") {
        total = 0;
        for (k = 0; k < item.pageItems.length; k++) {
            total += _pathArea(item.pageItems[k]);
        }
        return total;
    }
    return 0;
}

function _bboxArea(bounds) {
    return Math.abs(bounds[2] - bounds[0]) * Math.abs(bounds[1] - bounds[3]);
}

// Hides top-level items whose names are NOT in keepNames (and hides non-Cutlines
// layers), exports as SVG, then restores visibility.
function _exportSvgGroup(doc, keepNames, outputPath) {
    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        log("[step7a] WARN | Cutlines layer missing — skipping export of " + outputPath);
        return false;
    }

    var i;

    // Hide every layer except Cutlines.
    var layerVisible = [];
    for (i = 0; i < doc.layers.length; i++) {
        layerVisible.push(doc.layers[i].visible);
        doc.layers[i].visible = (doc.layers[i].name === cutlinesLayer.name);
    }

    // Snapshot all top-level items (including unnamed artifacts) and hide any
    // not in keepNames. Unnamed items have empty name so keepNames[""] is undefined -> hidden.
    var allItems   = [];
    var itemHidden = [];
    for (i = 0; i < cutlinesLayer.pageItems.length; i++) {
        allItems.push(cutlinesLayer.pageItems[i]);
    }
    for (i = 0; i < allItems.length; i++) {
        itemHidden.push(allItems[i].hidden);
        allItems[i].hidden = !keepNames[allItems[i].name];
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

    // Restore item visibility.
    for (i = 0; i < allItems.length; i++) {
        allItems[i].hidden = itemHidden[i];
    }

    // Restore layer visibility.
    for (i = 0; i < doc.layers.length; i++) {
        doc.layers[i].visible = layerVisible[i];
    }

    return exportOk;
}

// Formats a float to 3 decimal places (ES3-safe).
function _fmt(n) {
    return Math.round(n * 1000) / 1000;
}
