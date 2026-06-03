// Step10_AssetExport.jsx — Phase function only.
// #included by AI_ExportFinal.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Exports JPEG sheet previews (white + green BG) and per-element PNGs.
// Temporary clip groups are built per-export and immediately discarded —
// no persistent layer is left in the working file.
//
// GC/WC elements: clipped to fused cutline, no tab to hide.
// ST/unnamed elements: clipped to cutline; if cutline is a CompoundPathItem,
//   the tab sub-path (placed by Step 9B) is hidden for the PNG then restored.
// Stamps (PlacedItem cutline): exported without a vector clip mask; a white
//   rectangle is used as backing instead.
//
// Returns: { pngCount: N, flags: [{name, reason}] }

function runAssetExport(doc) {
    if (CONFIG.dryRun) {
        log("[step10] [DRY RUN] would export JPEG previews and per-element PNGs.");
        return { pngCount: 0, flags: [] };
    }

    var outFolder;
    try {
        outFolder = doc.fullName.parent.fsName;
    } catch (e) {
        throw new Error("Document must be saved before running Step 10.");
    }

    var stickersLayer = _s10LayerCI(doc, "stickers") || _s10LayerCI(doc, "sticker");
    if (!stickersLayer) throw new Error("Sticker/Stickers layer not found.");

    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        throw new Error("Cutlines layer not found: " + CONFIG.cutlinesLayerName);
    }

    var stkCode  = doc.name.replace(/\.[^.]+$/, "").split(" ")[0];
    var built    = _s10BuildClipData(stickersLayer, cutlinesLayer);
    var clipData = built.clipData;
    var flags    = built.flags;

    log("[step10] " + clipData.length + " element(s) to export; "
        + flags.length + " unmatched.");

    _s10ExportJpegs(doc, clipData, outFolder, stkCode);

    var pngCount = 0, i;
    for (i = 0; i < clipData.length; i++) {
        try {
            _s10ExportElementPng(doc, clipData[i], outFolder, stkCode);
            pngCount++;
            log("[step10] PNG | " + clipData[i].displayName);
        } catch (e) {
            flags.push({ name: clipData[i].displayName, reason: e.message });
            log("[step10] FLAG | " + clipData[i].displayName + " | " + e.message);
        }
    }

    log("[step10] done | pngCount=" + pngCount + " flags=" + flags.length);
    return { pngCount: pngCount, flags: flags };
}


// ─── SETUP ────────────────────────────────────────────────────────────────────

// Builds the list of elements to export, paired with their cutlines by display name.
function _s10BuildClipData(stickersLayer, cutlinesLayer) {
    var cutlineMap = {}, i, item, parsed;

    for (i = 0; i < cutlinesLayer.pageItems.length; i++) {
        item = cutlinesLayer.pageItems[i];
        if (item.parent !== cutlinesLayer) continue;
        if (item.typename === "GroupItem") {
            parsed = parseLayerName(item.name);
            cutlineMap[parsed ? parsed.displayName : item.name] = item;
        } else if (item.typename === "PlacedItem") {
            cutlineMap[item.name] = item;
        }
    }

    var clipData = [], flags = [], displayName, cutline;
    for (i = 0; i < stickersLayer.pageItems.length; i++) {
        item = stickersLayer.pageItems[i];
        if (item.parent !== stickersLayer) continue;
        parsed      = parseLayerName(item.name);
        displayName = parsed ? parsed.displayName : item.name;
        cutline     = cutlineMap[displayName];
        if (!cutline) {
            flags.push({ name: item.name, reason: "no matching cutline" });
            log("[step10] SKIP | " + item.name + " | no matching cutline");
            continue;
        }
        clipData.push({
            element:     item,
            cutline:     cutline,
            displayName: displayName,
            note:        cutline.note || "",
            isStamp:     (cutline.typename === "PlacedItem")
        });
    }
    return { clipData: clipData, flags: flags };
}


// ─── PHASE 1: JPEG PREVIEWS ───────────────────────────────────────────────────

// Builds all clip groups on a temporary layer, exports white + green JPEG
// previews, then discards the layer.
function _s10ExportJpegs(doc, clipData, outFolder, stkCode) {
    log("[step10] building temp clip groups for JPEG...");
    var snap = _s10HideAllLayers(doc);

    var tmpLayer     = doc.layers.add();
    tmpLayer.name    = "___step10_tmp_jpeg___";
    tmpLayer.visible = true;

    var i, entry, cutlinePath, artDupe, cutDupe, whiteDupe, grp;
    for (i = 0; i < clipData.length; i++) {
        entry       = clipData[i];
        artDupe     = entry.element.duplicate(tmpLayer, ElementPlacement.PLACEATEND);
        cutlinePath = _s10GetCutlinePath(entry.cutline);

        if (cutlinePath) {
            cutDupe   = cutlinePath.duplicate(tmpLayer, ElementPlacement.PLACEATEND);
            whiteDupe = cutDupe.duplicate(tmpLayer, ElementPlacement.PLACEATEND);
            _s10SetWhiteFill(whiteDupe);
            grp = tmpLayer.groupItems.add();
            grp.name = entry.displayName;
            cutDupe.moveToBeginning(grp);   // pageItems[0] = clipping mask
            artDupe.moveToEnd(grp);
            whiteDupe.moveToEnd(grp);
            grp.clipped = true;
        }
        // Stamps (PlacedItem cutline): artDupe placed directly on tmpLayer, no clip mask.
    }

    // Show all original layers; suppress Color Block for white-background pass.
    _s10ShowAll(snap);
    var colorBlockLayer = _s10LayerCI(doc, CONFIG.colorBlockLayerName);
    if (colorBlockLayer) colorBlockLayer.visible = false;

    var opts          = new ExportOptionsJPEG();
    opts.qualitySetting = CONFIG.jpegQuality;
    opts.antiAliasing = true;

    doc.exportFile(new File(outFolder + "/" + stkCode + "_preview_white.jpg"),
                   ExportType.JPEG, opts);
    log("[step10] JPEG white saved.");

    if (colorBlockLayer) {
        colorBlockLayer.visible = true;
    } else {
        log("[step10] WARN | Color Block layer not found: " + CONFIG.colorBlockLayerName);
    }

    doc.exportFile(new File(outFolder + "/" + stkCode + "_preview_green.jpg"),
                   ExportType.JPEG, opts);
    log("[step10] JPEG green saved.");

    tmpLayer.remove();
    _s10RestoreLayers(snap);
    log("[step10] JPEG export done.");
}


// ─── PHASE 2: PNG PER-ELEMENT ─────────────────────────────────────────────────

// Exports one element as a PNG. Hides all original layers, builds a single
// temporary clip group (or white-backed artwork for stamps), exports, then
// discards the temporary objects.
function _s10ExportElementPng(doc, entry, outFolder, stkCode) {
    var snap     = _s10HideAllLayers(doc);
    var tmpLayer = doc.layers.add();
    tmpLayer.name    = "___step10_tmp_png___";
    tmpLayer.visible = true;

    var artDupe     = entry.element.duplicate(tmpLayer, ElementPlacement.PLACEATEND);
    var cutlinePath = _s10GetCutlinePath(entry.cutline);
    var cutDupe     = null;
    var whiteDupe   = null;

    if (cutlinePath) {
        // Non-stamp: build clip group [cutDupe (mask), artDupe, whiteDupe].
        cutDupe   = cutlinePath.duplicate(tmpLayer, ElementPlacement.PLACEATEND);
        whiteDupe = cutDupe.duplicate(tmpLayer, ElementPlacement.PLACEATEND);
        _s10SetWhiteFill(whiteDupe);

        var grp  = tmpLayer.groupItems.add();
        grp.name = entry.displayName;
        cutDupe.moveToBeginning(grp);   // pageItems[0] = clipping mask
        artDupe.moveToEnd(grp);
        whiteDupe.moveToEnd(grp);
        grp.clipped = true;
    } else {
        // Stamp: no vector clipping path available. Use a white-filled bounding
        // rectangle as backing — the stamp artwork defines its own visible extent.
        var wb = artDupe.geometricBounds; // [left, top, right, bottom]
        var whiteRect = tmpLayer.pathItems.rectangle(
            wb[1], wb[0],
            Math.abs(wb[2] - wb[0]),
            Math.abs(wb[3] - wb[1])
        );
        whiteRect.filled    = true;
        whiteRect.fillColor = whiteCmyk();
        whiteRect.stroked   = false;
        whiteRect.zOrder(ZOrderMethod.SENDTOBACK);
    }

    // Tab hiding: if cutline is a CompoundPathItem (ST/unnamed element with Step 9B
    // tab merged in), hide the tab sub-path before export, restore after.
    var tabSubPath = null;
    if (!entry.isStamp && cutDupe
            && cutDupe.typename === "CompoundPathItem"
            && cutDupe.pathItems.length > 1) {
        var note = parseNote(entry.note);
        var sc   = note ? note.styleCode : null;
        if (sc !== "GC" && sc !== "WC") {
            tabSubPath = _s10FindTabSubPath(cutDupe, artDupe);
            if (tabSubPath) {
                tabSubPath.hidden = true;
                log("[step10] tab hide | " + entry.displayName);
            } else {
                log("[step10] WARN | tab sub-path not found in compound | "
                    + entry.displayName);
            }
        }
    }

    var pngOpts       = new ExportOptionsPNG24();
    pngOpts.transparency = true;
    pngOpts.resolution   = CONFIG.pngExportScale;
    pngOpts.antiAliasing = true;
    var safeName = entry.displayName.replace(/[\/\\:*?"<>|]/g, "_");
    doc.exportFile(
        new File(outFolder + "/" + stkCode + "_" + safeName + ".png"),
        ExportType.PNG24,
        pngOpts
    );

    if (tabSubPath) tabSubPath.hidden = false;

    tmpLayer.remove();
    _s10RestoreLayers(snap);
}


// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

// Returns the clippable PathItem/CompoundPathItem from a cutline GroupItem.
// Returns null for PlacedItems (stamps) — they cannot serve as clip masks.
function _s10GetCutlinePath(cutlineItem) {
    var j, tn;
    if (cutlineItem.typename === "GroupItem") {
        var candidate = findGroupMember(cutlineItem, "");
        if (candidate) return candidate;
        for (j = 0; j < cutlineItem.pageItems.length; j++) {
            tn = cutlineItem.pageItems[j].typename;
            if ((tn === "PathItem" || tn === "CompoundPathItem")
                    && !cutlineItem.pageItems[j].hidden) {
                return cutlineItem.pageItems[j];
            }
        }
    }
    if (cutlineItem.typename === "PathItem"
            || cutlineItem.typename === "CompoundPathItem") {
        return cutlineItem;
    }
    return null;
}

// Identifies the tab sub-path inside a CompoundPathItem: the sub-path that is
// farthest from the element centroid (normalised by sub-path bounding-box size).
// The peeling tab placed by Step 9B is always the outlier sub-path.
function _s10FindTabSubPath(compoundPath, element) {
    var elCenter = boundsCenter(element.geometricBounds);
    var best = null, bestScore = -1;
    var i, pi, b, area, center, dx, dy, dist, score;
    for (i = 0; i < compoundPath.pathItems.length; i++) {
        pi     = compoundPath.pathItems[i];
        b      = pi.geometricBounds;
        area   = Math.abs((b[2] - b[0]) * (b[3] - b[1]));
        center = boundsCenter(b);
        dx     = center.x - elCenter.x;
        dy     = center.y - elCenter.y;
        dist   = Math.sqrt(dx * dx + dy * dy);
        score  = dist / (area > 0 ? Math.sqrt(area) : 1);
        if (score > bestScore) { bestScore = score; best = pi; }
    }
    return best;
}

// Recursively applies white fill and removes stroke on all path items within item.
function _s10SetWhiteFill(item) {
    var w = whiteCmyk(), i, tn = item.typename;
    if (tn === "PathItem" || tn === "CompoundPathItem") {
        item.filled    = true;
        item.fillColor = w;
        item.stroked   = false;
        if (tn === "CompoundPathItem") {
            for (i = 0; i < item.pathItems.length; i++) {
                item.pathItems[i].filled    = true;
                item.pathItems[i].fillColor = w;
                item.pathItems[i].stroked   = false;
            }
        }
    } else if (tn === "GroupItem") {
        for (i = 0; i < item.pageItems.length; i++) {
            _s10SetWhiteFill(item.pageItems[i]);
        }
    }
}

// Hides all layers and returns a visibility snapshot [{layer, wasVisible}].
function _s10HideAllLayers(doc) {
    var snap = [], i;
    for (i = 0; i < doc.layers.length; i++) {
        snap.push({ layer: doc.layers[i], wasVisible: doc.layers[i].visible });
        doc.layers[i].visible = false;
    }
    return snap;
}

// Sets all snapshotted layers to visible (used before a full-sheet export).
function _s10ShowAll(snap) {
    var i;
    for (i = 0; i < snap.length; i++) {
        try { snap[i].layer.visible = true; } catch (e) { /* layer may be gone */ }
    }
}

// Restores layer visibility to the state recorded by _s10HideAllLayers.
function _s10RestoreLayers(snap) {
    var i;
    for (i = 0; i < snap.length; i++) {
        try { snap[i].layer.visible = snap[i].wasVisible; } catch (e) { /* layer gone */ }
    }
}

// Case-insensitive layer lookup.
function _s10LayerCI(doc, name) {
    var n = name.toLowerCase(), i;
    for (i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i].name.toLowerCase() === n) return doc.layers[i];
    }
    return null;
}
