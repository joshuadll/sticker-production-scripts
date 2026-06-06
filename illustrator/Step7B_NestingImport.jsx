// Step7B_NestingImport.jsx — Phase function only.
// #included by AI_ImportNesting.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Opens each Deepnest output SVG, reads each nested part's position + rotation,
// then fully repositions the matching cutline GroupItem in the working file —
// applying both rotation and translation so it lands on the Deepnest layout.
// Also places per-element artwork PNGs in the Stickers layer at the same
// position and rotation.
//
// Deepnest output structure (verified against real output, 2026-06-06):
//   Each nested part is wrapped in <g transform="translate(...) rotate(...)">,
//   possibly inside an outer sheet <g>. Illustrator BAKES the transform into the
//   path coordinates on open, and the wrapped paths are NOT at the layer's top
//   level (layer.pathItems == 0). The export→Deepnest round-trip also STRIPS
//   ids from group-wrapped cutlines (only originally-ungrouped paths keep a name),
//   so name-based matching is not viable — matching is purely by area.
//
// Matching: each SVG part is paired to a cutline by closest path area within
// CONFIG.areaMatchTolerance (rotation + translation preserve area, so a true pair
// has near-identical area). Assignment is global-greedy: all candidate pairs are
// sorted by area ratio and assigned best-first, each part/cutline used once.
//
// Rotation: compared via centroid→largest-anchor direction on the baked geometry
// of the matched pair (Illustrator inverts SVG's y-axis on open, so the angle
// difference is directly usable with rotate()).
//
// Returns: { matched, unmatched, artPlaced }

function runNestingImport(doc, svgFiles, artFolder) {

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

    // Re-run safety: cutline transforms are idempotent on their own — each match
    // re-targets the cutline to the part's ABSOLUTE centre and re-measures rotation
    // from the current state, so positions converge instead of compounding. Placed
    // artwork is the exception: _nestPlaceArtwork adds a fresh PlacedItem every run,
    // so clear any art from a previous run first to avoid duplicate stacks.
    if (stickersLayer && !CONFIG.dryRun) {
        var cleared = 0;
        var pi;
        for (pi = stickersLayer.placedItems.length - 1; pi >= 0; pi--) {
            stickersLayer.placedItems[pi].remove();
            cleared++;
        }
        if (cleared > 0) {
            log("[step-nest] cleared " + cleared + " previously placed art item(s) (re-run).");
        }
    }

    // ── 2. Build cutline map {displayName: pageItem} ──────────────────────────────
    var cutlineMap = _nestBuildCutlineMap(cutlinesLayer);
    var totalCutlines = 0;
    var k;
    for (k in cutlineMap) { totalCutlines++; }
    log("[step-nest] found " + totalCutlines + " cutline(s) in working file.");

    // ── 3. Collect nested parts from Deepnest SVG(s) ─────────────────────────────
    var parts = _nestCollectFromSvgs(doc, svgFiles);
    log("[step-nest] found " + parts.length + " nested part(s) across SVG file(s).");

    if (parts.length === 0) {
        log("[step-nest] WARN | no parts found in SVG file(s).");
        return { matched: 0, unmatched: 0, artPlaced: 0 };
    }

    // ── 4. Area-based assignment (global greedy by closest area ratio) ────────────
    var assignments = _nestAssignByArea(parts, cutlineMap);

    var matched   = 0;
    var artPlaced = 0;
    var assignedPart = {};
    var a, svgItem, cutlineItem, rotation, preLongest;

    for (a = 0; a < assignments.length; a++) {
        svgItem     = assignments[a].part;
        cutlineItem = assignments[a].cutlineItem;
        assignedPart[assignments[a].partIndex] = true;

        rotation   = _nestComputeRotation(svgItem, cutlineItem);
        preLongest = _nestLongestEdge(cutlineItem); // before rotation distorts the bbox
        _nestApplyTransform(svgItem, cutlineItem, rotation);

        log("[step-nest] matched (area) | " + cutlineItem.name
            + "  ratio=" + (Math.round(assignments[a].ratio * 1000) / 1000));

        if (stickersLayer && artFolder) {
            if (_nestPlaceArtwork(doc, stickersLayer, cutlineItem.name,
                                  artFolder, cutlineItem, rotation, preLongest)) {
                artPlaced++;
            }
        }

        matched++;
    }

    // ── 5. Report unmatched parts ────────────────────────────────────────────────
    var unmatched = 0;
    for (a = 0; a < parts.length; a++) {
        if (assignedPart[a]) continue;
        unmatched++;
        log("[step-nest] WARN unmatched part | area=" + Math.round(parts[a].area)
            + " at (" + Math.round(parts[a].center.x) + ", "
            + Math.round(parts[a].center.y) + ")");
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
    var newCenter = svgItem.center;

    if (!CONFIG.dryRun) {
        // Rotate around the item's own centre first.
        if (Math.abs(rotation) > 0.5) {
            cutlineItem.rotate(rotation, true, false, false, false,
                               Transformation.CENTER);
        }
        // Re-read the bounding-box centre AFTER rotating: for an asymmetric shape
        // the axis-aligned bbox centre shifts under rotation, so the pre-rotation
        // centre would land the item off by that shift. Then translate to target.
        var oldCenter = boundsCenter(cutlineItem.geometricBounds);
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

// Opens each SVG, collects nested-part records, restores the working doc as active.
// Returns [{ name, center, bounds, area, anchor0 }] — one per nested part.
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
            log("[step-nest] read " + items.length + " part(s) from " + svgFile.name);

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

// Builds part records from every layer of an SVG doc. Deepnest nests each part in
// a transform-group, so we collect part-groups recursively rather than reading
// only the layer's top-level paths.
function _nestCollectFromDoc(svgDoc) {
    var result = [];
    var i, s, parts = [];
    for (i = 0; i < svgDoc.layers.length; i++) {
        var sub = _nestCollectParts(svgDoc.layers[i]);
        for (s = 0; s < sub.length; s++) parts.push(sub[s]);
    }
    for (i = 0; i < parts.length; i++) {
        var rec = _nestPartRecord(parts[i]);
        if (rec.area > 0) result.push(rec);
    }
    return result;
}

// Recursively collects "part" page-items from a container (layer or group):
//   - a group that directly holds path/compound geometry is a part (the Deepnest
//     part wrapper) and is NOT descended into further;
//   - a group holding only other groups is a wrapper (outer sheet / translate(0 0))
//     and is recursed through;
//   - any path/compound directly under the container is its own part.
function _nestCollectParts(node) {
    var parts = [];
    var i, g, sub, s;

    for (i = 0; i < node.groupItems.length; i++) {
        g = node.groupItems[i];
        // Treat a group as a leaf part only when it has direct geometry AND no
        // sub-groups. A group with BOTH direct paths AND sub-groups is ambiguous
        // (e.g. a Deepnest outer-sheet <g> that also carries a boundary rect);
        // recurse through it instead of pushing it as one oversized part — which
        // would inflate the area and break matching for the whole file.
        if ((g.pathItems.length > 0 || g.compoundPathItems.length > 0)
                && g.groupItems.length === 0) {
            parts.push(g);
        } else if (g.groupItems.length > 0) {
            sub = _nestCollectParts(g);
            for (s = 0; s < sub.length; s++) parts.push(sub[s]);
        }
    }
    for (i = 0; i < node.pathItems.length; i++) {
        if (node.pathItems[i].parent === node) parts.push(node.pathItems[i]);
    }
    for (i = 0; i < node.compoundPathItems.length; i++) {
        if (node.compoundPathItems[i].parent === node) parts.push(node.compoundPathItems[i]);
    }
    return parts;
}

// Builds a { name, center, bounds, area, anchor0 } record for one nested part.
// area = summed true path area (rotation-invariant); anchor0 = first anchor of the
// part's largest sub-path (for rotation recovery).
function _nestPartRecord(part) {
    var gb   = part.geometricBounds;
    var area = _nestSumPathArea(part);

    var a0 = null;
    var largest = _nestLargestPath(part);
    if (largest && largest.pathPoints && largest.pathPoints.length > 0) {
        var pt = largest.pathPoints[0].anchor; // [x, y]
        a0 = { x: pt[0], y: pt[1] };
    }

    return {
        name:    part.name || "",
        center:  boundsCenter(gb),
        bounds:  gb,
        area:    area,
        anchor0: a0
    };
}

// Sum of |area| over every PathItem contained in an item (recurses groups +
// compounds). For a cutline GROUP, call this on the visible fused member only —
// see _nestCutlineArea — never on the whole group (it also holds the hidden
// outline + plate, which would double-count).
function _nestSumPathArea(item) {
    var a = 0, i;
    if (item.typename === "PathItem") return Math.abs(item.area);
    if (item.typename === "CompoundPathItem") {
        for (i = 0; i < item.pathItems.length; i++) a += Math.abs(item.pathItems[i].area);
        return a;
    }
    if (item.typename === "GroupItem") {
        for (i = 0; i < item.pathItems.length; i++) a += Math.abs(item.pathItems[i].area);
        for (i = 0; i < item.compoundPathItems.length; i++) a += _nestSumPathArea(item.compoundPathItems[i]);
        for (i = 0; i < item.groupItems.length; i++) a += _nestSumPathArea(item.groupItems[i]);
        return a;
    }
    return 0;
}

// Returns the largest-area PathItem within an item (recurses groups + compounds).
function _nestLargestPath(item) {
    var best = null, bestA = -1, i, c, ar;
    if (item.typename === "PathItem") return item;
    if (item.typename === "CompoundPathItem") {
        for (i = 0; i < item.pathItems.length; i++) {
            ar = Math.abs(item.pathItems[i].area);
            if (ar > bestA) { bestA = ar; best = item.pathItems[i]; }
        }
        return best;
    }
    if (item.typename === "GroupItem") {
        for (i = 0; i < item.pathItems.length; i++) {
            ar = Math.abs(item.pathItems[i].area);
            if (ar > bestA) { bestA = ar; best = item.pathItems[i]; }
        }
        for (i = 0; i < item.compoundPathItems.length; i++) {
            c = _nestLargestPath(item.compoundPathItems[i]);
            if (c) { ar = Math.abs(c.area); if (ar > bestA) { bestA = ar; best = c; } }
        }
        for (i = 0; i < item.groupItems.length; i++) {
            c = _nestLargestPath(item.groupItems[i]);
            if (c) { ar = Math.abs(c.area); if (ar > bestA) { bestA = ar; best = c; } }
        }
        return best;
    }
    return null;
}

// The visible fused cutline page-item inside a cutline map entry.
// GroupItem → the child named group.name (the Unite result). Path/Compound → itself.
function _nestCutlineVisible(item) {
    if (item.typename === "PathItem" || item.typename === "CompoundPathItem") return item;
    if (item.typename === "GroupItem") return findGroupMember(item, "");
    return null;
}

// True path area of a cutline map entry (visible fused member only).
function _nestCutlineArea(item) {
    var vis = _nestCutlineVisible(item);
    if (vis) return _nestSumPathArea(vis);
    var gb = item.geometricBounds; // fallback: bbox
    return Math.abs(gb[2] - gb[0]) * Math.abs(gb[1] - gb[3]);
}

// Global-greedy area assignment. Builds every (part, cutline) pair within
// CONFIG.areaMatchTolerance, sorts by area ratio ascending, and assigns best-first
// with each part and each cutline used at most once.
// Returns [{ part, cutlineItem, ratio, partIndex }].
function _nestAssignByArea(parts, cutlineMap) {
    var cutNames = [];
    var name, c, p, q;
    for (name in cutlineMap) cutNames.push(name);

    var cutArea = {};
    for (c = 0; c < cutNames.length; c++) {
        cutArea[cutNames[c]] = _nestCutlineArea(cutlineMap[cutNames[c]]);
    }

    var pairs = [];
    for (p = 0; p < parts.length; p++) {
        var pa = parts[p].area;
        if (pa <= 0) continue;
        for (q = 0; q < cutNames.length; q++) {
            var ca = cutArea[cutNames[q]];
            if (ca <= 0) continue;
            var ratio = pa > ca ? pa / ca : ca / pa;
            if (ratio <= CONFIG.areaMatchTolerance) {
                pairs.push({ p: p, name: cutNames[q], ratio: ratio });
            }
        }
    }

    pairs.sort(function (x, y) { return x.ratio - y.ratio; });

    var usedPart = {}, usedCut = {}, result = [];
    for (var k = 0; k < pairs.length; k++) {
        var pr = pairs[k];
        if (usedPart[pr.p] || usedCut[pr.name]) continue;
        usedPart[pr.p]   = true;
        usedCut[pr.name] = true;
        result.push({
            part:        parts[pr.p],
            cutlineItem: cutlineMap[pr.name],
            ratio:       pr.ratio,
            partIndex:   pr.p
        });
    }
    return result;
}

// Computes the rotation angle (degrees, Illustrator convention: + = CCW) that
// Deepnest applied to the part relative to the matched cutline.
//
// Method: compare the direction from each item's centroid to its largest sub-path's
// first anchor. Both are in Illustrator document coordinates, so the difference is
// directly usable with rotate(). Falls back to a bounding-box swap check (90° flip)
// when no anchor is available. Returns 0 if it cannot be determined.
function _nestComputeRotation(svgItem, cutlineItem) {
    var svgAnchor = svgItem.anchor0;

    var vis    = _nestCutlineVisible(cutlineItem);
    var clPath = vis ? _nestLargestPath(vis) : null;

    if (clPath && clPath.pathPoints && clPath.pathPoints.length > 0 && svgAnchor) {
        var svgCenter = svgItem.center;
        var clCenter  = boundsCenter(cutlineItem.geometricBounds);

        var clPt  = clPath.pathPoints[0].anchor;
        var clVec = { x: clPt[0]     - clCenter.x,  y: clPt[1]     - clCenter.y  };
        var svVec = { x: svgAnchor.x - svgCenter.x, y: svgAnchor.y - svgCenter.y };

        var clLen = Math.sqrt(clVec.x * clVec.x + clVec.y * clVec.y);
        var svLen = Math.sqrt(svVec.x * svVec.x + svVec.y * svVec.y);
        if (clLen < 1 || svLen < 1) return 0; // anchor too close to centroid

        var clAngle = Math.atan2(clVec.y, clVec.x) * 180 / Math.PI;
        var svAngle = Math.atan2(svVec.y, svVec.x) * 180 / Math.PI;

        var rot = svAngle - clAngle;
        while (rot >  180) rot -= 360;
        while (rot < -180) rot += 360;
        return rot;
    }

    // Fallback: detect a 90° flip from a bounding-box width/height swap.
    var cgb   = cutlineItem.geometricBounds;
    var origW = Math.abs(cgb[2] - cgb[0]);
    var origH = Math.abs(cgb[1] - cgb[3]);
    var newW  = Math.abs(svgItem.bounds[2] - svgItem.bounds[0]);
    var newH  = Math.abs(svgItem.bounds[1] - svgItem.bounds[3]);
    var tol   = 5; // points
    if (Math.abs(origW - newH) < tol && Math.abs(origH - newW) < tol) return 90;

    return 0;
}

// Longest edge of an item's current (axis-aligned) bounding box.
function _nestLongestEdge(item) {
    var gb = item.geometricBounds;
    var w  = Math.abs(gb[2] - gb[0]);
    var h  = Math.abs(gb[1] - gb[3]);
    return w > h ? w : h;
}

// Places {displayName}.png in the Stickers layer, scaled to the cutlineItem's
// longest edge, centred at its bounding-box centre, and rotated to match.
function _nestPlaceArtwork(doc, stickersLayer, displayName, artFolder,
                           cutlineItem, rotation, cutlineLongest) {
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

    try {
        var placed = doc.placedItems.add();
        placed.file = pngFile;
        placed.name = displayName;

        // Scale to the cutline's longest edge. Use the caller-supplied pre-rotation
        // longest edge: the cutline has already been rotated by _nestApplyTransform,
        // so its current bbox is distorted at oblique angles. The PNG is measured
        // unrotated, then rotated below — so both must use the unrotated extent.
        var pLongest = placed.width > placed.height ? placed.width : placed.height;
        if (pLongest > 0 && cutlineLongest > 0) {
            var scalePercent = (cutlineLongest / pLongest) * 100;
            placed.resize(scalePercent, scalePercent);
        }

        // Centre at cutline centre (post-transform — art follows the moved cutline).
        var cc = boundsCenter(cutlineItem.geometricBounds);
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

    } catch (e) {
        // Rare Illustrator API failure (e.g. locked layer, memory hiccup);
        // log and skip this element rather than aborting the whole loop.
        log("[step-nest] WARN | art placement failed for: " + displayName
            + " — line " + e.line + ": " + e.message);
        return false;
    }
}
