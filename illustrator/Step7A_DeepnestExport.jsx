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
// Each export duplicates only the wanted cutlines into a throwaway temp document
// and exports that (see _exportSvgGroup for why hide-then-export can't work).
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

// Returns the fused cutline sub-item in a cutline GroupItem: the child whose
// name equals the group name (the documented invariant — see CLAUDE.md cutline
// structure). The group also contains hidden outline + plate sub-paths (named
// "<name> outline" / "<name> plate"); matching on the exact name skips those.
// Returns null if the group has no name-matching child (a malformed group).
function _namedCutlineInGroup(group) {
    var j;
    for (j = 0; j < group.pageItems.length; j++) {
        if (group.pageItems[j].name === group.name) { return group.pageItems[j]; }
    }
    return null;
}

// Returns one entry per top-level item in the Cutlines layer:
//   { name, item, area (for extent ratio), bounds [l,t,r,b] }
// Uses layer.pageItems to stay top-level only — layer.pathItems is recursive
// and would pick up hidden sub-paths inside GroupItems.
function _collectCutlineEntries(layer) {
    var entries = [];
    var i, item, sub, bounds;

    for (i = 0; i < layer.pageItems.length; i++) {
        item = layer.pageItems[i];

        if (item.typename === "GroupItem") {
            // Skip unnamed groups — expandStyle artifacts leaked by deriveCutline.
            if (!item.name || item.name.length === 0) { continue; }
            // Caption element group: classify on the fused cutline (child named ==
            // group name), so we read the final contour's area, not the hidden
            // outline/plate sub-paths.
            sub = _namedCutlineInGroup(item);
            if (!sub) {
                log("[step7a] SKIP | group has no fused cutline — " + item.name);
                continue;
            }
            bounds = sub.geometricBounds;
            entries.push({ name: item.name, item: item,
                           area: _pathArea(sub), bounds: bounds });

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

// Exports exactly the named cutlines in keepNames to a standalone SVG. Builds a
// throwaway document the size of the working artboard, duplicates only the wanted
// top-level items into it, exports, and discards the temp doc. This guarantees the
// SVG contains ONLY the kept items — Illustrator's SVG export writes hidden items
// as display:none (still present in the file and re-shown on reopen), so a
// hide-then-export-whole-doc approach cannot produce disjoint files.
function _exportSvgGroup(doc, keepNames, outputPath) {
    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        log("[step7a] WARN | Cutlines layer missing — skipping export of " + outputPath);
        return false;
    }

    var i;

    // Throwaway doc matching the working artboard so duplicated items keep position.
    var ab = doc.artboards[0].artboardRect; // [left, top, right, bottom]
    var abW = Math.abs(ab[2] - ab[0]);
    var abH = Math.abs(ab[1] - ab[3]);
    var tmp = app.documents.add(DocumentColorSpace.RGB, abW, abH);   // match RGB working doc
    var tmpLayer = tmp.layers[0];

    var copied = 0;
    for (i = 0; i < cutlinesLayer.pageItems.length; i++) {
        var src = cutlinesLayer.pageItems[i];
        if (!keepNames[src.name]) { continue; }

        if (src.typename === "GroupItem") {
            // Copy ONLY the fused cutline (child named == group name) — NOT the
            // whole group. Duplicating the group drags in the hidden outline/plate
            // sub-paths (Illustrator re-shows display:none on SVG reopen).
            var cutline = _namedCutlineInGroup(src);
            if (!cutline) { continue; }   // malformed group, no fused cutline
            cutline.duplicate(tmpLayer, ElementPlacement.PLACEATEND);
        } else {
            src.duplicate(tmpLayer, ElementPlacement.PLACEATEND);
        }
        copied++;
    }

    var exportOk = false;
    try {
        var svgOpts = new ExportOptionsSVG();
        svgOpts.embedRasterImages    = false;
        svgOpts.preserveEditability  = false;
        svgOpts.includeFileInfo      = false;
        svgOpts.includeUnusedStyles  = false;
        tmp.exportFile(new File(outputPath), ExportType.SVG, svgOpts);
        exportOk = true;
    } catch (e) {
        log("[step7a] ERROR | export failed for " + outputPath + ": " + e.message);
    }

    tmp.close(SaveOptions.DONOTSAVECHANGES);
    log("[step7a] export | " + copied + " item(s) -> " + outputPath);
    return exportOk;
}

// Formats a float to 3 decimal places (ES3-safe).
function _fmt(n) {
    return Math.round(n * 1000) / 1000;
}
