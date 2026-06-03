// StepNest_ImportLayout.jsx — Phase function only.
// #included by AI_ImportNesting.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Opens each Deepnest output SVG, reads the nested path positions and rotations,
// then fully repositions each cutline GroupItem in the working file — applying
// both the rotation and the translation so the item matches the Deepnest layout.
// Also places per-element artwork PNGs in the Stickers layer at the same
// position and rotation.
//
// Rotation is computed by comparing the direction from each path's centroid to
// its first anchor point in the Deepnest SVG vs the original working file. Both
// are in Illustrator coordinate space (Illustrator flips SVG's y-axis on open),
// so the comparison is direct. The GroupItem is rotated around its own centre
// first, then translated — so the hidden outline and plate sub-paths move with it.
//
// Matching strategy:
//   Pass 1 — name: SVG path id === GroupItem name (works when Deepnest preserves
//             the id attribute, which is the normal case).
//   Pass 2 — area: compares path areas within CONFIG.areaMatchTolerance ratio.
//
// Returns: { matched, unmatched, artPlaced }

function runImportNesting(doc, svgFiles, artFolder) {

    // ── 1. Find layers ────────────────────────────────────────────────────────────
    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        log("[step-nest] ERROR | Cutlines layer not found.");
        return null;
    }

    var stickersLayer = _nestFindStickersLayer(doc);
    if (!stickersLayer) {
        log("[step-nest] WARN | Stickers layer not found — artwork will not be placed.");
    }

    // ── 2. Build cutline map {displayName: pageItem} ──────────────────────────────
    var cutlineMap = _nestBuildCutlineMap(cutlinesLayer);
    var totalCutlines = 0;
    var k;
    for (k in cutlineMap) { totalCutlines++; }
    log("[step-nest] found " + totalCutlines + " cutline(s) in working file.");

    // ── 3. Collect nested item data from Deepnest SVG(s) ─────────────────────────
    var nestedItems = _nestCollectFromSvgs(doc, svgFiles);
    log("[step-nest] found " + nestedItems.length + " path(s) across SVG file(s).");

    if (nestedItems.length === 0) {
        log("[step-nest] WARN | no named paths found in SVG file(s).");
        return { matched: 0, unmatched: 0, artPlaced: 0 };
    }

    // ── 4. Pass 1 — name-based matching ──────────────────────────────────────────
    var matched      = 0;
    var unmatched    = 0;
    var artPlaced    = 0;
    var usedCutlines = {};
    var i, svgItem, cutlineItem, rotation;

    for (i = 0; i < nestedItems.length; i++) {
        svgItem     = nestedItems[i];
        cutlineItem = cutlineMap[svgItem.name];

        if (cutlineItem && !usedCutlines[svgItem.name]) {
            rotation = _nestComputeRotation(svgItem, cutlineItem);
            _nestApplyTransform(svgItem, cutlineItem, rotation);
            usedCutlines[svgItem.name] = true;

            if (stickersLayer && artFolder) {
                if (_nestPlaceArtwork(doc, stickersLayer, svgItem.name,
                                      artFolder, cutlineItem, rotation)) {
                    artPlaced++;
                }
            }

            matched++;
        }
    }

    // ── 5. Pass 2 — area-based fallback for unrecognised names ───────────────────
    for (i = 0; i < nestedItems.length; i++) {
        svgItem = nestedItems[i];
        if (usedCutlines[svgItem.name]) continue;

        cutlineItem = _nestAreaMatch(svgItem, cutlineMap, usedCutlines);
        if (cutlineItem) {
            rotation = _nestComputeRotation(svgItem, cutlineItem);
            _nestApplyTransform(svgItem, cutlineItem, rotation);
            usedCutlines[cutlineItem.name] = true;

            log("[step-nest] matched (area) | " + cutlineItem.name
                + " ← SVG \"" + svgItem.name + "\"");

            if (stickersLayer && artFolder) {
                if (_nestPlaceArtwork(doc, stickersLayer, cutlineItem.name,
                                      artFolder, cutlineItem, rotation)) {
                    artPlaced++;
                }
            }

            matched++;
        } else {
            log("[step-nest] WARN unmatched | SVG path: \"" + svgItem.name + "\""
                + " at (" + Math.round(svgItem.center.x) + ", "
                + Math.round(svgItem.center.y) + ")");
            unmatched++;
        }
    }

    log("[step-nest] result | matched: " + matched
        + " | unmatched: " + unmatched
        + " | art placed: " + artPlaced);

    return { matched: matched, unmatched: unmatched, artPlaced: artPlaced };
}


// ── Private helpers ────────────────────────────────────────────────────────────

// Applies the full Deepnest transform (rotation then translation) to a cutline
// item. Logs the applied values.
function _nestApplyTransform(svgItem, cutlineItem, rotation) {
    var oldCenter = boundsCenter(cutlineItem.geometricBounds);
    var newCenter = svgItem.center;

    if (!CONFIG.dryRun) {
        // Rotate around the item's own centre first (centre stays fixed).
        if (Math.abs(rotation) > 0.5) {
            cutlineItem.rotate(rotation, true, false, false, false,
                               Transformation.CENTER);
        }
        // Then translate old centre → new centre.
        cutlineItem.translate(newCenter.x - oldCenter.x,
                              newCenter.y - oldCenter.y);
    }

    log("[step-nest] placed | " + cutlineItem.name
        + " → (" + Math.round(newCenter.x) + ", " + Math.round(newCenter.y) + ")"
        + "  rot=" + Math.round(rotation) + "°");
}

function _nestFindStickersLayer(doc) {
    var i, n;
    for (i = 0; i < doc.layers.length; i++) {
        n = doc.layers[i].name.toLowerCase();
        if (n === "sticker" || n === "stickers") return doc.layers[i];
    }
    return null;
}

// Builds {displayName: pageItem} from direct children of the Cutlines layer.
// GroupItems = WC/GC elements; direct PathItems/CompoundPathItems = stamps.
function _nestBuildCutlineMap(cutlinesLayer) {
    var map = {};
    var i, item;

    for (i = 0; i < cutlinesLayer.groupItems.length; i++) {
        item = cutlinesLayer.groupItems[i];
        if (item.name) map[item.name] = item;
    }

    for (i = 0; i < cutlinesLayer.pathItems.length; i++) {
        item = cutlinesLayer.pathItems[i];
        if (item.parent !== cutlinesLayer) continue; // skip paths nested inside GroupItems
        if (item.name) map[item.name] = item;
    }

    for (i = 0; i < cutlinesLayer.compoundPathItems.length; i++) {
        item = cutlinesLayer.compoundPathItems[i];
        if (item.parent !== cutlinesLayer) continue;
        if (item.name) map[item.name] = item;
    }

    return map;
}

// Opens each SVG in Illustrator, reads named paths with position/rotation/area,
// restores the working doc as active. Returns [{name, center, bounds, area, rotation, anchor0}].
function _nestCollectFromSvgs(workingDoc, svgFiles) {
    var result = [];
    var i, svgFile, svgDoc, items, j;

    for (i = 0; i < svgFiles.length; i++) {
        svgFile = svgFiles[i];
        if (!svgFile || !svgFile.exists) {
            log("[step-nest] WARN | SVG not found: "
                + (svgFile ? svgFile.fsName : "null"));
            continue;
        }

        svgDoc = null;
        try {
            svgDoc = app.open(svgFile);
            items  = _nestCollectFromDoc(svgDoc);
            svgDoc.close(SaveOptions.DONOTSAVECHANGES);
            svgDoc = null;
            app.activeDocument = workingDoc;

            for (j = 0; j < items.length; j++) { result.push(items[j]); }
            log("[step-nest] read " + items.length + " path(s) from " + svgFile.name);

        } catch (e) {
            log("[step-nest] ERROR | SVG " + svgFile.name + ": " + e.message);
            if (svgDoc) {
                try { svgDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
            }
            try { app.activeDocument = workingDoc; } catch (e3) {}
        }
    }

    return result;
}

// Reads named paths from the first layer of an SVG doc.
// Captures anchor0 (first anchor point) for rotation computation.
function _nestCollectFromDoc(svgDoc) {
    var result = [];
    if (!svgDoc.layers.length) return result;
    var layer = svgDoc.layers[0];
    var i, item, gb, pt, a0;

    for (i = 0; i < layer.pathItems.length; i++) {
        item = layer.pathItems[i];
        if (!item.name || item.name === "") continue;
        gb = item.geometricBounds;
        a0 = null;
        if (item.pathPoints && item.pathPoints.length > 0) {
            pt = item.pathPoints[0].anchor; // [x, y]
            a0 = { x: pt[0], y: pt[1] };
        }
        result.push({
            name:    item.name,
            center:  boundsCenter(gb),
            bounds:  gb,
            area:    Math.abs(item.area),
            anchor0: a0
        });
    }

    for (i = 0; i < layer.compoundPathItems.length; i++) {
        item = layer.compoundPathItems[i];
        if (!item.name || item.name === "") continue;
        gb = item.geometricBounds;
        a0 = null;
        if (item.pathItems.length > 0
                && item.pathItems[0].pathPoints
                && item.pathItems[0].pathPoints.length > 0) {
            pt = item.pathItems[0].pathPoints[0].anchor;
            a0 = { x: pt[0], y: pt[1] };
        }
        var w = Math.abs(gb[2] - gb[0]);
        var h = Math.abs(gb[1] - gb[3]);
        result.push({
            name:    item.name,
            center:  boundsCenter(gb),
            bounds:  gb,
            area:    w * h,
            anchor0: a0
        });
    }

    return result;
}

// Computes the rotation angle (degrees, Illustrator convention: + = CCW) that
// Deepnest applied to svgItem relative to cutlineItem.
//
// Method: compare the direction from each item's centroid to its first anchor.
// Both items are in Illustrator document coordinates (Illustrator inverts SVG's
// y-axis on open), so the angle difference is directly usable with rotate().
//
// Falls back to a bounding-box aspect-ratio check for PlacedItems (stamps) which
// have no pathPoints. Returns 0 if the rotation cannot be determined.
function _nestComputeRotation(svgItem, cutlineItem) {
    var svgAnchor = svgItem.anchor0;

    // PathItem/GroupItem path: use anchor direction comparison.
    var clPath = _nestGetVisiblePath(cutlineItem);
    if (clPath && clPath.pathPoints && clPath.pathPoints.length > 0) {
        if (!svgAnchor) return 0;

        var svgCenter = svgItem.center;
        var clCenter  = boundsCenter(cutlineItem.geometricBounds);

        var clPt  = clPath.pathPoints[0].anchor;
        var clVec = { x: clPt[0]        - clCenter.x,  y: clPt[1]        - clCenter.y  };
        var svVec = { x: svgAnchor.x    - svgCenter.x, y: svgAnchor.y    - svgCenter.y };

        var clLen = Math.sqrt(clVec.x * clVec.x + clVec.y * clVec.y);
        var svLen = Math.sqrt(svVec.x * svVec.x + svVec.y * svVec.y);
        if (clLen < 1 || svLen < 1) return 0; // anchor too close to centroid

        var clAngle = Math.atan2(clVec.y, clVec.x) * 180 / Math.PI;
        var svAngle = Math.atan2(svVec.y, svVec.x) * 180 / Math.PI;

        var rot = svAngle - clAngle;
        // Normalise to [-180, 180].
        while (rot >  180) rot -= 360;
        while (rot < -180) rot += 360;
        return rot;
    }

    // PlacedItem fallback (stamps): detect 90° flip from bounding-box swap.
    var cgb  = cutlineItem.geometricBounds;
    var origW = Math.abs(cgb[2] - cgb[0]);
    var origH = Math.abs(cgb[1] - cgb[3]);
    var newW  = Math.abs(svgItem.bounds[2] - svgItem.bounds[0]);
    var newH  = Math.abs(svgItem.bounds[1] - svgItem.bounds[3]);
    var tol   = 5; // points
    if (Math.abs(origW - newH) < tol && Math.abs(origH - newW) < tol) return 90;

    return 0;
}

// Returns the visible cutline PathItem inside a cutline item.
// GroupItem → looks up the child named group.name (the fused cutline).
// PathItem → returns itself. CompoundPathItem → returns first sub-path.
function _nestGetVisiblePath(item) {
    if (item.typename === "PathItem") return item;
    if (item.typename === "GroupItem") {
        var child = findGroupMember(item, "");
        if (child && child.typename === "PathItem") return child;
        if (child && child.typename === "CompoundPathItem"
                && child.pathItems.length > 0) {
            return child.pathItems[0];
        }
    }
    if (item.typename === "CompoundPathItem") {
        if (item.pathItems.length > 0) return item.pathItems[0];
    }
    return null;
}

// Finds the best unmatched cutline by area ratio.
function _nestAreaMatch(svgItem, cutlineMap, usedCutlines) {
    var targetArea = svgItem.area;
    if (targetArea <= 0) return null;

    var bestName  = null;
    var bestRatio = Infinity;
    var name, clArea, ratio;

    for (name in cutlineMap) {
        if (usedCutlines[name]) continue;
        clArea = _nestGetArea(cutlineMap[name]);
        if (clArea <= 0) continue;
        ratio = targetArea > clArea ? targetArea / clArea : clArea / targetArea;
        if (ratio < bestRatio) { bestRatio = ratio; bestName = name; }
    }

    if (bestName && bestRatio <= CONFIG.areaMatchTolerance) {
        return cutlineMap[bestName];
    }
    return null;
}

function _nestGetArea(item) {
    if (item.typename === "PathItem") return Math.abs(item.area);
    if (item.typename === "GroupItem") {
        var child = findGroupMember(item, "");
        if (child && child.typename === "PathItem") return Math.abs(child.area);
        var gb = item.geometricBounds;
        return Math.abs(gb[2] - gb[0]) * Math.abs(gb[1] - gb[3]);
    }
    if (item.typename === "CompoundPathItem") {
        var gb2 = item.geometricBounds;
        return Math.abs(gb2[2] - gb2[0]) * Math.abs(gb2[1] - gb2[3]);
    }
    return 0;
}

// Places {displayName}.png in the Stickers layer, scaled to the cutlineItem's
// longest edge, centred at its bounding-box centre, and rotated to match.
function _nestPlaceArtwork(doc, stickersLayer, displayName, artFolder,
                           cutlineItem, rotation) {
    var safeName = displayName.replace(/[\/\\:*?"<>|]/g, "_");
    var pngFile  = new File(artFolder.fsName + "/" + safeName + ".png");

    if (!pngFile.exists) {
        log("[step-nest] WARN | art PNG not found for: " + displayName);
        return false;
    }

    if (CONFIG.dryRun) {
        log("[step-nest] [DRY RUN] would place art | " + displayName);
        return true;
    }

    doc.activeLayer = stickersLayer;

    var placed = doc.placedItems.add();
    placed.file = pngFile;
    placed.name = displayName;

    // Scale to cutline's longest edge.
    var cgb      = cutlineItem.geometricBounds;
    var cw       = Math.abs(cgb[2] - cgb[0]);
    var ch       = Math.abs(cgb[1] - cgb[3]);
    var cLongest = cw > ch ? cw : ch;
    var pLongest = placed.width > placed.height ? placed.width : placed.height;

    if (pLongest > 0 && cLongest > 0) {
        placed.resize((cLongest / pLongest) * 100,
                      (cLongest / pLongest) * 100);
    }

    // Centre at cutline centre.
    var cc = boundsCenter(cgb);
    placed.translate(
        cc.x - (placed.position[0] + placed.width  / 2),
        cc.y - (placed.position[1] - placed.height / 2)
    );

    // Rotate to match the Deepnest rotation (around the artwork's own centre).
    if (Math.abs(rotation) > 0.5) {
        placed.rotate(rotation, true, false, false, false, Transformation.CENTER);
    }

    log("[step-nest] placed art | " + displayName
        + "  rot=" + Math.round(rotation) + "°");
    return true;
}
