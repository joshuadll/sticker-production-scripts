// Step8b_CaptionNormalise.jsx — Phase function only.
// #included by AI_NormaliseCaptions.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// STANDALONE, RE-RUNNABLE caption/plate spec normalisation (playbook §6). The artist
// nests by hand, scaling each element — art + white edge + caption + cutline — as ONE
// unit to fit the artboard ("Model B"). That uniform scale drags the caption and plate
// OFF their absolute spec (a 0.5cm plate on a half-size sticker becomes 0.25cm; the
// caption text stops being 8pt). This phase re-asserts spec, and is meant to be run
// repeatedly inside the manual nest loop (resize → normalise → resize → …), like the
// Layout QA pass. It is idempotent: an already-spec element is left untouched.
//
// The native caption (white pill + text + optional GC plate raster) lives INSIDE the cut
// group and scales with the element when the artist nest-scales it. buildCaption stamps the
// SPEC pill AREA into the note ("style|lines|a<pt²>"); the scale reference is that vs the
// current pill area — no Stickers caption PNG / matrix scale. AREA is rotation-invariant, so
// the seat's tilt doesn't corrupt it (a bbox height would drift with tilt and never settle).
//
// Per captioned group (matched by name; survives the artist's moves/rotations):
//   unscale = sqrt(spec-pill-area / current-pill-area)     // undo the artist's scaling
//   1. RESIZE — scale the caption members (pill + text + GC plate raster) to absolute spec
//      about the PILL CENTRE (a common pivot under uniform scale keeps them aligned;
//      placement is fixed up next). Works for GC pills and WC curved capsules alike.
//   2. RE-SEAT — re-place the spec plate + caption against the TRACED OUTLINE (the vector
//      that becomes the cut) via the shared aiUtils.seatPlateToOutline: inner-edge endpoints
//      → rotate to the outline chord → kiss to a small submerged depth, with overhang /
//      convex-bulge shrink. Because it measures the cut's own geometry, the overlap it sets
//      is the overlap that survives the Unite (no raster/trace mismatch → no detached
//      caption), and resize no longer has to preserve the seat — they are decoupled. This
//      REPLACED the old "scale about the plate∩art contact centroid to preserve the PS seat"
//      trick and its "no overlap → skip" failure mode (that case is now seated, not skipped).
//   3. RE-UNITE — re-derive the fused cutline (Unite outline+plate) so one contour
//      encloses the spec caption. The element OUTLINE is left at the artist's scale — a
//      smaller sticker SHOULD have a smaller cut; only the caption/plate are spec-locked.
//
// ⚠ This RE-DERIVES the cutline (re-Unite of outline+plate). Run it during the nest
// loop, BEFORE manual pencil refinements to the fused cutline.
//
// Style + spec pill height come from group.note ("styleCode|lines|h<pt>", buildCaption).
// Missing note / non-WC-GC style / missing member / no spec height → skip + warn.
//
// Returns: { reset, atSpec, skipped }
//   reset   = captions that were off-spec and brought back
//   atSpec  = captions already at spec (no-op — the idempotent case)
//   skipped = no note / no plate / no caption / no outline

function runCaptionNormalise(doc) {

    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        log("[step8b] ERROR | Cutlines layer not found: " + CONFIG.cutlinesLayerName);
        return { reset: 0, atSpec: 0, skipped: 0 };
    }

    // Snapshot top-level GroupItems — re-Unite replaces a member mid-loop.
    var groups = [], i;
    for (i = 0; i < cutlinesLayer.groupItems.length; i++) {
        if (cutlinesLayer.groupItems[i].parent === cutlinesLayer) {
            groups.push(cutlinesLayer.groupItems[i]);
        }
    }

    var reset = 0, atSpec = 0, skipped = 0;

    for (i = 0; i < groups.length; i++) {
        var group  = groups[i];
        var parsed = _capNoteParse(group.note);

        if (!parsed.styleCode) {
            log("[step8b] SKIP | no caption metadata (note) | " + group.name);
            skipped++;
            continue;
        }
        if (parsed.styleCode !== "WC" && parsed.styleCode !== "GC") {
            log("[step8b] SKIP | " + group.name + " — not a caption (" + parsed.styleCode + ").");
            skipped++;
            continue;
        }

        // Native caption members live INSIDE the cut group (not a Stickers PNG): the visible
        // white pill (" plate"), the printed text (" caption text"), and the GC decorative
        // raster (" caption plate", optional).
        var outline = findGroupMember(group, " outline");
        var pill    = findGroupMember(group, " plate");
        var text    = findGroupMember(group, " caption text");
        var plateR  = findGroupMember(group, " caption plate");
        if (!outline || !pill || !text) {
            log("[step8b] SKIP | " + group.name + " — missing member (outline/pill/text).");
            skipped++;
            continue;
        }
        if (parsed.pillArea == null) {
            log("[step8b] SKIP | " + group.name + " — note has no spec pill area (rebuild via Pipeline 2).");
            skipped++;
            continue;
        }

        // Scale reference = SPEC pill area (stamped in the note by buildCaption) vs the current
        // pill area. AREA is rotation-invariant, so the seat's tilt doesn't corrupt it (a
        // bounding-box height would drift with tilt and never settle). unscale = sqrt(ratio)
        // because area scales as the square of the linear (uniform) nest scale.
        var curArea = 0;
        try { curArea = Math.abs(pill.area); } catch (eA) {}
        if (curArea <= 0) {
            log("[step8b] SKIP | " + group.name + " — degenerate pill area.");
            skipped++;
            continue;
        }
        var unscale = Math.sqrt(parsed.pillArea / curArea);

        if (Math.abs(unscale - 1.0) < 0.005) {       // already at spec — idempotent no-op
            log("[step8b] at spec | " + group.name + " (" + parsed.styleCode + ")");
            atSpec++;
            continue;
        }

        if (CONFIG.dryRun) {
            log("[step8b] [DRY RUN] would reset to spec (x" + unscale.toFixed(3) + ") | "
                + group.name + " (" + parsed.styleCode + ")");
            continue;
        }

        // SIZE first: scale the caption members back to spec about the PILL CENTRE. A common
        // pivot under a uniform scale preserves the text↔pill↔plate arrangement; placement is
        // fixed up next.
        var pivot = boundsCenter(pill.geometricBounds);
        _scaleAboutPoint(pill,  unscale, pivot);
        _scaleAboutPoint(text,  unscale, pivot);
        if (plateR) _scaleAboutPoint(plateR, unscale, pivot);

        // PLACEMENT next: re-seat the spec pill + ride-along printed items against the TRACED
        // outline (the cut's own vector), so the overlap that survives the Unite is set here.
        // The text (+ GC plate raster) must ride the seat's rotate+translate — group them so
        // seatPlateToOutline moves them rigidly with the pill, then un-nest back into the group.
        var rideItem = text;
        var rideGroup = null;
        if (plateR) {
            rideGroup = group.groupItems.add();
            text.move(rideGroup, ElementPlacement.PLACEATEND);
            plateR.move(rideGroup, ElementPlacement.PLACEATEND);
            rideItem = rideGroup;
        }
        var polyCache = {};
        var seat = seatPlateToOutline(group.name, outline, pill, rideItem, { polyCache: polyCache });
        if (rideGroup) {
            text.move(group, ElementPlacement.PLACEATBEGINNING);
            plateR.move(group, ElementPlacement.PLACEATBEGINNING);
            try { rideGroup.remove(); } catch (eRG) {}
        }
        if (!seat.ok) {
            log("[step8b] seat | " + group.name + " NOT seated (" + seat.reason
                + ") — re-Unite + half-cut will surface it.");
        }
        // The AI seat is authoritative here; carry its review flag onto the cutline note so
        // Step 8c / AI_LayoutQA badges it.
        if (seat.needsReview && group.note && String(group.note).indexOf("|R") < 0) {
            group.note = group.note + "|R";
        }

        // Re-derive the fused cutline from the seated spec pill + (artist-scaled) outline.
        reuniteCutline(group, outline, pill, CONFIG.cutlineStrokePt);

        // Re-sync the half-cut to the rescaled seam (idempotent). Only the reset path
        // reaches here — atSpec groups 'continue' above, so no redundant work. syncHalfcut
        // clears the prior tab before re-deriving, so surface a failed re-sync (no peel tab)
        // instead of dropping it — AI_ExportFinal will hard-error on it later regardless.
        var hcRes = syncHalfcut(doc, group, { polyCache: polyCache });
        if (!hcRes.ok) log("[step8b] half-cut SKIP | " + group.name + " — " + hcRes.reason);

        // Refresh the spacing-buffer halo — the re-Unite above reshaped the cutline, so a
        // halo cloned from the old cutline is now stale. Idempotent (clears its own prior).
        var sbRes = syncSpacingBuffer(doc, group, {});
        if (!sbRes.ok) log("[step8b] spacing-buffer SKIP | " + group.name + " — " + sbRes.reason);

        log("[step8b] reset to spec | " + group.name + " (" + parsed.styleCode
            + ", x" + unscale.toFixed(3) + ")");
        reset++;
    }

    log("[step8b] done | reset=" + reset + " atSpec=" + atSpec + " skipped=" + skipped);
    return { reset: reset, atSpec: atSpec, skipped: skipped };
}

// The placed caption PNG named "{displayName} caption" on the Stickers layer (Step 7B).
function _findCaption(stickersLayer, displayName) {
    var want = displayName + " caption";
    for (var i = 0; i < stickersLayer.placedItems.length; i++) {
        if (stickersLayer.placedItems[i].name === want) return stickersLayer.placedItems[i];
    }
    return null;
}

// Scale magnitude of a placed item relative to its native pixels — rotation-invariant
// (sqrt(a²+b²) of the placement matrix). A freshly-placed PNG is 1.0; Step 7B resized
// it to specFactor, the artist scaled it further.
function _matrixScale(placedItem) {
    var m = placedItem.matrix;
    return Math.sqrt(m.mValueA * m.mValueA + m.mValueB * m.mValueB);
}

// Uniform-scale a page item by `factor` about an arbitrary document-space point P.
// factor 1.0 → no-op. Builds the scale-about-P affine and applies it in document
// coordinates so plate (path) and caption (placed) transform identically about P.
function _scaleAboutPoint(item, factor, P) {
    if (Math.abs(factor - 1.0) < 1e-4) return;
    var m = app.getScaleMatrix(factor * 100, factor * 100);   // a=d=factor, tx=ty=0
    m.mValueTX = P.x * (1 - factor);
    m.mValueTY = P.y * (1 - factor);
    item.transform(m,
        true,   // changePositions
        true,   // changeFillPatterns
        true,   // changeFillGradients
        true,   // changeStrokePattern
        1,      // changeLineWidths (%) — keep stroke weight (re-Unite re-strokes anyway)
        Transformation.DOCUMENTORIGIN);
}
