// Step11_FinalFile.jsx — Phase function only.
// #included by AI_ExportFinal.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Saves the working .ai file as {STK_CODE}_export/{STK_CODE}_final.ai (in the
// organized export tree beside the working file), then strips all non-production
// layers and standardises the halfcut layer name.
//
// The working file is untouched on disk — saveAs creates a new file and all
// layer edits apply only to the final copy.
//
// Returns: { outputPath: String, layerCount: N }

function runFinalFile(doc) {
    if (CONFIG.dryRun) {
        log("[step11] [DRY RUN] would save final file and strip non-production layers.");
        return { outputPath: "", layerCount: 0 };
    }

    var parentFolder;
    try {
        parentFolder = doc.fullName.parent.fsName;
    } catch (e) {
        throw new Error("Document must be saved before running Step 11.");
    }

    var stkCode   = doc.name.replace(/\.[^.]+$/, "").split(" ")[0];
    // Ship the final file into the organized export tree (same {stkCode}_export/ root as
    // Step 10's previews/elements), not flat beside the working .ai.
    var exportRoot = ensureExportFolders(parentFolder, stkCode).root;
    var finalFile  = new File(exportRoot + "/" + stkCode + "_final.ai");

    log("[step11] saving final file: " + finalFile.fsName);
    // Ship a SELF-CONTAINED final file: embed every linked asset so {STK}_final.ai survives
    // being handed to another machine / the printer (a linked placement stores an absolute
    // path that breaks off-machine). Art is already embedded upstream (Step 7B); this also
    // catches the GC caption-plate raster and any other straggler at save time.
    var saveOpts = new IllustratorSaveOptions();
    saveOpts.embedLinkedFiles = true;
    doc.saveAs(finalFile, saveOpts);

    // After saveAs, app.activeDocument is now the final file.
    var fd = app.activeDocument;

    // Safety net: drop the spacing-buffer sublayer if it slipped through (AI_ExportFinal tears it
    // down up front, but a direct runFinalFile call would not) — the halo must never print.
    try { removeAllSpacingBuffers(fd); } catch (eBuf) {}

    // Standardise halfcut layer name.
    var halfcutLayer = _s11FindHalfcutLayer(fd);
    if (halfcutLayer) {
        halfcutLayer.name = CONFIG.finalHalfcutLayerName;
        log("[step11] halfcut layer → \"" + CONFIG.finalHalfcutLayerName + "\"");
    } else {
        log("[step11] WARN | halfcut layer not found — skipping rename.");
    }

    // Strip to the three production layers via an ALLOWLIST (keep-by-identity), NOT a
    // denylist of names. A name-based strip only removes layers it can enumerate, so any
    // stray layer it didn't name — a leftover spacing buffer, an artist's scratch layer,
    // a future QA layer — rode through into the final file (the recurring "extra layer"
    // bug). Keeping ONLY Cutlines, the halfcut layer, and Sticker guarantees exactly the
    // three production layers regardless of what else is in the working file.
    var keepers = [];
    if (halfcutLayer) keepers.push(halfcutLayer);
    var cutlinesKeep = findLayer(fd, CONFIG.cutlinesLayerName);
    if (cutlinesKeep) keepers.push(cutlinesKeep);
    var stickersKeep = findLayer(fd, CONFIG.stickersLayerName);
    if (stickersKeep) keepers.push(stickersKeep);
    var i;
    for (i = fd.layers.length - 1; i >= 0; i--) {
        if (_s11IsKeeper(fd.layers[i], keepers)) continue;
        log("[step11] removing layer: " + fd.layers[i].name);
        // buildWorkingDocument creates Margin/Grid/Color Block LOCKED, and
        // layer.remove() throws "Trying to delete locked layer" — unlock first.
        fd.layers[i].locked  = false;
        fd.layers[i].visible = true;
        fd.layers[i].remove();
    }

    // Move VISIBLE printed caption/tab artwork out of the Cutlines groups onto the
    // Stickers layer. The cutter cuts every visible path in Cutlines/Halfcut, so the
    // printed pill/text/GC-raster/tab-fill must not live there. Final copy only; move()
    // preserves absolute position, so each caption stays exactly inside its cut.
    _s11MoveCaptionsToStickers(fd);

    // Convert live caption text to vector outlines so the final file carries no font
    // dependency (the printer/another machine need not have Kalam installed). Warped
    // captions are already baked to path geometry upstream (Step 7B Expand Appearance);
    // only flat-bottomed captions survive as live TextFrames — this catches those.
    _s11OutlineText(fd);

    var layerCount = fd.layers.length;
    if (layerCount !== 3) {
        log("[step11] WARN | expected 3 layers in final file, found " + layerCount
            + " — check final file manually.");
    }

    // Persist the layer-stripped file with EXPLICIT save options. A bare fd.save()
    // pops Illustrator's native "Options" save dialog, which blocks a headless/
    // scripted run (AppleEvent hangs). Re-use the same IllustratorSaveOptions as the
    // saveAs above so the write is silent and self-contained (links embedded).
    fd.saveAs(finalFile, saveOpts);
    log("[step11] done | " + finalFile.fsName + " | layers=" + layerCount);
    return { outputPath: finalFile.fsName, layerCount: layerCount };
}


// ─── PRIVATE HELPERS ─────────────────────────────────────────────────────────

// Finds the halfcut layer by case-insensitive name. Matches any layer whose
// name contains "halfcut" or "half cut" (handles all observed name variants).
function _s11FindHalfcutLayer(doc) {
    for (var i = 0; i < doc.layers.length; i++) {
        var n = doc.layers[i].name.toLowerCase();
        if (n.indexOf("halfcut") !== -1 || n.indexOf("half cut") !== -1) {
            return doc.layers[i];
        }
    }
    return null;
}

// True when `layer` is one of the keeper layers (object identity, not name).
function _s11IsKeeper(layer, keepers) {
    for (var i = 0; i < keepers.length; i++) {
        if (keepers[i] === layer) return true;
    }
    return false;
}

// Converts every remaining live TextFrame in the final doc to vector outlines, so the
// shipped file has no font dependency. Snapshots the collection first — createOutline()
// replaces each frame with a GroupItem in place, mutating doc.textFrames as it goes.
// After Step 11's strip the only text left is caption text (on Sticker); warped captions
// are already path geometry, so this only outlines the flat-bottomed frames. Returns count.
function _s11OutlineText(fd) {
    var frames = [], i;
    for (i = 0; i < fd.textFrames.length; i++) frames.push(fd.textFrames[i]);
    var outlined = 0;
    for (i = 0; i < frames.length; i++) {
        try {
            frames[i].createOutline();
            outlined++;
        } catch (e) {
            log("[step11] WARN | could not outline text '" + frames[i].name + "': " + e.message);
        }
    }
    log("[step11] text outlined | " + outlined + " frame(s)");
    return outlined;
}

// Gathers every element GroupItem in a Cutlines container, recursing into SUBLAYERS
// (artists tuck groups/stamps into a Cutlines sublayer — mirrors Step8c _collectCutlines
// and StepQA). layer.pageItems recurses into GROUPS (hence the item.parent guard for
// direct children) but NOT into sublayers (hence the explicit container.layers recursion).
function _s11CollectCutlineGroups(container) {
    var out = [], i, j, inner;
    if (container.layers) {
        for (i = 0; i < container.layers.length; i++) {
            inner = _s11CollectCutlineGroups(container.layers[i]);
            for (j = 0; j < inner.length; j++) out.push(inner[j]);
        }
    }
    for (i = 0; i < container.pageItems.length; i++) {
        var item = container.pageItems[i];
        if (item.parent !== container) continue;   // direct children only (pageItems recurses groups)
        if (item.typename === "GroupItem") out.push(item);
    }
    return out;
}

// Relocates each element's VISIBLE printed caption/tab artwork (white pill, text, GC
// raster, default-tab fill) out of the Cutlines groups and onto the Stickers layer, so
// the cutter (which cuts every VISIBLE path in Cutlines/Halfcut) never cuts it. Runs on
// the FINAL-FILE copy only, after all transforms — move() preserves absolute artwork
// coordinates, so each caption stays exactly inside the cut that traces it. The fused
// cut path (the one member named === group.name) and hidden helpers stay in Cutlines.
// Returns { elements: N, items: M }.
function _s11MoveCaptionsToStickers(fd) {
    var stickersLayer = findLayer(fd, CONFIG.stickersLayerName);
    if (!stickersLayer) {
        // Hard error, no fallback: printed art needs a home layer that isn't cut.
        throw new Error("Stickers layer '" + CONFIG.stickersLayerName
            + "' not found — cannot relocate printed caption artwork.");
    }
    var cutlinesLayer = findLayer(fd, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        log("[step11] WARN | Cutlines layer '" + CONFIG.cutlinesLayerName
            + "' not found — no caption relocation.");
        return { elements: 0, items: 0 };
    }

    // Collect element groups across the Cutlines layer AND its sublayers. Snapshot up
    // front — moving a group's children never changes which groups exist.
    var groups = _s11CollectCutlineGroups(cutlinesLayer);

    var elementsMoved = 0, itemsMoved = 0, g, c;
    for (g = 0; g < groups.length; g++) {
        var group   = groups[g];
        var cutPath = findGroupMember(group, "");   // member named exactly group.name
        if (!cutPath) {
            // Malformed group: can't tell which child is the cut, so relocate NOTHING
            // (never silently sweep real cut geometry). Surface it loudly.
            log("[step11] SKIP | group has no cut path | " + group.name);
            continue;
        }

        // Collect VISIBLE, non-cut children (front-to-back). Hidden helpers stay put.
        var movers = [];
        for (c = 0; c < group.pageItems.length; c++) {
            var child = group.pageItems[c];
            if (child === cutPath) continue;
            if (child.hidden) continue;
            // A spacing-buffer halo ("{name} buffer") is a VISIBLE child of the cut group
            // that must never print. It is normally removed upstream (removeAllSpacingBuffers);
            // if one survives, do NOT sweep it onto Stickers (it would print a magenta band).
            // Skip it — it stays in Cutlines and _s11AssertNoPrintedInCutlines flags it loudly.
            var cn = String(child.name);
            if (cn.substring(cn.length - 7) === " buffer") continue;
            movers.push(child);
        }
        if (!movers.length) continue;

        // Wrap in a "{name} caption" group at the TOP of Stickers (above all art),
        // preserving the movers' relative z-order.
        var capGroup = stickersLayer.groupItems.add();
        capGroup.name = group.name + " caption";
        capGroup.move(stickersLayer, ElementPlacement.PLACEATBEGINNING);
        // Iterate back-to-front, each move to the FRONT, so the original front-most item
        // ends up front-most (moving front-to-back to the end would reverse the order).
        for (c = movers.length - 1; c >= 0; c--) {
            movers[c].move(capGroup, ElementPlacement.PLACEATBEGINNING);
            itemsMoved++;
        }
        elementsMoved++;
    }

    // Advisory post-move check (warn-on-all): every remaining visible item in a Cutlines
    // group must be its cut path. A leftover visible non-cut child is a printed item the
    // cutter would cut — surface it (does not abort). Reuse the groups already collected —
    // moving children onto Stickers does not change which groups exist on Cutlines.
    _s11AssertNoPrintedInCutlines(groups);

    log("[step11] captions relocated to Stickers | " + elementsMoved
        + " element(s), " + itemsMoved + " item(s)");
    return { elements: elementsMoved, items: itemsMoved };
}

// Given the Cutlines GroupItems (already collected by _s11CollectCutlineGroups), logs any
// VISIBLE child that is not the group's cut path (the member named === group.name). A group
// missing its cut path is itself surfaced. Advisory — logs a marker, does not throw. Returns
// offender count. Takes the pre-collected groups to avoid a second full tree traversal.
function _s11AssertNoPrintedInCutlines(groups) {
    var offenders = [], g, c;
    for (g = 0; g < groups.length; g++) {
        var it = groups[g];
        var cutPath = findGroupMember(it, "");
        if (!cutPath) {
            offenders.push((it.name || "(group)") + "/(no cut path — not relocated)");
            continue;
        }
        for (c = 0; c < it.pageItems.length; c++) {
            var m = it.pageItems[c];
            if (m === cutPath) continue;
            if (!m.hidden) {
                offenders.push((it.name || "(group)") + "/" + (m.name || "(unnamed)"));
            }
        }
    }
    if (offenders.length) {
        log("[step11] *** PRINTED ITEM LEFT IN CUTLINES *** | " + offenders.join(", "));
    }
    return offenders.length;
}
