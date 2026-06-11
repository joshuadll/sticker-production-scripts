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
        var pivot = _overlapCentroid(plate, outline, CONFIG.seatSampleSteps);
        if (!pivot) pivot = boundsCenter(plate.geometricBounds);   // fallback: no overlap found
        _scaleAboutPoint(plate,   unscale, pivot);
        _scaleAboutPoint(caption, unscale, pivot);

        // Optional flush ROTATION: a straight pill edge on a slanted art edge sits deeper
        // on one side. Rotate the pill (clamped) about the contact so its art-facing edge
        // lies parallel to the art's local slope → both sides equally seated. Pivot stays
        // in the overlap, so it can't float. The clamp bounds the tilt (it also rotates
        // the caption text / overrides WC's PS angle); 0 = no rotation.
        if (CONFIG.captionSeatMaxRotateDeg > 0) {
            var deg = _flushAngle(plate, outline, pivot, CONFIG.seatSampleSteps);
            if (deg >  CONFIG.captionSeatMaxRotateDeg) deg =  CONFIG.captionSeatMaxRotateDeg;
            if (deg < -CONFIG.captionSeatMaxRotateDeg) deg = -CONFIG.captionSeatMaxRotateDeg;
            if (Math.abs(deg) > 0.5) {
                _rotateAboutPoint(plate,   deg, pivot);
                _rotateAboutPoint(caption, deg, pivot);
            }
        }

        // Re-derive the fused cutline from the seated spec plate + (artist-scaled) outline.
        reuniteCutline(group, outline, plate, CONFIG.cutlineStrokePt);

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
// pill and the art. Grid-samples the plate's bounds, keeping points inside BOTH shapes
// (even-odd, so outline holes count as outside). This is the pivot the spec rescale turns
// about, so the contact (overlap depth + angle) is preserved. Returns {x,y} or null when
// the two don't overlap (degenerate — caller falls back to the plate centre).
function _overlapCentroid(plate, outline, steps) {
    var platePolys = samplePathToPolygons(plate,   steps);
    var outPolys   = samplePathToPolygons(outline, steps);
    var b = plate.geometricBounds;                       // [left, top, right, bottom]
    var n = 24, i, j, sx = 0, sy = 0, cnt = 0;
    for (i = 0; i <= n; i++) {
        var x = b[0] + (b[2] - b[0]) * i / n;
        for (j = 0; j <= n; j++) {
            var y = b[3] + (b[1] - b[3]) * j / n;
            if (_pointInPolysEvenOdd(x, y, platePolys)
             && _pointInPolysEvenOdd(x, y, outPolys)) { sx += x; sy += y; cnt++; }
        }
    }
    if (cnt > 0) return { x: sx / cnt, y: sy / cnt };

    // Grid missed a thin overlap (small element). Fall back to the nearest-approach
    // witness between plate and outline — a contact point regardless of overlap size.
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

// Degrees to rotate the pill so its art-facing edge lies parallel to the art's local
// slope — equalising the overlap depth across the caption width (vs deeper-on-one-side).
// Compares the pill's two shoulders (near-edge endpoints) against the nearest art point
// under each. Returns 0 when it can't be determined (caller then skips rotating).
function _flushAngle(plate, outline, pivot, steps) {
    var cc = boundsCenter(plate.geometricBounds);
    var ax = cc.x - pivot.x, ay = cc.y - pivot.y;
    var L  = Math.sqrt(ax * ax + ay * ay);
    if (L <= 0.001) return 0;
    var ux = ax / L, uy = ay / L;                        // outward (art → caption)

    var sh = _artFacingShoulders(samplePathToPolygons(plate, steps), cc.x, cc.y, ux, uy);
    if (!sh) return 0;
    var outPolys = samplePathToPolygons(outline, steps);
    var CL = _nearestPolyPoint(outPolys, sh.left.x,  sh.left.y);
    var CR = _nearestPolyPoint(outPolys, sh.right.x, sh.right.y);
    if (!CL || !CR) return 0;

    var aPill = Math.atan2(sh.right.y - sh.left.y, sh.right.x - sh.left.x);
    var aArt  = Math.atan2(CR.y - CL.y, CR.x - CL.x);
    var d = (aArt - aPill) * 180 / Math.PI;
    while (d >  180) d -= 360;
    while (d < -180) d += 360;
    return d;
}

// The two "shoulders" of the pill's art-facing edge — endpoints of its near edge. Of all
// sampled plate points, take the band nearest the art (within 15% of the deepest inward
// reach along axis u=(ux,uy) outward), then its lateral extremes. {left,right} or null.
function _artFacingShoulders(platePolys, pcx, pcy, ux, uy) {
    var perpx = -uy, perpy = ux;
    var pts = [], i, k;
    var maxDepth = -Infinity, minDepth = Infinity;
    for (i = 0; i < platePolys.length; i++) {
        var poly = platePolys[i];
        for (k = 0; k < poly.length; k++) {
            var dxp = poly[k].x - pcx, dyp = poly[k].y - pcy;
            var depth = -(dxp * ux + dyp * uy);          // toward the art = positive
            var lat   =  dxp * perpx + dyp * perpy;
            pts.push({ x: poly[k].x, y: poly[k].y, depth: depth, lat: lat });
            if (depth > maxDepth) maxDepth = depth;
            if (depth < minDepth) minDepth = depth;
        }
    }
    if (pts.length < 3 || maxDepth <= minDepth) return null;
    var tol = (maxDepth - minDepth) * 0.15;
    var left = null, right = null;
    for (i = 0; i < pts.length; i++) {
        if (pts[i].depth < maxDepth - tol) continue;
        if (!left  || pts[i].lat < left.lat)  left  = pts[i];
        if (!right || pts[i].lat > right.lat) right = pts[i];
    }
    if (!left || !right) return null;
    return { left: { x: left.x, y: left.y }, right: { x: right.x, y: right.y } };
}

// Nearest sampled silhouette vertex to (x,y).
function _nearestPolyPoint(polys, x, y) {
    var best = null, bd = Infinity, i, k;
    for (i = 0; i < polys.length; i++) {
        for (k = 0; k < polys[i].length; k++) {
            var dx = polys[i][k].x - x, dy = polys[i][k].y - y, d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = polys[i][k]; }
        }
    }
    return best;
}

// Rotate a page item by `deg` about a document-space point P. Preserves matrix scale, so
// spec-detection (matrix magnitude) is unaffected.
function _rotateAboutPoint(item, deg, P) {
    var m = app.getRotationMatrix(deg);
    m.mValueTX = P.x - (m.mValueA * P.x + m.mValueC * P.y);
    m.mValueTY = P.y - (m.mValueB * P.x + m.mValueD * P.y);
    item.transform(m, true, true, true, true, 1, Transformation.DOCUMENTORIGIN);
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
