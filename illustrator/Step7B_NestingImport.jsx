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

    // Re-run safety: clear any previously placed artwork so it doesn't stack. Art is now
    // EMBEDDED at placement (rasterItems) for a portable handoff, so the clear must sweep
    // BOTH collections: rasterItems (embedded art, the norm) AND placedItems (a stray
    // linked item from an older run or a partial embed). Clearing only placedItems would
    // let embedded art DUPLICATE on every re-run.
    if (stickersLayer && !CONFIG.dryRun) {
        var cleared = 0;
        var pi;
        for (pi = stickersLayer.placedItems.length - 1; pi >= 0; pi--) {
            stickersLayer.placedItems[pi].remove();
            cleared++;
        }
        for (pi = stickersLayer.rasterItems.length - 1; pi >= 0; pi--) {
            stickersLayer.rasterItems[pi].remove();
            cleared++;
        }
        if (cleared > 0) {
            log("[step-nest] cleared " + cleared + " previously placed art item(s) (re-run).");
        }
    }

    // Re-run safety: strip any prior spacing-buffer halos BEFORE the cutline math runs, so a
    // stale halo (offset outward past the cut) can never skew matching, placement, or the overlap
    // guard. They are rebuilt at the end of this step on the final nested pose.
    if (!CONFIG.dryRun) { try { removeAllSpacingBuffers(doc); } catch (eBuf) {} }

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

    var totalMatched = 0, totalUnmatched = 0, totalArtPlaced = 0, totalCaptionPlaced = 0;
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
        totalMatched       += regResult.matched;
        totalUnmatched     += regResult.unmatched;
        totalArtPlaced     += regResult.artPlaced;
        totalCaptionPlaced += regResult.captionPlaced;

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
        totalMatched       += irrResult.matched;
        totalUnmatched     += irrResult.unmatched;
        totalArtPlaced     += irrResult.artPlaced;
        totalCaptionPlaced += irrResult.captionPlaced;

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

    // ── 5b. Re-sync each GC/WC half-cut to its final nested pose ──────────────────
    // The half-cut tracks the caption seam; nesting only rotated/translated each cutline
    // group, so re-derive it on the new pose (idempotent — clears its own prior output).
    if (!CONFIG.dryRun) {
        // Wrap bare stamp cutlines in groups first, so they too can host a halo that rides the
        // drag (a stamp's cut line is a first-class cutline in Illustrator — same 2mm rule). The
        // half-cut still skips them (note "ST|0"); only the spacing buffer covers stamps.
        var stampsWrapped = wrapStampsInGroups(cutlinesLayer);
        if (stampsWrapped > 0) log("[step-nest] wrapped " + stampsWrapped + " stamp(s) in groups for halo");

        var hcSynced = 0, sbSynced = 0, gi, gItem, gNote;
        for (gi = 0; gi < cutlinesLayer.groupItems.length; gi++) {
            gItem = cutlinesLayer.groupItems[gi];
            if (gItem.parent !== cutlinesLayer) continue;
            gNote = parseNote(gItem.note);
            if (!gNote) continue;
            var isCaptioned = (gNote.styleCode === "GC" || gNote.styleCode === "WC");
            // A default-tab group is note "ST" WITH a " plate" member (the tab cutline); a bare
            // stamp wrapper is note "ST" with no plate. Tabs get a half-cut like captions.
            var isTab       = (gNote.styleCode === "ST" && findGroupMember(gItem, " plate") !== null);
            var isStamp     = (gNote.styleCode === "ST");
            if (!isCaptioned && !isStamp) continue;
            // Half-cut: GC/WC + default tabs. syncHalfcut clears the prior tab BEFORE re-deriving,
            // so a re-sync that fails to re-seat leaves NO half-cut — name the element rather than
            // silently undercount. (Without this, a tab's half-cut stays at its pre-nest pose until
            // Step 9A re-syncs it at export.)
            if (isCaptioned || isTab) {
                var hcRes = syncHalfcut(doc, gItem, {});
                if (hcRes.ok) hcSynced++;
                else log("[step-nest] half-cut SKIP | " + gItem.name + " — " + hcRes.reason
                    + " (peel tab missing; AI_ExportFinal will hard-error until the seat is fixed)");
            }
            // Spacing-buffer halo (live drag-time 2mm keep-out aid) — GC/WC AND stamps. Built here
            // so it rides the nested pose + the artist's manual repositioning; refreshed by Step 8b;
            // stripped before export. Advisory, so a failure only logs — it never blocks the import.
            var sbRes = syncSpacingBuffer(doc, gItem, {});
            if (sbRes.ok) sbSynced++;
            else log("[step-nest] spacing-buffer SKIP | " + gItem.name + " — " + sbRes.reason);
        }
        log("[step-nest] half-cut sync | " + hcSynced + " GC/WC/tab element(s) re-synced to nested pose");
        log("[step-nest] spacing-buffer | " + sbSynced + " keep-out halo(s) built (GC/WC + stamps)");
    }

    // ── 5c. Real overlap guard (opt-in) ───────────────────────────────────────────
    // The check the bbox VERIFY is structurally blind to: do any two finished cut lines
    // actually intersect? A placement/rotation error shows up here even when each element's
    // own bbox looks right. It is an all-pairs polygon-intersection sweep over the nested
    // cut lines — and on a packed sheet it is the dominant cost of the whole import
    // (~65% of wall time, measured). It is also only a SIGNAL, not a gate: the real export
    // gate (Step 8c spacing QA) already fails any file where two cut lines are under 2mm,
    // and an overlap reads there as ~0mm — so nothing overlapping can ever ship even with
    // this skipped. Its lasting value is as a ROTATION-REGRESSION guard, which matters for
    // the automated test, not the artist (who hand-nests immediately after import anyway).
    // So it is OFF by default for the interactive artist run and ON for the headless test
    // (the runner sets CONFIG.verifyOverlaps = true). See AI_ImportNesting CONFIG.
    if (!CONFIG.dryRun && CONFIG.verifyOverlaps) {
        var ovPairs = _nestDetectOverlaps(cutlinesLayer);
        var op;
        for (op = 0; op < ovPairs.length; op++) {
            log("[step-nest] *** CUTLINE OVERLAP *** " + ovPairs[op][0] + "  <->  " + ovPairs[op][1]);
        }
        log("[step-nest] overlap-check | " + ovPairs.length + " overlapping cut-line pair(s)"
            + (ovPairs.length === 0 ? "  ok" : "  *** OVERLAP ***"));
    } else if (!CONFIG.dryRun) {
        log("[step-nest] overlap-check | skipped (verifyOverlaps off) — Step 8c spacing QA "
            + "gates overlap at export");
    }

    // ── 6. Summary ───────────────────────────────────────────────────────────────
    // Verify art actually landed on the Stickers layer (not Cutlines): doc.placedItems
    // .add() ignores the active layer after the cutline passes, so a regression here is
    // silent unless asserted. The test gates on this line.
    // Only the per-element ART PNG lands on Stickers now — the native caption rides its
    // cutline group (not Stickers). A mismatch means an item landed on the wrong layer
    // (e.g. the locked Cutlines layer) — a silent regression unless asserted.
    // Art is embedded at placement, so it lives on Stickers as rasterItems now (not
    // placedItems). Count BOTH so a stray un-embedded link still registers as "on Stickers"
    // (this check gates LAYER LOCATION, not embed status) — and surface embedded vs linked so
    // an embed regression is visible: a healthy run reads "embedded N / linked 0".
    var rasterN = stickersLayer ? stickersLayer.rasterItems.length : 0;
    var linkedN = stickersLayer ? stickersLayer.placedItems.length : 0;
    var placedOnStickers = rasterN + linkedN;
    log("[step-nest] art-layer-check | on Stickers: " + placedOnStickers
        + " (embedded " + rasterN + " / linked " + linkedN + ")"
        + " / placed: " + totalArtPlaced
        + (placedOnStickers === totalArtPlaced ? "  ok" : "  *** ITEM ON WRONG LAYER ***"));

    log("[step-nest] result | matched: " + totalMatched
        + " | unmatched: " + totalUnmatched
        + " | art placed: " + totalArtPlaced);

    return { matched: totalMatched, unmatched: totalUnmatched,
             artPlaced: totalArtPlaced, captionPlaced: totalCaptionPlaced };
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

    var matched = 0, artPlaced = 0, captionPlaced = 0, pairs = [];
    var assignedPart = {};
    var a, svgItem, cutlineItem, rotation, artItem, captionItem;

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
            // The native caption (white pill + text + GC plate) is a MEMBER of the cutline
            // group now, so it rides every nest transform automatically with the cut — no
            // separate placement/binding needed (Pipeline 2 built it into the group).
        }

        // Bake the caption's live Arc warp to static outlines BEFORE the nest rotation.
        // The auto-warp is a LIVE "Adobe Deform" Arc that bends along the PAGE horizontal,
        // so a rotated sticker misaligns it — the pill (a plain path) rotates rigidly while
        // the live-warped text re-evaluates and spills out of its pill (wrong-direction curve
        // / text into the art). Expanding freezes the warp into the glyph outlines, which then
        // transform rigidly with the pill through this AND every later cluster rotation.
        _nestBakeCaptionWarp(doc, cutlineItem);

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
            var fitRms = (svgItem._fitResidual !== undefined)
                ? (Math.round(svgItem._fitResidual * 10) / 10) : "na";
            log("[step-nest] VERIFY | " + cutlineItem.name
                + " rot=" + Math.round(rotation)
                + " fitRMS=" + fitRms
                + " bboxΔ=(" + Math.round(dW) + "," + Math.round(dH) + ")"
                + (bad ? "  *** ROTATION WRONG ***" : "  ok"));
        }

        // caption: null — the native caption rides `cut` (it's a group member), so the
        // cluster-layout transforms (_nestRotatePairs/_nestTranslatePairs) move it via `cut`.
        pairs.push({ cut: cutlineItem, art: artItem, caption: null });
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

    return { matched: matched, unmatched: unmatched, pairs: pairs,
             artPlaced: artPlaced, captionPlaced: captionPlaced };
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
        if (p.art)     p.art.transform(m, true, true, true, true, 1, Transformation.DOCUMENTORIGIN);
        if (p.caption) p.caption.transform(m, true, true, true, true, 1, Transformation.DOCUMENTORIGIN);
    }
    log("[step-nest] group-rotated " + pairs.length + " pair(s) by " + angleDeg + "°");
}

// Translate every {cut, art} pair by (dx, dy).
function _nestTranslatePairs(pairs, dx, dy) {
    var i, p;
    for (i = 0; i < pairs.length; i++) {
        p = pairs[i];
        p.cut.translate(dx, dy);
        if (p.art)     p.art.translate(dx, dy);
        if (p.caption) p.caption.translate(dx, dy);
    }
}

// Bakes a captioned group's live Arc warp into static glyph outlines so it survives the
// nest rotation rigidly (see the call site for why a live page-horizontal warp misaligns).
// Uses Expand Appearance (executeMenuCommand "expandStyle"), which is a NO-OP on a plain
// (unwarped) text frame — so only the round/oval-base captions that actually carry a warp
// get outlined; flat-bottomed captions stay editable TextFrames. Idempotent (a member already
// expanded to non-text geometry is skipped). The baked result keeps the "{name} caption text"
// name so Step 8b (which only SCALES the member) and export still resolve it. dryRun-safe.
// Returns true if the bake pass ran (whether or not the frame actually carried a warp).
function _nestBakeCaptionWarp(doc, group) {
    if (CONFIG.dryRun) return false;
    if (!group || group.typename !== "GroupItem") return false;
    var text = findGroupMember(group, " caption text");
    if (!text || text.typename !== "TextFrame") return false;   // no caption / already baked
    var name = text.name;
    try {
        // executeMenuCommand("expandStyle") acts on the ACTIVE document's selection, so pin the
        // active doc to `doc` and drive selection through app.selection (not doc.selection) — the
        // two only agree while doc is frontmost, and _nestCollectFromSvgs can swallow a restore throw.
        app.activeDocument = doc;
        app.selection = null;
        text.selected = true;
        app.executeMenuCommand("expandStyle");   // Object > Expand Appearance — freezes the live warp
        // A WARPED frame expands to path geometry — usually a GroupItem, but a CompoundPathItem for
        // simple/single-colour glyphs; either way reapply the name so downstream name lookups still
        // hit it. A PLAIN frame is a no-op and stays a TextFrame — correctly left editable, unnamed
        // touch. Warn (never silently drop) if it expanded to an unexpected multi-item shape.
        var sel = app.selection;
        var baked = (sel && sel.length === 1) ? sel[0] : null;
        if (baked && baked.typename !== "TextFrame") {
            baked.name = name;                   // GroupItem OR CompoundPathItem OR PathItem
            log("[step-nest] caption warp baked | " + group.name);
        } else if (sel && sel.length > 1) {
            log("[step-nest] WARN | caption warp expanded to " + sel.length
                + " items — '" + name + "' name not reapplied | " + group.name);
        }
        app.selection = null;
        return true;
    } catch (e) {
        log("[step-nest] WARN | caption warp bake failed | " + group.name + ": " + e.message);
        try { app.selection = null; } catch (e2) {}
        return false;
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

    // `cut` is the cutline GROUP — transforming it moves its members (outline, pill, text,
    // GC plate raster, cut path) rigidly, so the native caption rides along automatically.
    // Only the art PNG (a separate Stickers item) needs its own transform.
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
    var STEPS  = 12;                   // samples/bezier-segment — fine enough that the
                                       // contour-extremum miss between samples is sub-point
                                       // at sticker scale (elements <= ~220pt across).
    var COLW   = 2;                    // column width (pt)
    var SAFETY = mmToPoints(0.5);      // back-off for residual sampling miss. The skyline
                                       // reads min/max of SAMPLED points, so a true extremum
                                       // between two samples can sit slightly beyond it
                                       // (regBottom biased high, irrTop biased low). At STEPS=12
                                       // that miss is well under 0.5mm for the largest element
                                       // (worst case ~0.3pt for a 90° arc at R~110pt), so this
                                       // margin keeps the achieved clearance >= spacingPt — a
                                       // sub-2mm pinch would otherwise be rejected by Step 8c.

    function collectPts(cuts) {
        var out = [], i, p, v, poly;
        for (i = 0; i < cuts.length; i++) {
            var polys = samplePathToPolygons(cuts[i], STEPS);
            for (p = 0; p < polys.length; p++) {
                poly = polys[p];
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
    maxShift -= SAFETY;
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
        if (item.parent !== cutlinesLayer) continue;   // direct children only (groupItems recurses)
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
    var lp   = _nestLargestPath(part);

    return {
        name:   part.name || "",
        center: boundsCenter(gb),
        bounds: gb,
        area:   area,
        feat:   _nestPathOrientationFeature(lp),
        // Baked contour of the part's outer edge, sampled NOW (the SVG doc is closed right
        // after collection). Used by _nestComputeRotation for full-contour registration —
        // the whole outline, not one ambiguous corner.
        poly:   lp ? _nestContourPoints(lp, 6) : []
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

// ── Full-contour rigid registration (replaces the farthest-corner angle guess) ──────
// The old _nestComputeRotation reduced each shape to a single (centroid→farthest-corner)
// vector. For near-square rounded rectangles the four corners are near-equidistant, so the
// chosen "farthest" corner flips a few degrees under Deepnest's path re-emission — landing
// the angle 4–8° off (e.g. St Martin's −85° vs Deepnest's −90°), which swings a corner into
// the neighbour. The bbox `VERIFY` can't see it (a few-degree tilt of a square has the same
// bbox). These helpers instead align the WHOLE outline, so the recovered angle matches
// Deepnest's `rotate()` to <1° regardless of symmetry.

// Flatten an item's sampled contour polygons (outer + any holes) into one point array.
function _nestContourPoints(item, stepsPerSeg) {
    var polys = samplePathToPolygons(item, stepsPerSeg), out = [], i, j;
    for (i = 0; i < polys.length; i++)
        for (j = 0; j < polys[i].length; j++) out.push(polys[i][j]);
    return out;
}

// Even-stride downsample to at most `cap` points (keeps the registration cheap).
function _nestDownsample(pts, cap) {
    if (pts.length <= cap) return pts;
    var out = [], stride = pts.length / cap, i;
    for (i = 0; i < cap; i++) out.push(pts[Math.floor(i * stride)]);
    return out;
}

function _nestMeanPt(pts) {
    var sx = 0, sy = 0, i;
    for (i = 0; i < pts.length; i++) { sx += pts[i].x; sy += pts[i].y; }
    return { x: sx / pts.length, y: sy / pts.length };
}

// Mean squared nearest-point distance from posed set A to contour B (the fit error).
function _nestFitErr(A, B) {
    var i, j, sum = 0, best, dx, dy, d;
    for (i = 0; i < A.length; i++) {
        best = Infinity;
        for (j = 0; j < B.length; j++) {
            dx = A[i].x - B[j].x; dy = A[i].y - B[j].y; d = dx * dx + dy * dy;
            if (d < best) best = d;
        }
        sum += best;
    }
    return sum / A.length;
}

// Recover the rotation (deg, +CCW) mapping the cutline contour onto the Deepnest part
// contour by MINIMISING contour-fit error over a full 360° scan (coarse 5° → fine 0.25°).
// Uses the whole outline, so near-square shapes can't alias. `featSeed` (the coarse
// centroid→farthest angle) only breaks a 0-vs-180 near-tie on near-symmetric outlines.
// Returns { angle, residual } — residual = RMS point error (pt); large ⇒ caller flags.
function _nestContourFitAngle(cutlinePts, partPts, featSeed) {
    var A0 = _nestDownsample(cutlinePts, 56);
    var B  = _nestDownsample(partPts, 56);
    var Oc = _nestMeanPt(A0), Op = _nestMeanPt(B);
    var Ac = [], i;
    for (i = 0; i < A0.length; i++) Ac.push({ x: A0[i].x - Oc.x, y: A0[i].y - Oc.y });

    function fitAt(deg) {
        var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), P = [], k;
        for (k = 0; k < Ac.length; k++)
            P.push({ x: c * Ac[k].x - s * Ac[k].y + Op.x,
                     y: s * Ac[k].x + c * Ac[k].y + Op.y });
        return _nestFitErr(P, B);
    }

    var best = 0, bestE = Infinity, a, e;
    for (a = 0; a < 360; a += 5)              { e = fitAt(a); if (e < bestE) { bestE = e; best = a; } }
    var c0 = best;
    for (a = c0 - 5; a <= c0 + 5; a += 0.25)  { e = fitAt(a); if (e < bestE) { bestE = e; best = a; } }

    // 0-vs-180 tiebreak: if the opposite pose fits within 10%, pick the one nearer the
    // unique-corner feature seed (which carries the gross orientation/handedness).
    var oppE = fitAt(best + 180);
    if (oppE < bestE * 1.10 && typeof featSeed === "number") {
        function adist(x, y) { var d = ((x - y) % 360 + 540) % 360 - 180; return d < 0 ? -d : d; }
        if (adist(best + 180, featSeed) < adist(best, featSeed)) { best = best + 180; bestE = oppE; }
    }

    while (best > 180)   best -= 360;
    while (best <= -180) best += 360;
    return { angle: best, residual: Math.sqrt(bestE) };
}

// Coarse, decimated contours for the overlap touch-test (keeps polygonsOverlap cheap on
// dense traced cut lines): sample at 2 steps/seg, then even-stride down to ≤80 pts each.
function _nestCoarseContours(item) {
    var polys = samplePathToPolygons(item, 2), out = [], i;
    for (i = 0; i < polys.length; i++) {
        if (polys[i].length >= 3) out.push(_nestDownsample(polys[i], 80));
    }
    return out;
}

// Detects overlapping cut-line pairs among the Cutlines layer's direct children — the
// real geometric check the bbox `VERIFY` is blind to. bbox-gated, then exact polygon
// overlap. Returns [[nameA, nameB], …].
function _nestDetectOverlaps(cutlinesLayer) {
    var items = [], names = [], i, it, vis;
    function add(node) { vis = _nestCutlineVisible(node); if (vis) { items.push(vis); names.push(node.name); } }
    for (i = 0; i < cutlinesLayer.groupItems.length; i++) {
        it = cutlinesLayer.groupItems[i]; if (it.parent === cutlinesLayer && it.name) add(it);
    }
    for (i = 0; i < cutlinesLayer.pathItems.length; i++) {
        it = cutlinesLayer.pathItems[i]; if (it.parent === cutlinesLayer && it.name) add(it);
    }
    for (i = 0; i < cutlinesLayer.compoundPathItems.length; i++) {
        it = cutlinesLayer.compoundPathItems[i]; if (it.parent === cutlinesLayer && it.name) add(it);
    }
    var n = items.length, gb = [], polys = [], a, b;
    for (a = 0; a < n; a++) { gb.push(items[a].geometricBounds); polys.push(null); }
    var out = [];
    for (a = 0; a < n; a++) {
        for (b = a + 1; b < n; b++) {
            // bbox gate (AI y-up: [l,t,r,b], t>b) — skip clearly-disjoint pairs.
            if (gb[a][2] < gb[b][0] || gb[b][2] < gb[a][0]) continue;
            if (gb[a][3] > gb[b][1] || gb[b][3] > gb[a][1]) continue;
            // Coarse sample (2 steps/seg) + decimate ≤80 pts/contour: this is a touch
            // test on already-bbox-adjacent stickers, so a few-pt contour resolution is
            // plenty, and it keeps the O(n·m) overlap test from exploding on dense traces.
            if (polys[a] === null) polys[a] = _nestCoarseContours(items[a]);
            if (polys[b] === null) polys[b] = _nestCoarseContours(items[b]);
            if (polygonsOverlap(polys[a], polys[b])) out.push([names[a], names[b]]);
        }
    }
    return out;
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

    // Coarse feature angle — seeds the 0/180 tiebreak, and is the legacy fallback.
    var seed = null;
    if (clFeat && svFeat && clFeat.len >= 2 && svFeat.len >= 2) {
        var clAngle = Math.atan2(clFeat.farthest.y - clFeat.centroid.y,
                                 clFeat.farthest.x - clFeat.centroid.x) * 180 / Math.PI;
        var svAngle = Math.atan2(svFeat.farthest.y - svFeat.centroid.y,
                                 svFeat.farthest.x - svFeat.centroid.x) * 180 / Math.PI;
        seed = svAngle - clAngle;
        while (seed >  180) seed -= 360;
        while (seed < -180) seed += 360;
    }

    // PRIMARY: full-contour registration against the baked Deepnest part. Immune to the
    // ambiguous-farthest-corner drift on near-square shapes (the overlap bug).
    if (clPath && svgItem.poly && svgItem.poly.length >= 8) {
        var cutPts = _nestContourPoints(clPath, 6);
        if (cutPts.length >= 8) {
            var fit = _nestContourFitAngle(cutPts, svgItem.poly, seed);
            svgItem._fitResidual = fit.residual;   // surfaced by the VERIFY line
            return fit.angle;
        }
    }

    // FALLBACK 1: coarse feature + bbox-dim refine (degenerate/empty contour only).
    if (seed !== null) return _nestRefineRotation(clPath, seed, svgItem.bounds);

    // ── Fallback 2: bbox swap (detects 90° flip) ───────────────────────────────────
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
        // Centre on the element-art trace — the cutline's " outline" member — NOT the
        // full cutline. The cutline = Unite(outline, plate), so its bbox includes the
        // caption/plate region; the art PNG is now caption-free (the caption is placed
        // separately), so registering it to the full cutline would drift it toward the
        // empty plate area. Stamps (PathItem, no members) fall back to full bounds.
        var artBoundsItem = (cutlineItem.typename === "GroupItem")
            ? findGroupMember(cutlineItem, " outline") : null;
        var cgb = artBoundsItem ? artBoundsItem.geometricBounds : cutlineItem.geometricBounds;
        placed.resize(artFactor * 100, artFactor * 100);

        var cc = boundsCenter(cgb);
        placed.translate(cc.x - (placed.position[0] + placed.width  / 2),
                         cc.y - (placed.position[1] - placed.height / 2));

        // Objective fit check (upright, before the nest transform): the art and the
        // outline trace are the same element-art shape, so their bounding boxes should
        // closely agree (residual = trace inset vs render). A large mismatch flags a
        // sizing/centering regression.
        var agb = placed.geometricBounds;
        var aW = Math.abs(agb[2] - agb[0]), aH = Math.abs(agb[1] - agb[3]);
        var cW = Math.abs(cgb[2] - cgb[0]), cHb = Math.abs(cgb[1] - cgb[3]);
        log("[step-nest] ART-FIT | " + displayName
            + " art=" + Math.round(aW) + "x" + Math.round(aH)
            + " outline=" + Math.round(cW) + "x" + Math.round(cHb)
            + " dW=" + Math.round(aW - cW) + " dH=" + Math.round(aH - cHb));

        // Embed the linked PNG so the working + handoff .ai is SELF-CONTAINED (portable):
        // a placed item stores an ABSOLUTE path that breaks on any other machine. Done here,
        // AFTER all geometry (resize/translate/ART-FIT), so those run on the well-understood
        // PlacedItem and the ART-FIT/VERIFY goldens are unchanged; embed() then bakes the
        // pixels in, converting the PlacedItem into a RasterItem in place (same pose). A
        // RasterItem transforms identically to a PlacedItem, so the downstream nest transform
        // (_nestApplyPairTransform) + cluster moves keep working on the returned item.
        placed.embed();
        // embed() can invalidate the original reference (version-dependent). Prefer the
        // surviving ref; else re-fetch the raster from the top of the layer (placedItems.add
        // + PLACEATBEGINNING put it there, and embed replaces it in place). Re-apply the name
        // either way — Step 10 matches art -> cutline by this name.
        var art;
        try {
            placed.name = displayName;
            art = placed;
        } catch (eStale) {
            art = stickersLayer.pageItems[0];
            art.name = displayName;
        }
        return art;

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
