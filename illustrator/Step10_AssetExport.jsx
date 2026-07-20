// Step10_AssetExport.jsx — Phase function only.
// #included by AI_ExportFinal.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Exports JPEG sheet previews (white + green BG) and per-element PNGs into the
// organized export tree beside the working file: {stkCode}_export/previews/ for the
// two sheet JPEGs and {stkCode}_export/elements/ for the per-element PNGs (Step 11
// drops {stkCode}_final.ai at the export root). Temporary clip groups are built
// per-export and immediately discarded — no persistent layer is left in the working file.
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

    // Safety net (mirrors Step 11): drop the working-phase spacing-buffer sublayer before
    // exporting. AI_ExportFinal already does this up front, but a direct/standalone runAssetExport
    // must not bake a keep-out band into a PNG.
    try { removeAllSpacingBuffers(doc); } catch (eBuf) {}

    var stkCode  = doc.name.replace(/\.[^.]+$/, "").split(" ")[0];
    // Organized export tree beside the working file: {stkCode}_export/{previews,elements}.
    var folders  = ensureExportFolders(outFolder, stkCode);
    log("[step10] export folder | " + folders.root);
    var built    = _s10BuildClipData(stickersLayer, cutlinesLayer);
    var clipData = built.clipData;
    var flags    = built.flags;

    log("[step10] " + clipData.length + " element(s) to export; "
        + flags.length + " unmatched.");

    _s10ExportJpegs(doc, clipData, folders.previews, stkCode);

    var pngCount = 0, i;
    for (i = 0; i < clipData.length; i++) {
        try {
            _s10ExportElementPng(doc, clipData[i], folders.elements, stkCode);
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
            isStamp:     (cutline.typename === "PlacedItem")
        });
    }
    return { clipData: clipData, flags: flags };
}


// Returns the largest-bbox sub-path of a CompoundPathItem (the real silhouette),
// ignoring the degenerate near-zero-area slivers the trace/Unite leaves behind.
function _s10LargestSubPath(cp) {
    var best = null, bestA = -1, i, p, b, a;
    for (i = 0; i < cp.pathItems.length; i++) {
        p = cp.pathItems[i];
        b = p.geometricBounds;                       // [left, top, right, bottom]
        a = Math.abs(b[2] - b[0]) * Math.abs(b[1] - b[3]);
        if (a > bestA) { bestA = a; best = p; }
    }
    return best;
}

// Apply the clipping mask to a prepared clip group (mask already at pageItems[0]).
// `grp.clipped = true` only accepts a PathItem mask; a CompoundPathItem throws
// "The top item in the group must be a path item to create a mask". Here the fused
// cutline is often *spuriously* compound — the real silhouette plus 1–2 degenerate
// ~zero-area sliver subpaths from the trace/Unite (verified: no true interior holes).
// So for a compound mask, promote its largest subpath to a standalone PathItem and
// clip with that: headless-safe (no makeMask menu command, which blocks in this
// context), and loses no visible geometry. The PathItem case keeps the proven property
// path unchanged, so the non-compound elements export byte-for-byte as before.
function _s10ClipGroup(doc, grp) {
    var mask = grp.pageItems[0];
    if (mask.typename === "PathItem") {
        grp.clipped = true;
        return;
    }
    if (mask.typename === "CompoundPathItem") {
        var biggest = _s10LargestSubPath(mask);
        if (biggest) {
            var solo = biggest.duplicate(grp, ElementPlacement.PLACEATBEGINNING);
            mask.remove();                 // drop the compound (incl. slivers)
            solo.moveToBeginning(grp);      // re-assert the PathItem mask at [0]
            grp.clipped = true;
            return;
        }
    }
    // Unexpected mask type / empty compound — leave unclipped rather than crash; the
    // per-element art carries its own alpha, so the export is still usable.
    log("[step10] WARN | could not clip '" + grp.name + "' (mask " + mask.typename
        + ") — exported unclipped");
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
            _s10AddCaptionMembers(grp, entry.cutline, tmpLayer, true);   // sheet preview: keep the peel-tab decoration
            cutDupe.moveToBeginning(grp);   // re-assert the mask at pageItems[0]
            _s10ClipGroup(doc, grp);
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
    // ExportOptionsJPEG scale is a % of 72 DPI; unset → 72 DPI → pixelated sheet preview.
    // Drive it from CONFIG.jpegPreviewDpi (fallback 300) so previews render at print-ish density.
    var _previewScale = ((CONFIG.jpegPreviewDpi || 300) / 72) * 100;
    opts.horizontalScale = _previewScale;
    opts.verticalScale   = _previewScale;

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
        _s10AddCaptionMembers(grp, entry.cutline, tmpLayer, false);   // product PNG: drop the peel-tab decoration (captions kept)
        cutDupe.moveToBeginning(grp);   // re-assert the mask at pageItems[0]
        _s10ClipGroup(doc, grp);
        _s10RotateUpright(doc, grp, entry);   // upright for export (per-element PNG only)
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
        whiteRect.fillColor = whiteRgb();
        whiteRect.stroked   = false;
        whiteRect.zOrder(ZOrderMethod.SENDTOBACK);
    }

    var pngOpts       = new ExportOptionsPNG24();
    pngOpts.transparency = true;
    // ExportOptionsPNG24 has NO honored `resolution` property — like ExportOptionsJPEG it
    // scales by percent of 72 DPI via horizontal/verticalScale. Setting `.resolution` is a
    // silent no-op → the PNG exported at 72 DPI (~4x too few px, pixelated). Drive the scale
    // from CONFIG.pngExportScale (the target DPI = sourceDPI, fallback 300) the same way the
    // JPEG sheet preview does, so a 2.3in element lands at 2.3*DPI px instead of 2.3*72.
    var _pngScale = (CONFIG.pngExportScale / 72) * 100;
    pngOpts.horizontalScale = _pngScale;
    pngOpts.verticalScale   = _pngScale;
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

// Returns the clippable PathItem/CompoundPathItem from a cutline. Drills into groups —
// the named cut member can itself be a GroupItem (Pathfinder Unite wraps its result), and
// that must resolve to a flat path to serve as a clip mask. Returns null for PlacedItems
// (stamps) — they cannot serve as clip masks.
function _s10GetCutlinePath(cutlineItem) {
    if (!cutlineItem) return null;
    var tn = cutlineItem.typename;
    if (tn === "PathItem" || tn === "CompoundPathItem") return cutlineItem;
    if (tn === "GroupItem") {
        // Prefer the named cut member, then any path in it; fall back to the whole group.
        var candidate = findGroupMember(cutlineItem, "");
        var p = candidate ? _s10FirstClipPath(candidate) : null;
        if (p) return p;
        return _s10FirstClipPath(cutlineItem);
    }
    return null;
}

// First visible PathItem/CompoundPathItem in `item`, drilling into nested groups; else null.
function _s10FirstClipPath(item) {
    if (!item) return null;
    var tn = item.typename, j, r;
    if (tn === "PathItem" || tn === "CompoundPathItem") return item.hidden ? null : item;
    if (tn === "GroupItem") {
        for (j = 0; j < item.pageItems.length; j++) {
            r = _s10FirstClipPath(item.pageItems[j]);
            if (r) return r;
        }
    }
    return null;
}

// Duplicates a native element's VISIBLE printed members from its cutline group into the temp
// clip group `grp`, placing each at the FRONT so the final stack is text > pill > plate > art >
// white-backing. Covers BOTH captioned elements (decorative plate raster, white pill, text) AND
// default-tab/uncaptioned elements, whose printed "PEEL HERE"/semi-circle decoration is the
// separate " tab fill" ride-along member (the " plate" member there is the hidden tab cutline, so
// it is skipped by the !hidden guard). The " tab fill" is gated by `includeTabFill` — kept for
// the sheet JPEG previews, dropped for the per-element product PNG (see the flag docs below).
// The caller re-asserts the clip mask at pageItems[0] afterward. These members live inside the
// cut boundary, so they clip cleanly with the rest. No-op for stamps (PlacedItem cutline) /
// missing members.
function _s10AddCaptionMembers(grp, cutlineItem, tmpLayer, includeTabFill) {
    if (!cutlineItem || cutlineItem.typename !== "GroupItem") return;
    // Back-to-front insertion (each moved to the front): plate, pill, tab fill, then text.
    // The " tab fill" (the "PEEL HERE" / semi-circle grab decoration) exists ONLY on
    // uncaptioned default-tab elements; captioned elements never have it. includeTabFill
    // is false for the per-element product PNG (the peel-tab decoration shouldn't print on
    // the finished sticker image) and true for the sheet JPEG previews (which show the tab
    // in the nesting layout). Captioned members ride along regardless of this flag.
    var order = includeTabFill
        ? [" caption plate", " plate", " tab fill", " caption text"]
        : [" caption plate", " plate", " caption text"];
    var k, member, dup;
    for (k = 0; k < order.length; k++) {
        member = findGroupMember(cutlineItem, order[k]);
        if (member && !member.hidden) {
            dup = member.duplicate(tmpLayer, ElementPlacement.PLACEATEND);
            dup.move(grp, ElementPlacement.PLACEATBEGINNING);
        }
    }
}

// Rotates the temp clip group `grp` to the element's upright design orientation before
// the per-element PNG export: the caption reference (the " plate" member) is laid
// horizontal and below the art — the Step-6 orientation, regardless of nesting or the
// artist's manual rotation. The " plate" member covers GC/WC captions AND default-tab/ST
// elements: assembleElementGroup names a default tab's cutline "<name> plate" too (the
// bare " tab cutline" name is transient and never survives assembly), so " plate" is the
// single reference for every element type; " tab cutline" is a defensive no-op fallback.
// Angle comes from the reference GEOMETRY on the live cutline (matrix-independent, so it
// dodges the embed() sign-flip and reflects manual rotation). Falls back to the u<deg>
// note stamp, then to a no-op + WARN. The sheet JPEG previews do NOT call this — they
// must keep the nested layout.
function _s10RotateUpright(doc, grp, entry) {
    var cut = entry.cutline, theta = null;
    if (cut && cut.typename === "GroupItem") {
        var ref = findGroupMember(cut, " plate");        // GC/WC pill AND ST/default-tab cutline
        if (!ref) ref = findGroupMember(cut, " tab cutline");   // defensive; not on assembled groups
        var art = findGroupMember(cut, " outline");
        if (ref) theta = _uprightRotationDeg(_pathAnchors(ref), art ? _pathAnchors(art) : null);
    }
    if (theta === null && cut) {
        var u = noteReadRotStamp(cut.note);     // nest-time deviation; last resort
        if (u !== null) theta = -u;
    }
    if (theta === null) {
        log("[step10] WARN | no upright reference for '" + entry.displayName
            + "' — exported in nest orientation");
        return;
    }
    theta = _aiNormalizeDeg(theta);
    if (Math.abs(theta) < 0.05) {
        log("[step10] upright | " + entry.displayName + " | already upright");
        return;
    }
    var gb = grp.geometricBounds;               // [left, top, right, bottom]
    var cx = (gb[0] + gb[2]) / 2, cy = (gb[1] + gb[3]) / 2;
    grp.transform(pivotRotationMatrix(theta, cx, cy),
        true, true, true, true, 1, Transformation.DOCUMENTORIGIN);
    log("[step10] upright | " + entry.displayName + " | rotated " + Math.round(theta) + "°");
}

// Recursively applies white fill and removes stroke on all path items within item.
function _s10SetWhiteFill(item) {
    var w = whiteRgb(), i, tn = item.typename;
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
