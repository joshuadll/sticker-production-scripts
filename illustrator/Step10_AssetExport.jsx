// Step10_AssetExport.jsx — Phase function only.
// #included by AI_ExportFinal.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Exports JPEG sheet previews (white + green BG) and per-element PNGs.
// Temporary clip groups are built per-export and immediately discarded —
// no persistent layer is left in the working file.
//
// GC/WC elements: clipped to fused cutline.
// ST/unnamed elements: clipped to cutline.
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

    var stickersLayer = findLayer(doc, CONFIG.stickersLayerName);
    if (!stickersLayer) throw new Error("Sticker layer not found: " + CONFIG.stickersLayerName);

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
    var colorBlockLayer = findLayer(doc, CONFIG.colorBlockLayerName);
    colorBlockLayer.visible = false;

    var opts          = new ExportOptionsJPEG();
    opts.qualitySetting = CONFIG.jpegQuality;
    opts.antiAliasing = true;

    doc.exportFile(new File(outFolder + "/" + stkCode + "_preview_white.jpg"),
                   ExportType.JPEG, opts);
    log("[step10] JPEG white saved.");

    // Restore Color Block for the green-background pass.
    colorBlockLayer.visible = true;

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
