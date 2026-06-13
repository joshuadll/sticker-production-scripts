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
//   1. RESIZE — scale BOTH the plate and the caption PNG to absolute spec (about the
//      plate centre, so they stay aligned). Works for GC pills and WC curved capsules
//      alike — uniform scale preserves shape and orientation.
//   2. SEAT (shape-aware) — re-seat the spec caption against the ART SILHOUETTE so it
//      touches with a small overlap, like the PSD snapCaptionToBorder. NOT the bbox: the
//      art is irregular, so directly over the caption the real surface can sit far below
//      the bbox edge — bbox seating leaves the caption floating and the Unite disjoint
//      (two cutlines). Along the art→caption axis, push the caption/plate clear of the
//      art, measure the TRUE gap to the silhouette, then pull back to overlap by exactly
//      captionOverlapPt. A bigger sticker's caption is drawn IN to the real edge, a
//      smaller one's is pushed OUT — both end snug. (Push-then-measure lets one move
//      handle floating AND buried: minPolygonSetDistance can't read penetration depth,
//      but the gap after a clearing push encodes it.)
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

        // Fix the SIZE while PRESERVING the seating Photoshop already designed
        // (snapCaptionToBorder seated the caption against the art border; Step 6 built the
        // plate there; Model B's uniform scale kept that seating — only the size is off).
        // Scale plate + caption about the plate∩art CONTACT, so the contact point stays
        // fixed while the caption returns to absolute spec: the overlap depth and the
        // caption's angle against the art are preserved exactly (they just rescale to
        // spec), and the caption grows/shrinks AWAY from the art. This reconstructs the
        // spec seating from the real contact — robust to irregular / multi-island art,
        // with none of the floating / one-leg / too-deep failure modes of a re-seat.
        // GC and WC alike: a canonical-height GC plate scaled by unscale lands back at its
        // canonical height under Model B, so no GC-specific absolute-height reset is needed.
        var pivot = _overlapCentroid(plate, outline, CONFIG.seatSampleSteps);
        if (!pivot) {
            // No real contact to preserve — the caption isn't overlapping its art (dragged
            // off during nesting, or a degenerate trace). Scaling about a guessed pivot
            // would silently mis-seat / fling the caption, so skip + warn instead.
            log("[step8b] SKIP | " + group.name + " — caption does not overlap its art; cannot preserve seating.");
            skipped++;
            continue;
        }
        _scaleAboutPoint(plate,   unscale, pivot);
        _scaleAboutPoint(caption, unscale, pivot);

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

// Centroid of the plate∩outline overlap region — the real contact between the caption
// pill and the art. Grid-samples the overlap, keeping points inside BOTH shapes (even-odd,
// so outline holes count as outside). This is the pivot the spec rescale turns about, so
// the contact (overlap depth + angle) is preserved. Returns {x,y}, or NULL when the two do
// not actually overlap (caller must skip — there is no contact to preserve).
function _overlapCentroid(plate, outline, steps) {
    var platePolys = samplePathToPolygons(plate,   steps);
    var outPolys   = samplePathToPolygons(outline, steps);

    // Grid only over the plate∩outline bounding-box intersection — the contact is a thin
    // band near one plate edge, so gridding the whole plate wastes ~all points on misses.
    var pb = plate.geometricBounds, ob = outline.geometricBounds;   // [left, top, right, bottom]
    var left = Math.max(pb[0], ob[0]), right  = Math.min(pb[2], ob[2]);
    var top  = Math.min(pb[1], ob[1]), bottom = Math.max(pb[3], ob[3]);
    if (left < right && bottom < top) {
        var n = 24, i, j, sx = 0, sy = 0, cnt = 0;
        for (i = 0; i <= n; i++) {
            var x = left + (right - left) * i / n;
            for (j = 0; j <= n; j++) {
                var y = bottom + (top - bottom) * j / n;
                if (_pointInPolysEvenOdd(x, y, platePolys)
                 && _pointInPolysEvenOdd(x, y, outPolys)) { sx += x; sy += y; cnt++; }
            }
        }
        if (cnt > 0) return { x: sx / cnt, y: sy / cnt };
    }

    // No grid hit. A genuine (if thin) overlap still has a valid contact — use the
    // nearest-approach witness midpoint. But a real GAP means the caption isn't on its art,
    // so return null and let the caller skip rather than seat about a meaningless point.
    if (!polygonsOverlap(platePolys, outPolys)) return null;
    var w = minPolygonSetDistanceEx(platePolys, outPolys);
    return { x: (w.ax + w.bx) / 2, y: (w.ay + w.by) / 2 };
}

// Even-odd point-in-polygons test across a sampled path's subpaths (so holes subtract).
function _pointInPolysEvenOdd(x, y, polys) {
    var inside = false, p = { x: x, y: y }, i;
    for (i = 0; i < polys.length; i++) {
        if (pointInPolygon(p, polys[i])) inside = !inside;
    }
    return inside;
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
