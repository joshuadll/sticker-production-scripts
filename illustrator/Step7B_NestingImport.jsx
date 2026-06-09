// Step7B_NestingImport.jsx — Phase function only.
// #included by AI_ImportNesting.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Opens each Deepnest output SVG, reads each nested part's position + rotation,
// then fully repositions the matching cutline GroupItem in the working file —
// applying both rotation and translation so it lands on the Deepnest layout.
// Each cutline's artwork PNG is placed on it and bound as a rigid {cut, art} pair
// (same matrices applied to both), then both groups are laid out (see below).
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
// Rotation: a coarse angle from the centroid→FARTHEST-anchor feature vector of the
// matched pair (baked geometry, same coordinate space), then a ±8° bbox-match REFINE.
// Applied via a rotation-about-pivot matrix (DOCUMENTORIGIN), not rotate(). See
// _nestComputeRotation / _nestRefineRotation.
//
// Group layout (after per-element placement):
//   Regular SVG  → group-rotated -90°, snapped to the MARGIN top-left corner.
//   Irregular SVG → rotated to the angle (0–350°, step 10°) that minimises the
//                   bounding-box area outside the MARGIN, then placed directly
//                   below the regular group with a 2 mm gap.
//   SVG identity is inferred from the filename (_regular_nested / _irregular_nested).
//   If names don't match, the first file is treated as regular, the second as irregular.
//
// Returns: { matched, unmatched, artPlaced }
//
// elementsData (required; AI_ImportNesting halts if the sidecar is missing): the parsed
// {name}_elements.json sidecar (only psdWidth is used here). Artwork is sized by the
// ABSOLUTE PSD→AI factor — 72 / sourceDPI pt per px — the same scale
// Step 6 used to place the silhouette. The cutline and the art are twins from the same PSD
// at the same pixel scale, so the art's true size is a single known constant (factor),
// applied uniformly: a 72-dpi element PNG is element_px points wide, so resizing by
// factor×100 lands it at element_px×factor with no per-element math.

function runNestingImport(doc, svgFiles, artFolder, elementsData) {

    // ── 1. Find layers ────────────────────────────────────────────────────────────
    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        log("[step-nest] ERROR | Cutlines layer not found.");
        return null;
    }

    // The one number art sizing needs. The pipeline guarantees a valid sidecar (it
    // halts otherwise), so this is always > 0.
    var artFactor = _nestArtFactor(elementsData);
    log("[step-nest] art sizing: factor=" + artFactor.toFixed(5)
        + " pt/px (psdWidth=" + elementsData.psdWidth
        + ", sourceDPI=" + CONFIG.sourceDPI + ")");

    var stickersLayer = findLayer(doc, CONFIG.stickersLayerName);
    if (!stickersLayer) {
        log("[step-nest] WARN | Stickers layer not found — artwork will not be placed.");
    }

    // Re-run safety: clear any previously placed artwork so it doesn't stack.
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

    // ── 3. Identify regular vs irregular SVG by filename ─────────────────────────
    var regularSvg = null, irregularSvg = null;
    var f;
    for (f = 0; f < svgFiles.length; f++) {
        if (/_regular_nested\.svg$/i.test(svgFiles[f].name))   regularSvg   = svgFiles[f];
        else if (/_irregular_nested\.svg$/i.test(svgFiles[f].name)) irregularSvg = svgFiles[f];
    }
    // Fallback for non-standard names: first file = regular, second = irregular.
    if (!regularSvg && !irregularSvg) {
        if (svgFiles.length >= 1) regularSvg   = svgFiles[0];
        if (svgFiles.length >= 2) irregularSvg = svgFiles[1];
    }

    // Nesting is laid out within the MARGIN (printable safe area), not the full
    // artboard: stickers may touch the margin line but must not cross it. marginR
    // is the same inner rectangle the margin band and Steps 8c/QA use.
    var marginR  = marginRect(doc);

    var totalMatched = 0, totalUnmatched = 0, totalArtPlaced = 0;
    var regularBottomY = marginR[1]; // fallback: margin top (used when no regular group)
    var regularCuts   = null;        // regular cutlines, kept for contour-fit of the irregular group

    // Each element is processed as a rigid {cut, art} PAIR: the artwork is placed on
    // the still-upright cutline (exact: centre + scale, no rotation) and then every
    // transform — per-element nest pose AND the group-level moves below — is applied
    // identically to both members. The art can never drift from its cutline because
    // they undergo the same matrix. (Precondition: cutlines are upright, i.e. a fresh
    // post-Step-6 file; re-run on an already-nested doc by re-opening that file.)

    // ── 4. Process regular SVG ────────────────────────────────────────────────────
    if (regularSvg) {
        log("[step-nest] --- processing regular SVG: " + regularSvg.name + " ---");
        var regResult = _nestProcessSingleSvg(doc, regularSvg, cutlineMap, stickersLayer, artFolder, artFactor);
        totalMatched   += regResult.matched;
        totalUnmatched += regResult.unmatched;
        totalArtPlaced += regResult.artPlaced;

        if (regResult.pairs.length > 0 && !CONFIG.dryRun) {
            // Rotate the regular cluster -90° and snap its top-left to the margin corner.
            var regBounds  = _nestPlaceGroup(regResult.pairs, -90, marginR[0], marginR[1], true);
            regularBottomY = regBounds[3];
            regularCuts    = _nestCutsOf(regResult.pairs);
            log("[step-nest] regular group placed | bottom y=" + Math.round(regularBottomY));
        } else if (regResult.pairs.length > 0) {
            log("[step-nest] [DRY RUN] would rotate regular -90° and snap to margin top-left.");
        }
    }

    // ── 5. Process irregular SVG ──────────────────────────────────────────────────
    if (irregularSvg) {
        log("[step-nest] --- processing irregular SVG: " + irregularSvg.name + " ---");
        var irrResult = _nestProcessSingleSvg(doc, irregularSvg, cutlineMap, stickersLayer, artFolder, artFactor);
        totalMatched   += irrResult.matched;
        totalUnmatched += irrResult.unmatched;
        totalArtPlaced += irrResult.artPlaced;

        if (irrResult.pairs.length > 0 && !CONFIG.dryRun) {
            // regularBottomY keeps its default (artboard top) when no regular group was
            // placed. If a regular SVG WAS supplied but produced no group (0 matched, or a
            // failed open), the irregular group lands at the top, overlapping the upright
            // regular cutlines — warn so it isn't mistaken for a layout bug.
            if (regularSvg && regularBottomY === marginR[1]) {
                log("[step-nest] WARN | regular SVG present but no regular group placed "
                    + "(0 matched / open failed?) — irregular goes to the margin top.");
            }
            var targetTop = regularBottomY - mmToPoints(2);

            // Best rotation (0–350°, step 10°) that minimises area outside the margin,
            // then snap the cluster's left to the margin left and its top to targetTop.
            var bestAngle = _nestBestRotation(_nestCutsOf(irrResult.pairs), marginR, targetTop);
            _nestPlaceGroup(irrResult.pairs, bestAngle, marginR[0], targetTop, false);

            log("[step-nest] irregular group placed | rotation=" + bestAngle
                + "° | top y=" + Math.round(targetTop));

            // targetTop snaps the irregular BBOX 2mm below the regular BBOX bottom — but
            // the two clusters' facing contours rarely line up in x, so that bbox gap can
            // hide a large real gap (regular's lowest point sits over empty x). Slide the
            // irregular cluster straight UP into the regular cluster's bottom contour until
            // the real minimum clearance is the 2mm spacing, closing the dead band.
            if (regularCuts && regularCuts.length > 0) {
                var upShift = _nestMaxUpwardShift(regularCuts, _nestCutsOf(irrResult.pairs), mmToPoints(2));
                if (upShift > 0) {
                    _nestTranslatePairs(irrResult.pairs, 0, upShift);
                    log("[step-nest] irregular contour-fit | nested up " + Math.round(upShift)
                        + "pt to close the gap to 2mm.");
                } else {
                    log("[step-nest] irregular contour-fit | no upward room (gap already minimal).");
                }
            }
        } else if (irrResult.pairs.length > 0) {
            log("[step-nest] [DRY RUN] would find best rotation and place irregular below regular.");
        }
    }

    // ── 6. Summary ───────────────────────────────────────────────────────────────
    // Verify art actually landed on the Stickers layer (not Cutlines): doc.placedItems
    // .add() ignores the active layer after the cutline passes, so a regression here is
    // silent unless asserted. The test gates on this line.
    var artOnStickers = stickersLayer ? stickersLayer.placedItems.length : 0;
    log("[step-nest] art-layer-check | on Stickers: " + artOnStickers
        + " / placed: " + totalArtPlaced
        + (artOnStickers === totalArtPlaced ? "  ok" : "  *** ART ON WRONG LAYER ***"));

    log("[step-nest] result | matched: " + totalMatched
        + " | unmatched: " + totalUnmatched
        + " | art placed: " + totalArtPlaced);

    return { matched: totalMatched, unmatched: totalUnmatched, artPlaced: totalArtPlaced };
}


// ── Per-SVG processing ─────────────────────────────────────────────────────────

// Opens one SVG, collects parts, assigns to cutlines, places the artwork on each
// still-upright cutline, then moves each {cut, art} pair to its nest pose as a rigid
// unit. Removes matched entries from cutlineMap so subsequent SVGs can't double-assign.
// Returns { matched, unmatched, pairs, artPlaced }.
function _nestProcessSingleSvg(doc, svgFile, cutlineMap, stickersLayer, artFolder, artFactor) {
    var parts = _nestCollectFromSvgs(doc, [svgFile]);
    log("[step-nest] found " + parts.length + " nested part(s) in " + svgFile.name);

    if (parts.length === 0) {
        log("[step-nest] WARN | no parts found in " + svgFile.name);
        return { matched: 0, unmatched: 0, pairs: [], artPlaced: 0 };
    }

    var assignments = _nestAssignByArea(parts, cutlineMap);

    var matched = 0, artPlaced = 0, pairs = [];
    var assignedPart = {};
    var a, svgItem, cutlineItem, rotation, artItem;

    for (a = 0; a < assignments.length; a++) {
        svgItem     = assignments[a].part;
        cutlineItem = assignments[a].cutlineItem;
        assignedPart[assignments[a].partIndex] = true;

        rotation = _nestComputeRotation(svgItem, cutlineItem);

        // Bind artwork to the cutline WHILE IT IS STILL UPRIGHT — centre + scale only,
        // no rotation, so the alignment is exact (no angle to get wrong). The pair is
        // then moved to the nest pose together by _nestApplyPairTransform.
        artItem = null;
        if (stickersLayer && artFolder) {
            artItem = _nestPlaceArtUpright(doc, stickersLayer, artFolder, cutlineItem, artFactor);
            if (artItem) artPlaced++;
        }

        _nestApplyPairTransform(cutlineItem, artItem, rotation, svgItem.center);

        // ── Objective correctness check ──────────────────────────────────────────
        // The cutline and the SVG part are the SAME polygon (Deepnest only rotated +
        // translated it). So after placement the cutline's bounding box dimensions
        // MUST match the SVG part's. A mismatch proves the rotation is wrong — this
        // is a hard check, not an eyeball. Logged as VERIFY so the test can assert it.
        // (Skipped under dryRun: the transform above is a no-op, so the check is moot.)
        if (!CONFIG.dryRun) {
            var cgb2 = cutlineItem.geometricBounds;
            var dW   = Math.abs(Math.abs(cgb2[2] - cgb2[0]) - Math.abs(svgItem.bounds[2] - svgItem.bounds[0]));
            var dH   = Math.abs(Math.abs(cgb2[1] - cgb2[3]) - Math.abs(svgItem.bounds[1] - svgItem.bounds[3]));
            var bad  = (dW > 5 || dH > 5);
            log("[step-nest] VERIFY | " + cutlineItem.name
                + " rot=" + Math.round(rotation)
                + " bboxΔ=(" + Math.round(dW) + "," + Math.round(dH) + ")"
                + (bad ? "  *** ROTATION WRONG ***" : "  ok"));
        }

        pairs.push({ cut: cutlineItem, art: artItem });
        // Remove from the shared map so the next SVG's pass can't reassign this cutline.
        delete cutlineMap[cutlineItem.name];

        matched++;
    }

    var unmatched = 0;
    for (a = 0; a < parts.length; a++) {
        if (assignedPart[a]) continue;
        unmatched++;
        log("[step-nest] WARN unmatched part | area=" + Math.round(parts[a].area)
            + " at (" + Math.round(parts[a].center.x) + ", "
            + Math.round(parts[a].center.y) + ")");
    }

    return { matched: matched, unmatched: unmatched, pairs: pairs, artPlaced: artPlaced };
}


// ── Group-level transform helpers ──────────────────────────────────────────────

// Combined axis-aligned bounds [left, top, right, bottom] of an array of page items.
// In Illustrator coords: top > bottom (y increases upward).
function _nestCombinedBounds(items) {
    var left = Infinity, top = -Infinity, right = -Infinity, bottom = Infinity;
    var i, gb;
    for (i = 0; i < items.length; i++) {
        gb = items[i].geometricBounds;
        if (gb[0] < left)   left   = gb[0];
        if (gb[1] > top)    top    = gb[1];
        if (gb[2] > right)  right  = gb[2];
        if (gb[3] < bottom) bottom = gb[3];
    }
    return [left, top, right, bottom];
}

// The cutline members of an array of {cut, art} pairs (for bounds/layout math).
function _nestCutsOf(pairs) {
    var r = [], i;
    for (i = 0; i < pairs.length; i++) r.push(pairs[i].cut);
    return r;
}

// Lays a group of {cut, art} pairs into the artboard: rotates the whole cluster about its
// shared centroid by angleDeg, then snaps the cluster's bbox top-left to (targetLeft,
// targetTop). Bounds are re-read after each move (cheap vs a stale-bounds bug). Returns
// the final combined bounds [l,t,r,b]. assertTranspose (the ±90° regular case) runs the
// group-rot-check gate: a correct 90° rotation MUST transpose the bbox (W↔H); if it
// doesn't, the elements spun about their own centres instead of orbiting the pivot.
function _nestPlaceGroup(pairs, angleDeg, targetLeft, targetTop, assertTranspose) {
    var bounds = _nestCombinedBounds(_nestCutsOf(pairs));
    var cx = (bounds[0] + bounds[2]) / 2;
    var cy = (bounds[1] + bounds[3]) / 2;
    var preW = bounds[2] - bounds[0], preH = bounds[1] - bounds[3];

    _nestRotatePairs(pairs, angleDeg, cx, cy);

    bounds = _nestCombinedBounds(_nestCutsOf(pairs));
    if (assertTranspose) {
        var postW = bounds[2] - bounds[0], postH = bounds[1] - bounds[3];
        var ok = (Math.abs(postW - preH) < 5 && Math.abs(postH - preW) < 5);
        log("[step-nest] group-rot-check | pre " + Math.round(preW) + "x" + Math.round(preH)
            + " -> post " + Math.round(postW) + "x" + Math.round(postH)
            + (ok ? "  ok" : "  *** GROUP ROTATION DID NOT TRANSPOSE ***"));
    }

    _nestTranslatePairs(pairs, targetLeft - bounds[0], targetTop - bounds[1]);

    return _nestCombinedBounds(_nestCutsOf(pairs));
}

// Rotation-about-pivot matrix M = T(-p)·R·T(p). Apply it with .transform(m, …,
// Transformation.DOCUMENTORIGIN): DOCUMENTORIGIN is REQUIRED so the matrix's pivot
// translation is honoured in absolute coordinates. CENTER would re-anchor the matrix at
// each item's OWN centre and discard the pivot, spinning every element in place — the
// cluster never rotates (captions reorient but the bbox doesn't transpose). Applying the
// SAME matrix to both members of a {cut, art} pair keeps the artwork rigidly locked (a
// raster's .rotate() would counter-rotate; an explicit matrix does not).
function _nestPivotMatrix(angleDeg, px, py) {
    var m = app.getTranslationMatrix(-px, -py);
    m = app.concatenateRotationMatrix(m, angleDeg);
    m = app.concatenateTranslationMatrix(m, px, py);
    return m;
}

// Rotate every {cut, art} pair by angleDeg around the shared pivot (px, py) — one pivot
// matrix applied identically to both members of each pair.
function _nestRotatePairs(pairs, angleDeg, px, py) {
    if (Math.abs(angleDeg) < 0.01) return;
    var m = _nestPivotMatrix(angleDeg, px, py);
    var i, p;
    for (i = 0; i < pairs.length; i++) {
        p = pairs[i];
        p.cut.transform(m, true, true, true, true, 1, Transformation.DOCUMENTORIGIN);
        if (p.art) p.art.transform(m, true, true, true, true, 1, Transformation.DOCUMENTORIGIN);
    }
    log("[step-nest] group-rotated " + pairs.length + " pair(s) by " + angleDeg + "°");
}

// Translate every {cut, art} pair by (dx, dy).
function _nestTranslatePairs(pairs, dx, dy) {
    var i, p;
    for (i = 0; i < pairs.length; i++) {
        p = pairs[i];
        p.cut.translate(dx, dy);
        if (p.art) p.art.translate(dx, dy);
    }
}

// Moves one {cut, art} pair to its nest pose: rotates both by `rotation` about the
// CUTLINE's centre (a shared external pivot, via matrix + DOCUMENTORIGIN), then
// translates both so the cutline's bbox centre lands on `target` (the SVG part's
// centre). Using the cutline centre as the pivot for BOTH keeps the art rigidly locked
// even when it is registered to the cutline by its element (not co-centred) — rotating
// each about its own centre would then spin them about different points and desync.
function _nestApplyPairTransform(cut, art, rotation, target) {
    if (CONFIG.dryRun) return;

    if (Math.abs(rotation) > 0.01) {
        var ctr = boundsCenter(cut.geometricBounds);
        var m = _nestPivotMatrix(rotation, ctr.x, ctr.y);
        cut.transform(m, true, true, true, true, 1, Transformation.DOCUMENTORIGIN);
        if (art) art.transform(m, true, true, true, true, 1, Transformation.DOCUMENTORIGIN);
    }

    var oc = boundsCenter(cut.geometricBounds); // cutline centre after rotation
    var dx = target.x - oc.x, dy = target.y - oc.y;
    cut.translate(dx, dy);
    if (art) art.translate(dx, dy);
}

// Axis-aligned bounding box of bbox [l, t, r, b] after rotating angleDeg degrees
// around pivot (cx, cy). Pure math — does not touch any Illustrator object.
function _nestRotatedBboxBounds(bounds, cx, cy, angleDeg) {
    var rad = angleDeg * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    // Four corners of the input bbox.
    var corners = [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[1]],
        [bounds[2], bounds[3]],
        [bounds[0], bounds[3]]
    ];
    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    var i, dx, dy, rx, ry;
    for (i = 0; i < 4; i++) {
        dx = corners[i][0] - cx;
        dy = corners[i][1] - cy;
        rx = cos * dx - sin * dy + cx;
        ry = sin * dx + cos * dy + cy;
        if (rx < minX) minX = rx;
        if (rx > maxX) maxX = rx;
        if (ry < minY) minY = ry;
        if (ry > maxY) maxY = ry;
    }
    return [minX, maxY, maxX, minY]; // [left, top, right, bottom]
}

// Area of a bounding box that falls outside the bound rect (margin/safe area) when
// the box is left-aligned to boundRect[0] and top-aligned to targetTop.
// Measures right-side and bottom-side overflow; subtracts the corner double-count.
function _nestOutsideArtboardArea(rotBounds, boundRect, targetTop) {
    var W = rotBounds[2] - rotBounds[0];
    var H = rotBounds[1] - rotBounds[3];
    var abWidth      = boundRect[2] - boundRect[0];
    // Space from targetTop down to the bound bottom. Clamp at 0: if the regular group
    // already fills the area vertically, targetTop can fall below the bottom and a
    // negative availHeight would make bottomOverflow blow up identically for every
    // angle (garbage minimum). Clamped, the search degrades predictably to 0°.
    var availHeight  = Math.max(0, targetTop - boundRect[3]);

    var rightOverflow  = Math.max(0, W - abWidth);
    var bottomOverflow = Math.max(0, H - availHeight);

    // Subtract the corner that would otherwise be counted twice.
    return rightOverflow * H + bottomOverflow * W - rightOverflow * bottomOverflow;
}

// Finds the rotation angle (0–350°, step 10°) for the given items that minimises
// the area outside the bound rect (margin/safe area) when the group is left-aligned
// and top-aligned to targetTop. Uses only bounding-box math — no objects are moved.
function _nestBestRotation(items, boundRect, targetTop) {
    var bounds = _nestCombinedBounds(items);
    var cx = (bounds[0] + bounds[2]) / 2;
    var cy = (bounds[1] + bounds[3]) / 2;

    var bestAngle = 0, bestOutside = Infinity;
    var angle, rotBounds, outside;

    for (angle = 0; angle < 360; angle += 10) {
        rotBounds = _nestRotatedBboxBounds(bounds, cx, cy, angle);
        outside   = _nestOutsideArtboardArea(rotBounds, boundRect, targetTop);
        if (outside < bestOutside) {
            bestOutside = outside;
            bestAngle   = angle;
        }
    }

    log("[step-nest] irregular best rotation: " + bestAngle
        + "° (outside approx " + Math.round(bestOutside) + " pt²)");
    return bestAngle;
}

// Maximum upward (+y) translation for the irregular cluster (irrCuts) so its TOP
// contour nests against the regular cluster's (regCuts) BOTTOM contour while keeping
// >= spacingPt everywhere — i.e. how far the whole irregular group can rise before any
// of it comes within the 2mm spacing of the regular group. Pure geometry, no objects
// moved; the caller translates by the returned amount.
//
// Method: per-column skylines. Sample both clusters' cut contours to points, bin by x
// (COLW-wide columns). regBottom[col] = lowest regular y in that column; irrTop[col] =
// highest irregular y. For each irregular column, test it against regular columns within
// a horizontal dilation of spacingPt: the required VERTICAL clearance shrinks with the
// horizontal offset (sqrt(spacing² − horiz²)), so the result approximates a radial 2mm
// gap rather than a purely vertical one. The allowed shift is the min over all nearby
// pairs of (regBottom − irrTop − requiredVertical). Returns >= 0 (0 if the clusters
// don't overlap in x, so there is nothing to nest up against).
function _nestMaxUpwardShift(regCuts, irrCuts, spacingPt) {
    var STEPS = 6;    // samples/bezier-segment — sub-mm at sticker scale
    var COLW  = 2;    // column width (pt)

    function collectPts(cuts) {
        var out = [], i, p, v;
        for (i = 0; i < cuts.length; i++) {
            var polys = samplePathToPolygons(cuts[i], STEPS);
            for (p = 0; p < polys.length; p++) {
                var poly = polys[p];
                for (v = 0; v < poly.length; v++) out.push(poly[v]);
            }
        }
        return out;
    }
    var regPts = collectPts(regCuts), irrPts = collectPts(irrCuts);
    if (regPts.length === 0 || irrPts.length === 0) return 0;

    var regBottom = {}, irrTop = {}, i, col;
    for (i = 0; i < regPts.length; i++) {
        col = Math.floor(regPts[i].x / COLW);
        if (regBottom[col] === undefined || regPts[i].y < regBottom[col]) regBottom[col] = regPts[i].y;
    }
    for (i = 0; i < irrPts.length; i++) {
        col = Math.floor(irrPts[i].x / COLW);
        if (irrTop[col] === undefined || irrPts[i].y > irrTop[col]) irrTop[col] = irrPts[i].y;
    }

    var dilCols  = Math.ceil(spacingPt / COLW);
    var maxShift = Infinity, found = false, key, c, d, horiz, reqV, allow;
    for (key in irrTop) {
        if (!irrTop.hasOwnProperty(key)) continue;
        c = parseInt(key, 10);
        for (d = -dilCols; d <= dilCols; d++) {
            if (regBottom[c + d] === undefined) continue;
            // Conservative horizontal offset (inner edge of the column gap) → larger
            // required clearance → never lets the groups closer than spacingPt.
            horiz = Math.max(0, Math.abs(d) - 1) * COLW;
            reqV  = (horiz >= spacingPt) ? 0 : Math.sqrt(spacingPt * spacingPt - horiz * horiz);
            allow = (regBottom[c + d] - irrTop[c]) - reqV;
            if (allow < maxShift) { maxShift = allow; found = true; }
        }
    }
    if (!found) return 0;
    return maxShift > 0 ? maxShift : 0;
}


// ── Private helpers ────────────────────────────────────────────────────────────

// AI points per PSD pixel = 72 / sourceDPI — the SAME scale Step 6 applied when it
// placed the silhouette at the source DPI. (Placing pixels at their source DPI makes
// art and cutlines twins at true physical size.) Returns 0 when the sidecar is
// missing/unusable (caller falls back to height-fit).
function _nestArtFactor(elementsData) {
    if (!elementsData || !elementsData.psdWidth || !CONFIG.sourceDPI) return 0;
    var factor = 72.0 / CONFIG.sourceDPI;
    return factor > 0 ? factor : 0;
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
        if (item.parent !== cutlinesLayer) continue;
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
// Returns [{ name, center, bounds, area, feat }] — one per nested part (feat = the
// orientation feature from _nestPathOrientationFeature).
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

// Builds part records from every layer of an SVG doc.
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

// Recursively collects "part" page-items from a container (layer or group).
function _nestCollectParts(node) {
    var parts = [];
    var i, g, sub, s;

    for (i = 0; i < node.groupItems.length; i++) {
        g = node.groupItems[i];
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

// Builds a { name, center, bounds, area, feat } record for one nested part.
// feat = orientation feature of the largest path (see _nestPathOrientationFeature):
// the (anchor-centroid → farthest-anchor) vector, which rotates rigidly with the
// shape and so recovers Deepnest's rotation robustly.
function _nestPartRecord(part) {
    var gb   = part.geometricBounds;
    var area = _nestSumPathArea(part);

    return {
        name:   part.name || "",
        center: boundsCenter(gb),
        bounds: gb,
        area:   area,
        feat:   _nestPathOrientationFeature(_nestLargestPath(part))
    };
}

// Orientation feature for recovering a shape's rotation: { centroid, farthest, len }.
//   centroid = mean of all anchor points — a MATERIAL point of the shape (it moves
//              rigidly under rotation+translation, unlike the axis-aligned bbox centre).
//   farthest = the anchor point farthest from the centroid — also a material point
//              (the same physical vertex stays farthest under rigid motion).
//   len      = |centroid → farthest|, ≈ the shape's radius (large ⇒ low angular noise).
// For two congruent shapes (same polygon, rotated+translated), the angle between their
// (centroid→farthest) vectors equals the rotation between them, with no 180° ambiguity
// for asymmetric shapes (the farthest vertex is unique). Order-invariant: the mean and
// the max-distance vertex don't depend on which point Illustrator made "first" when it
// baked the SVG transform — the failure mode of the old anchor0/bbox-centre method.
function _nestPathOrientationFeature(path) {
    if (!path || !path.pathPoints || path.pathPoints.length === 0) return null;

    var n = path.pathPoints.length, sx = 0, sy = 0, i, p;
    for (i = 0; i < n; i++) { p = path.pathPoints[i].anchor; sx += p[0]; sy += p[1]; }
    var cx = sx / n, cy = sy / n;

    var bestD = -1, fx = cx, fy = cy, dx, dy, d;
    for (i = 0; i < n; i++) {
        p  = path.pathPoints[i].anchor;
        dx = p[0] - cx; dy = p[1] - cy;
        d  = dx * dx + dy * dy;
        if (d > bestD) { bestD = d; fx = p[0]; fy = p[1]; }
    }

    return { centroid: { x: cx, y: cy },
             farthest: { x: fx, y: fy },
             len:      Math.sqrt(bestD) };
}

// Sum of |area| over every PathItem contained in an item (recurses groups + compounds).
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
function _nestCutlineVisible(item) {
    if (item.typename === "PathItem" || item.typename === "CompoundPathItem") return item;
    if (item.typename === "GroupItem") return findGroupMember(item, "");
    return null;
}

// True path area of a cutline map entry (visible fused member only).
function _nestCutlineArea(item) {
    var vis = _nestCutlineVisible(item);
    if (vis) return _nestSumPathArea(vis);
    var gb = item.geometricBounds;
    return Math.abs(gb[2] - gb[0]) * Math.abs(gb[1] - gb[3]);
}

// Global-greedy area assignment.
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
    for (var kk = 0; kk < pairs.length; kk++) {
        var pr = pairs[kk];
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

// Computes the rotation angle (degrees, + = CCW) that Deepnest applied to the part
// relative to the matched cutline.
//
// Primary method — orientation-feature vector:
//   Both the cutline and the SVG part are the SAME polygon (Deepnest only rotated +
//   translated it). _nestPathOrientationFeature reduces each to a (centroid→farthest)
//   vector built from genuine material points, so the angle between the two vectors
//   IS the rotation. This is robust where the old bbox-centre→anchor-centroid method
//   failed: that vector used the axis-aligned bbox centre, which is NOT a material
//   point and shifts under rotation, corrupting the angle (and giving clLen≠svLen for
//   congruent shapes).
//
//   A coarse feature angle is then REFINED to the precise rotation by searching ±8°
//   for the angle that best matches the SVG part's bounding-box dimensions — the
//   final, objective correctness signal (see VERIFY in _nestProcessSingleSvg). This
//   corrects the few-degree feature noise from Deepnest's path simplification.
//
// Fallback — bbox swap: detects a 90° flip when no feature is available (largest path
// has < 2pt span, e.g. a degenerate stamp trace). LIMITATION: this fallback cannot tell
// 0° from 180° (same bbox), so a 180°-rotated degenerate part places un-rotated and the
// VERIFY bbox check can't catch it. Real elements have a usable feature vector (a unique
// farthest anchor) which resolves 180°, so this only affects near-point paths.
function _nestComputeRotation(svgItem, cutlineItem) {
    var vis    = _nestCutlineVisible(cutlineItem);
    var clPath = vis ? _nestLargestPath(vis) : null;
    var clFeat = _nestPathOrientationFeature(clPath);
    var svFeat = svgItem.feat;

    if (clFeat && svFeat && clFeat.len >= 2 && svFeat.len >= 2) {
        var clVec = { x: clFeat.farthest.x - clFeat.centroid.x,
                      y: clFeat.farthest.y - clFeat.centroid.y };
        var svVec = { x: svFeat.farthest.x - svFeat.centroid.x,
                      y: svFeat.farthest.y - svFeat.centroid.y };

        var clAngle = Math.atan2(clVec.y, clVec.x) * 180 / Math.PI;
        var svAngle = Math.atan2(svVec.y, svVec.x) * 180 / Math.PI;
        var rot = svAngle - clAngle;
        while (rot >  180) rot -= 360;
        while (rot < -180) rot += 360;

        // Refine against the SVG part's true bbox dimensions.
        return _nestRefineRotation(clPath, rot, svgItem.bounds);
    }

    // ── Fallback: bbox swap (detects 90° flip) ───────────────────────────────────
    var cgb   = cutlineItem.geometricBounds;
    var origW = Math.abs(cgb[2] - cgb[0]);
    var origH = Math.abs(cgb[1] - cgb[3]);
    var newW  = Math.abs(svgItem.bounds[2] - svgItem.bounds[0]);
    var newH  = Math.abs(svgItem.bounds[1] - svgItem.bounds[3]);
    var tol   = 5;
    if (Math.abs(origW - newH) < tol && Math.abs(origH - newW) < tol) return 90;

    return 0;
}

// Refines a coarse rotation estimate by searching ±8° (0.5° steps) for the angle
// whose rotated bounding box best matches the target (the SVG part's) bbox dims.
// Pure math over the path's anchor points — no Illustrator objects are moved.
// The feature vector already resolves the gross angle (incl. 180°); this only nudges
// out the few-degree error left by Deepnest's path-point simplification.
function _nestRefineRotation(clPath, coarseRot, targetBounds) {
    if (!clPath || !clPath.pathPoints || clPath.pathPoints.length === 0) return coarseRot;

    var tW = Math.abs(targetBounds[2] - targetBounds[0]);
    var tH = Math.abs(targetBounds[1] - targetBounds[3]);

    // Snapshot anchors once.
    var n = clPath.pathPoints.length, pts = [], i, p;
    for (i = 0; i < n; i++) { p = clPath.pathPoints[i].anchor; pts.push([p[0], p[1]]); }

    var bestRot = coarseRot, bestErr = Infinity;
    var a, rad, cos, sin, j, x, y, rx, ry, minX, maxX, minY, maxY, w, h, err;
    for (a = coarseRot - 8; a <= coarseRot + 8; a += 0.5) {
        rad = a * Math.PI / 180; cos = Math.cos(rad); sin = Math.sin(rad);
        minX = Infinity; maxX = -Infinity; minY = Infinity; maxY = -Infinity;
        for (j = 0; j < n; j++) {
            x = pts[j][0]; y = pts[j][1];
            rx = cos * x - sin * y;
            ry = sin * x + cos * y;
            if (rx < minX) minX = rx;
            if (rx > maxX) maxX = rx;
            if (ry < minY) minY = ry;
            if (ry > maxY) maxY = ry;
        }
        w = maxX - minX; h = maxY - minY;
        err = Math.abs(w - tW) + Math.abs(h - tH);
        if (err < bestErr) { bestErr = err; bestRot = a; }
    }
    return bestRot;
}

// Places {displayName}.png on its cutline WHILE THE CUTLINE IS STILL UPRIGHT — scaled by
// the absolute PSD→AI factor and centred — so the art-to-cutline alignment is set with no
// rotation. The caller then moves the {cut, art} pair to the nest pose as a rigid unit, so
// the art never needs an independent rotation (where the raster Y-flip caused drift).
//
// Sizing: the art and cutline are twins from the same PSD at the same pixel scale, so the
// art needs no fitting — Deepnest only rotates/translates. resize by artFactor×100 lands
// the 72-dpi PNG at its true AI size (element_px × factor); uniform scale keeps its aspect.
// Returns the placed PageItem, or null if the PNG is missing / placement failed.
function _nestPlaceArtUpright(doc, stickersLayer, artFolder, cutlineItem, artFactor) {
    var displayName = cutlineItem.name;
    var safeName    = displayName.replace(/[\/\\:*?"<>|]/g, "_");
    var pngFile     = new File(artFolder.fsName + "/" + safeName + ".png");

    if (!pngFile.exists) {
        log("[step-nest] WARN | art PNG not found for: " + displayName);
        return null;
    }
    if (CONFIG.dryRun) {
        log("[step-nest] [DRY RUN] would place art | " + displayName);
        return null;
    }

    doc.activeLayer = stickersLayer;

    var placed = null;
    try {
        // Add via the Stickers layer's own collection, NOT doc.placedItems.add(): the
        // latter targets the topmost layer (the locked Margin band from
        // buildWorkingDocument), which throws "Target layer cannot be modified".
        // Layer-scoped add lands the item directly on Stickers.
        placed = stickersLayer.placedItems.add();
        placed.file = pngFile;
        placed.name = displayName;

        // Defensive: ensure the item actually lives in the Stickers layer (a no-op when
        // the layer-scoped add already placed it there).
        if (placed.layer !== stickersLayer) {
            placed.move(stickersLayer, ElementPlacement.PLACEATBEGINNING);
        }

        // Size to true AI size = element_px × factor; for a 72-dpi PNG that's just
        // resize by factor×100 (placed.width == element_px, so the px term cancels).
        // Then centre on the cutline group (cutline is upright here).
        var cgb = cutlineItem.geometricBounds;
        placed.resize(artFactor * 100, artFactor * 100);

        var cc = boundsCenter(cgb);
        placed.translate(cc.x - (placed.position[0] + placed.width  / 2),
                         cc.y - (placed.position[1] - placed.height / 2));

        // Objective fit check (upright, before the nest transform): the art and the
        // cutline are the same element, so their bounding boxes should closely agree.
        // Under the old height-fit, height matched but width could be far off; the
        // absolute factor makes both agree (residual = trace inset + plate vs render).
        var agb = placed.geometricBounds;
        var aW = Math.abs(agb[2] - agb[0]), aH = Math.abs(agb[1] - agb[3]);
        var cW = Math.abs(cgb[2] - cgb[0]), cHb = Math.abs(cgb[1] - cgb[3]);
        log("[step-nest] ART-FIT | " + displayName
            + " art=" + Math.round(aW) + "x" + Math.round(aH)
            + " cut=" + Math.round(cW) + "x" + Math.round(cHb)
            + " dW=" + Math.round(aW - cW) + " dH=" + Math.round(aH - cHb));

        return placed;

    } catch (e) {
        // Don't leak a half-placed orphan: if add() succeeded but a later move/resize/
        // translate threw, the PlacedItem is still in the doc (often stranded on the
        // Cutlines layer) where the Stickers-only re-run cleaner never sees it and it
        // accumulates run-over-run. Remove it so failure is clean.
        if (placed) { try { placed.remove(); } catch (e2) {} }
        log("[step-nest] WARN | art placement failed for: " + displayName
            + " — line " + e.line + ": " + e.message);
        return null;
    }
}
