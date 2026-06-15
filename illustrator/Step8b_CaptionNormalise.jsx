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
// Per captioned group (matched by name; survives the artist's moves/rotations):
//   unscale = (72 / sourceDPI) / caption-matrix-scale     // undo the artist's scaling
//   1. RESIZE — scale BOTH the plate and the caption PNG to absolute spec about the plate
//      CENTRE (a common pivot under uniform scale keeps them aligned; placement is fixed
//      up next). Works for GC pills and WC curved capsules alike.
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
// Style comes from group.note ("styleCode|lines", Step 6). Missing note → skip + warn.
// ST/uncaptioned (no plate) skip. Missing caption PNG (the scale reference) → skip.
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

    var stickersLayer = findLayer(doc, CONFIG.stickersLayerName);
    if (!stickersLayer) {
        log("[step8b] ERROR | Stickers layer not found: " + CONFIG.stickersLayerName
            + " — caption PNGs carry the spec scale reference; cannot normalise.");
        return { reset: 0, atSpec: 0, skipped: 0 };
    }

    var specFactor = 72.0 / CONFIG.sourceDPI;       // a caption at spec sits at this matrix-scale

    // Snapshot top-level GroupItems — re-Unite replaces a member mid-loop.
    var groups = [], i;
    for (i = 0; i < cutlinesLayer.groupItems.length; i++) {
        if (cutlinesLayer.groupItems[i].parent === cutlinesLayer) {
            groups.push(cutlinesLayer.groupItems[i]);
        }
    }

    var reset = 0, atSpec = 0, skipped = 0;

    for (i = 0; i < groups.length; i++) {
        var group = groups[i];
        var note  = group.note;

        if (!note) {
            log("[step8b] SKIP | no caption metadata (note) | " + group.name);
            skipped++;
            continue;
        }
        var styleCode = note.split("|")[0];

        var plate   = findGroupMember(group, " plate");
        var outline = findGroupMember(group, " outline");
        var caption = _findCaption(stickersLayer, group.name);

        if (!plate) {
            log("[step8b] SKIP | " + group.name + " — no caption plate (ST/uncaptioned).");
            skipped++;
            continue;
        }
        if (!outline) {
            log("[step8b] SKIP | " + group.name + " — missing outline component (no art to seat against).");
            skipped++;
            continue;
        }
        if (!caption) {
            log("[step8b] SKIP | " + group.name + " — caption PNG not found on Stickers layer.");
            skipped++;
            continue;
        }

        var curScale = _matrixScale(caption);
        if (curScale <= 0) {
            log("[step8b] SKIP | " + group.name + " — degenerate caption scale.");
            skipped++;
            continue;
        }
        var unscale = specFactor / curScale;

        if (Math.abs(unscale - 1.0) < 0.005) {       // already at spec — idempotent no-op
            log("[step8b] at spec | " + group.name + " (" + styleCode + ")");
            atSpec++;
            continue;
        }

        if (CONFIG.dryRun) {
            log("[step8b] [DRY RUN] would reset to spec (x" + unscale.toFixed(3) + ") | "
                + group.name + " (" + styleCode + ")");
            continue;
        }

        // SIZE first: scale plate + caption back to absolute spec about the plate CENTRE
        // (always defined, no contact-centroid needed). A common pivot under a uniform
        // scale preserves the plate↔caption arrangement; placement is fixed up next.
        // GC and WC alike: a canonical-height GC plate scaled by unscale lands back at its
        // canonical height under Model B, so no GC-specific absolute-height reset is needed.
        var pivot = boundsCenter(plate.geometricBounds);
        _scaleAboutPoint(plate,   unscale, pivot);
        _scaleAboutPoint(caption, unscale, pivot);

        // PLACEMENT next: re-seat the spec plate + caption against the TRACED outline (the
        // same vector that becomes the cut). This replaces the old "scale about the plate∩art
        // contact to preserve the PS seat" trick (and its no-overlap skip): the seat — overlap
        // depth + tilt — is now re-established here, in the cut's own space, so resize and
        // seating are decoupled. See aiUtils.seatPlateToOutline / docs/caption-seating-redesign.md.
        var seat = seatPlateToOutline(group.name, outline, plate, caption, {});
        if (!seat.ok) {
            log("[step8b] seat | " + group.name + " NOT seated (" + seat.reason
                + ") — re-Unite + half-cut will surface it.");
        }

        // Re-derive the fused cutline from the seated spec plate + (artist-scaled) outline.
        reuniteCutline(group, outline, plate, CONFIG.cutlineStrokePt);

        // Re-sync the half-cut to the rescaled seam (idempotent). Only the reset path
        // reaches here — atSpec groups 'continue' above, so no redundant work.
        syncHalfcut(doc, group, {});

        log("[step8b] reset to spec | " + group.name + " (" + styleCode
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
