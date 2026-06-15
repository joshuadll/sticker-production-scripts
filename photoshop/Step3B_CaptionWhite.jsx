// Step3B_CaptionWhite.jsx — Phase function only.
// #included by PSAI_BuildAndExportCutlines.jsx. Requires: psUtils.jsx, CONFIG in scope.
//
// Runs after the artist's manual caption review pass (Step 3A → artist adjusts →
// Step 3B). Finds each SO + T layer pair, creates a White pill base that follows
// the T layer's shape (handles straight and curved text), adds a Caption plate for
// GC-LM elements, then groups everything — including the White Base_Cutline added
// by Step 3 (white edge) — under the original element name.
//
// Expects at top level:
//   • SO layers (NAME_REGEX) — each followed immediately by White Base_Cutline
//   • T layers (display name, LayerKind.TEXT) — above the corresponding SO
//   • Optionally a "Caption plate" group for GC-LM SKUs
//
// Stamp elements ([ST]) are grouped with their White Base_Cutline only (no caption).
//
// Returns: { grouped, skipped[], captionLess[] }
//
// ── Caption-spine carry (Mechanism B) ─────────────────────────────────────────
// The White pill is a capsule fitted to the text spine (curved/tilted captions
// follow the art). Step 6 in Illustrator rebuilds the caption parametrically, so
// to make the cutline FOLLOW that curve we hand the real spine+radius across the
// PS→AI seam. createWhiteFromText computes them; we stash them here keyed by
// display name (in PSD px, as offsets from the White pill's bbox top-left). The
// stash happens AFTER seatCaptionConform, with seat.spine — the spine transformed by
// the SAME rotate+kiss as the pill — so the offsets to the final pill bbox are exact
// even when the conform rotated the caption. PSAI's writeElementsFile re-anchors them
// to the final White bounds and writes them to the sidecar. WC-only consumer (GC keeps
// the parametric pill). PSAI always runs this step in the same session as the sidecar
// write, so every WC caption always carries a spine — Step 6 relies on that (it builds
// the WC capsule unconditionally).

var WC_CAPTION_SPINES = {};   // displayName -> { off:[{dx,dy}...], radius:Number }

// Records a caption's spine offsets (relative to the White pill's CURRENT — post-seat —
// bbox top-left, in px) + capsule radius, keyed by display name. The caller passes the
// seat-transformed spine, so the offsets capture the final rotated+kissed geometry.
function _stashCaptionSpine(displayName, whiteLayer, spine, radius) {
    if (!displayName || !spine || spine.length < 2 || !radius) return;
    var b = layerBoundsPx(whiteLayer);   // [L,T,R,B] at the current (post-seat) position
    var off = [];
    for (var i = 0; i < spine.length; i++) {
        off.push({ dx: spine[i].x - b[0], dy: spine[i].y - b[1] });
    }
    WC_CAPTION_SPINES[displayName] = { off: off, radius: radius };
}

// Seat metadata carried to PSAI's writeElementsFile, keyed by display name (PSD px):
//   needsReview — true when the analytic seat couldn't seat cleanly: the chord tilt
//                 exceeded maxSeatRotationDeg, the caption overhangs the art too far to
//                 rescue (skipped), or the capsule geometry was missing. AI's Layout QA
//                 surfaces a review marker. (See seatCaptionConform.)
// (The old `bite` seam-endpoints were removed: their only consumer was the AI junction
// fillet, which was reverted — the export cutline is back to the raw Unite(outline, plate).)
var CAPTION_SEAT = {};   // displayName -> { needsReview:Bool }

function _stashCaptionSeat(displayName, seat) {
    if (!displayName || !seat) return;
    CAPTION_SEAT[displayName] = {
        needsReview: !!seat.needsReview
    };
}

function runCaptionWhite(doc) {
    var origUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var grouped     = 0;
    var skipped     = [];
    var captionLess = [];  // needs-caption elements that resolved to NO caption nearby
    var gcLmCount   = 0;   // track how many GC-LM elements used the caption plate

    try {
        // Create the Elements wrapper group first so element sub-groups are built
        // directly inside it. This avoids PS 2026's restriction on moving or
        // duplicating LayerSets into another LayerSet.
        var elementsGroup = findLayerByName(doc, "Elements");
        if (!elementsGroup) {
            elementsGroup = doc.layerSets.add();
            elementsGroup.name = "Elements";
        }

        // Collect layer references upfront to avoid index-shift during grouping.
        // Iterate in REVERSE (bottom-to-top) so each sub-group added to the top
        // of elementsGroup naturally lands in the correct z-order.
        var layerRefs = [];
        for (var i = 0; i < doc.layers.length; i++) {
            layerRefs.push(doc.layers[i]);
        }

        // Decide every caption→element binding ONCE, while all layers are still
        // top-level (grouping below removes them from doc.layers). Indexed by element
        // .id in the loop. Doing it up front — not per element — is what makes the
        // assignment independent of grouping order. See buildCaptionAssignment.
        var captionAssign = buildCaptionAssignment(doc, CONFIG.captionMaxGapFrac);

        for (var i = layerRefs.length - 1; i >= 0; i--) {
            var soLayer = layerRefs[i];
            var name    = soLayer.name;

            if (name === "Caption plate") continue;
            if (name === "Elements")      continue;

            var parsed = parseLayerName(name);
            if (!parsed) continue;

            // ── Stamps ([ST]): group SO + White Base_Cutline only, no caption ──
            if (parsed.styleCode === "ST") {
                if (CONFIG.dryRun) {
                    log("[step3B] [DRY RUN] would group stamp | " + name);
                    grouped++;
                    continue;
                }
                try {
                    groupNoCaption(doc, elementsGroup, soLayer, name);
                    log("[step3B] grouped stamp | " + name);
                    grouped++;
                } catch (e) {
                    log("[step3B] ERROR | \"" + name + "\" line " + e.line + ": " + e.message);
                    skipped.push(name + " (error: " + e.message + ")");
                }
                continue;
            }

            if (!needsCaption(parsed)) continue;

            // Look up this element's caption from the document-wide assignment decided
            // above (name fast-path + global positional). A miss means the element
            // genuinely has no caption — the artist shortened/moved one and it still
            // binds, but a truly uncaptioned element stays unbound.
            var match     = captionAssign[soLayer.id];
            var textLayer = match ? match.caption : null;
            if (!textLayer) {
                // No caption beside this element — group without caption.
                captionLess.push(parsed.displayName);
                if (CONFIG.dryRun) {
                    log("[step3B] [DRY RUN] would group (no caption) | " + name);
                    grouped++;
                    continue;
                }
                try {
                    groupNoCaption(doc, elementsGroup, soLayer, name);
                    log("[step3B] grouped (no caption) | " + name);
                    grouped++;
                } catch (e) {
                    log("[step3B] ERROR | \"" + name + "\" line " + e.line + ": " + e.message);
                    skipped.push(name + " (error: " + e.message + ")");
                }
                continue;
            }

            var isPlate = isCaptionPlate(parsed);

            if (CONFIG.dryRun) {
                var treatment = isPlate ? "plate" : "standard";
                log("[step3B] [DRY RUN] would group | " + name
                    + " (" + treatment + ") — T layer: \"" + textLayer.name + "\"");
                grouped++;
                continue;
            }

            try {
                if (isPlate) {
                    groupWithPlate(doc, elementsGroup, soLayer, textLayer, name);
                    gcLmCount++;
                } else {
                    groupStandard(doc, elementsGroup, soLayer, textLayer, name);
                }
                log("[step3B] grouped | " + name + " — caption: \"" + textLayer.name
                    + "\" (by " + match.by + ", gap=" + Math.round(match.gap || 0) + "px)");
                grouped++;
            } catch (e) {
                log("[step3B] ERROR | \"" + name + "\" line " + e.line + ": " + e.message);
                skipped.push(name + " (error: " + e.message + ")");
            }
        }

        // Loud, reviewable summary: every needs-caption element that ended up WITHOUT
        // a caption. Genuinely uncaptioned elements (e.g. a map/text element) belong
        // here too — the point is the artist sees the list and confirms it's intended,
        // rather than a caption silently vanishing (the shortened-caption bug).
        if (captionLess.length > 0) {
            log("[step3B] caption-less summary | " + captionLess.length
                + " element(s) with NO caption — confirm intended: " + captionLess.join(", "));
        }

        // Remove the original Caption plate layer once all GC-LM elements are done.
        if (!CONFIG.dryRun && gcLmCount > 0) {
            var capPlate = findLayerByName(doc, "Caption plate");
            if (capPlate) {
                capPlate.remove();
                log("[step3B] removed original Caption plate layer (distributed into groups).");
            }
        }

    } finally {
        app.preferences.rulerUnits = origUnits;
    }

    return { grouped: grouped, skipped: skipped, captionLess: captionLess };
}

// ─── STAMP PATH ───────────────────────────────────────────────────────────────
// ST elements: SO + White Base_Cutline only (no caption layers).

function groupNoCaption(doc, elementsGroup, soLayer, groupName) {
    var wbcLayer = findAdjacentCutline(doc, soLayer);
    var layers   = wbcLayer ? [soLayer, wbcLayer] : [soLayer];
    if (!wbcLayer) {
        log("[step3B] WARN | \"" + groupName
            + "\" — no White Base_Cutline found below SO. "
            + "Ensure Step 3 (white edge) ran before this step.");
    }
    selectAndGroup(elementsGroup, layers, groupName);
}

// ─── STANDARD PATH ────────────────────────────────────────────────────────────
// WC elements and GC non-LM: T + White pill + SO + White Base_Cutline.

function groupStandard(doc, elementsGroup, soLayer, textLayer, groupName) {
    var wbcLayer   = findAdjacentCutline(doc, soLayer);
    var whiteInfo  = createWhiteFromText(doc, textLayer);
    var whiteLayer = whiteInfo.layer;

    var parsedStd = parseLayerName(groupName);
    var dispName  = parsedStd ? parsedStd.displayName : groupName;

    // Conform + seat: rotate text + pill so the pill's inner edge runs parallel to the
    // local border tangent, then kiss the pill into the border (falls back to the SO when
    // no border layer exists). Returns the (rotated) spine + seat metadata (needsReview).
    var seat = seatCaptionConform(doc, wbcLayer ? wbcLayer : soLayer, whiteLayer,
        [textLayer, whiteLayer], whiteInfo.spine, whiteInfo.radius);

    // Carry the real capsule (spine + radius) to Illustrator so Step 6 can rebuild a
    // caption cutline that follows the curve/tilt. Stash AFTER the seat (rotation makes
    // the pre-seat bbox-relative offsets stale): seat.spine is the spine transformed by
    // the same rotate+kiss as the pill, so its offsets to the final pill bbox are exact.
    _stashCaptionSpine(dispName, whiteLayer, seat.spine || whiteInfo.spine, whiteInfo.radius);
    _stashCaptionSeat(dispName, seat);

    var layers = wbcLayer
        ? [textLayer, whiteLayer, soLayer, wbcLayer]
        : [textLayer, whiteLayer, soLayer];

    if (!wbcLayer) {
        log("[step3B] WARN | \"" + groupName
            + "\" — no White Base_Cutline below SO. "
            + "Ensure Step 3 (white edge) ran before this step.");
    }

    selectAndGroup(elementsGroup, layers, groupName);
}

// ─── PLATE PATH ───────────────────────────────────────────────────────────────
// GC-LM elements: SO + T + Caption plate (elongated) + White pill.

function groupWithPlate(doc, elementsGroup, soLayer, textLayer, groupName) {
    var tBounds    = textLayer.bounds;
    var tLeft      = tBounds[0].as("px");
    var tRight     = tBounds[2].as("px");
    var tTop       = tBounds[1].as("px");
    var tCenterX   = (tLeft + tRight) / 2;
    var tWidth     = tRight - tLeft;
    var targetWidth = tWidth + CONFIG.plateWidthPadH * 2;

    // White base: pill sized to caption plate width, positioned below T.
    var whiteX1 = tCenterX - targetWidth / 2;
    var whiteY1 = tTop - CONFIG.platePaddingTop - CONFIG.whiteRectPadV;
    var whiteX2 = whiteX1 + targetWidth;
    var whiteY2 = whiteY1 + CONFIG.whiteHeightPlate;
    var gcPill     = createPillFromRect(doc, whiteX1, whiteY1, whiteX2, whiteY2);
    var whiteLayer = gcPill.layer;

    // Caption plate: duplicate template, elongate, position.
    var plateLayer = null;
    var capPlateTemplate = findLayerByName(doc, "Caption plate");

    if (capPlateTemplate) {
        plateLayer = capPlateTemplate.duplicate(doc, ElementPlacement.PLACEATBEGINNING);
        plateLayer.name = "Caption plate";

        elongateCaptionPlate(plateLayer, targetWidth);

        // Centre horizontally on element, align top with T top - platePaddingTop.
        var pBounds = plateLayer.bounds;
        var pCenterX = (pBounds[0].as("px") + pBounds[2].as("px")) / 2;
        var pTop     = pBounds[1].as("px");
        var targetPlateTop = tTop - CONFIG.platePaddingTop;

        plateLayer.translate(tCenterX - pCenterX, targetPlateTop - pTop);
    } else {
        log("[step3B] WARN | \"" + groupName
            + "\" — no Caption plate layer found in working doc. "
            + "Add Caption_Plate.psd to the source folder and re-run PS_BuildElements.");
    }

    var wbcLayer = findAdjacentCutline(doc, soLayer);
    if (!wbcLayer) {
        log("[step3B] WARN | \"" + groupName
            + "\" — no White Base_Cutline below SO. "
            + "Ensure Step 3 (white edge) ran before this step.");
    }

    // Conform + seat the whole caption assembly (text + pill + plate) against the border.
    // GC-LM sits below the element, so travel resolves to vertical; a tilted local border
    // rotates the rigid plate to follow it. GC's pill is the parametric stadium, so we pass
    // its synthesized straight spine + radius for the analytic seat; seat.spine is ignored
    // (GC keeps the parametric pill on the AI side — only WC carries a spine to Step 6).
    var moveLayers = plateLayer
        ? [textLayer, whiteLayer, plateLayer]
        : [textLayer, whiteLayer];
    var gcSeat = seatCaptionConform(doc, wbcLayer ? wbcLayer : soLayer, whiteLayer,
        moveLayers, gcPill.spine, gcPill.radius);
    var parsedGc = parseLayerName(groupName);
    _stashCaptionSeat(parsedGc ? parsedGc.displayName : groupName, gcSeat);

    // Z-order (top → bottom): T, White pill, Caption plate, SO, White Base_Cutline.
    var layers = [];
    layers.push(textLayer);
    layers.push(whiteLayer);
    if (plateLayer) layers.push(plateLayer);
    layers.push(soLayer);
    if (wbcLayer)   layers.push(wbcLayer);

    selectAndGroup(elementsGroup, layers, groupName);
}

// ─── WHITE BASE HELPERS ───────────────────────────────────────────────────────

// Creates a White pill by stroking the text's CENTERLINE with a round pen of
// diameter = text line-height + whitePenPadPx. This is a capsule (stadium):
// uniform thickness everywhere, true rounded ends, covering the full text height
// including descenders — because the pen diameter is fixed, not derived from the
// local ink profile.
//
// One method handles straight, multi-line, and curved/path text with NO type
// detection. The spine is recovered by sampling the text's vertical centre in
// vertical slices, then low-pass-fitting a quadratic through those samples so
// per-letter ascender/descender wobble averages out:
//   • straight text   → fit collapses to a flat line → exact horizontal stadium
//   • curved/arc text → fit follows the arc → capsule bends along the curve
//   • two-line text   → slice centres sit mid-block, slice heights span both
//                       lines → a tall straight stadium covering both rows
//
// Knobs (CONFIG):
//   whiteSliceStepPx    — slice width for centreline sampling (smaller = finer)
//   whitePenPadPx       — px added to detected line-height → pen diameter
//   whiteStraightSnapPx — if the fitted spine stays within this of flat, force a
//                         perfectly straight pill (kills micro-wobble on straight text)
// Returns { layer, spine:[{x,y}...], radius } — the spine + radius are the actual
// capsule geometry (px), surfaced so the caller can carry them to Illustrator (see
// Mechanism B header). spine is always the one that was filled (straight fallback,
// quad fit, or multi-line override).
function createWhiteFromText(doc, textLayer) {
    var spine = _sampleTextSpine(doc, textLayer); // { pts, heights, bounds }

    var whiteLayer  = doc.artLayers.add();
    whiteLayer.name = "White";

    var bnds = spine ? spine.bounds : layerBoundsPx(textLayer);
    var boxH = bnds[3] - bnds[1];

    var usedSpine, usedRadius;

    // Degenerate sample (too few slices) → fall back to a bounding-box stadium.
    if (!spine || spine.pts.length < 3) {
        usedRadius = boxH / 2 + CONFIG.whitePenPadPx / 2;
        usedSpine  = _straightSpine(bnds[0], bnds[2], (bnds[1] + bnds[3]) / 2);
        _fillCapsule(doc, usedSpine, usedRadius);
    } else {
        var fit = _quadFitSpine(spine.pts, bnds[0], bnds[2]); // { spine, straight }

        // Multi-line captions: the spine sampler reads each column's block-centre,
        // which dips wherever a shorter second line sits. The quad fit turns that
        // dip into a false frown, lifting the pill's ends up into the artwork. A
        // stack of text lines is meant to be a tall straight stadium (see header),
        // so when we detect a second line, override the fit to a flat spine at the
        // block centre. Genuine single-line arcs (e.g. food captions) keep their
        // curve — their pill follows the text and matches the round art beneath.
        if (_isMultiLineText(doc, textLayer)) {
            fit = { spine: _straightSpine(bnds[0], bnds[2], (bnds[1] + bnds[3]) / 2),
                    straight: true };
        }

        // Pen height = full text height. For straight text that's the bounding
        // box (no single column spans accent-to-descender, but the whole box
        // does). For curved text the box is inflated by the arc, so use a high
        // percentile of per-slice heights (≈ one line, accents included) instead.
        var penH = fit.straight
            ? boxH
            : _percentile(spine.heights, CONFIG.whiteCurvedHeightPctile);

        usedRadius = penH / 2 + CONFIG.whitePenPadPx / 2;
        usedSpine  = fit.spine;
        _fillCapsule(doc, usedSpine, usedRadius);
    }

    doc.selection.deselect();
    whiteLayer.move(textLayer, ElementPlacement.PLACEAFTER);
    return { layer: whiteLayer, spine: usedSpine, radius: usedRadius };
}

// Returns the p-quantile (0..1) of a numeric array. Array need not be sorted.
function _percentile(arr, p) {
    var a = arr.slice(0);
    a.sort(function (x, y) { return x - y; });
    var idx = Math.floor(p * (a.length - 1));
    if (idx < 0) idx = 0;
    if (idx > a.length - 1) idx = a.length - 1;
    return a[idx];
}

// ── ANALYTIC CAPSULE SEATING (v1) ───────────────────────────────────────────────
// Re-seats the caption (text + pill, plus any plate) so the White pill's INNER edge
// (the art-facing long side) meets the element's white border, overlapping it by
// CONFIG.captionBorderOverlapPx. The element and its border stay put; the caption
// assembly rotates + slides toward them as one rigid unit.
//
// This works from the capsule geometry we ALREADY have — the spine + radius — and
// touches the raster for only TWO precise probes. The old seater instead sampled 9
// columns of pill+border ink across a BOUNDING-BOX band, PCA-fit a tilt, and drove the
// worst-overlapping strip to depth; that wasted columns on the round caps / art taper
// and, on an overhang, rammed the pill's middle deep into the art (see redesign doc).
//
//   1. ANALYTIC inner edge. The pill is a stadium (spine swept by a disk of radius r).
//      Its inner-edge endpoints are exact: E = spineEnd + r·normal(toward art). No
//      sampling of the pill.
//   2. TWO border probes. Cast a 1px ray from each inner-edge endpoint toward the art
//      and read the first border ink → B0, B1. Only where the pill actually is.
//   3. KISS (v1, pin-E0). Rotate the rigid caption by φ = angle(B0→B1) − angle(E0→E1)
//      about E0, then slide it along the travel axis so E0 lands on B0, submerged by
//      depth d (= captionBorderOverlapPx). E0 is pivot AND target → nothing to
//      re-project; E1 just lands somewhere on the border line, which is fine.
//   4. OVERHANG. If either endpoint's ray finds no border (caption wider than the art's
//      contact zone), inset BOTH ends ALONG THE SPINE by CONFIG.seatShrinkFrac (one balanced
//      shrink — _shrinkAlongSpine, so an arced pill stays on its real inner edge) and
//      re-probe. Still nothing → the caption is too wide for the art: skip the seat +
//      WARN + flag for review (the element still groups/exports). Overhang is a design
//      problem, not something to silently ram into absent art.
//   5. MIDPOINT BULGE. The endpoint kiss is blind to the border BETWEEN the corners: on a
//      convex border (rounded sticker bottom) the middle submerges into the pill by d +
//      sagitta and pokes into the text. Probe the inner-edge MIDPOINT and measure that
//      protrusion analytically (p = sagitta + d, from B0/B1/Bm — no extra seating pass). If
//      p crosses CONFIG.captionMidProtrudeFrac of the pill thickness (T = 2r), relieve it
//      with the SAME balanced shrink as overhang (pins a deeper point → pill backs outward).
//      Still over after one shrink → flag for review. Single shrink budget shared with (4).
//
//   refLayer    — the white border (White Base_Cutline); pass the SO as a fallback.
//   pillLayer   — the White pill.
//   moveLayers  — every layer that travels as one rigid unit (text, pill, plate…).
//   spine       — the capsule spine (px): WC fitted polyline or GC's synthesized 2-point
//                 centreline. Returned transformed in seat.spine (WC carries it to
//                 Illustrator so Step 6's cutline follows the curve/tilt; GC ignores it).
//   radius      — the capsule radius (px).
// Returns { rotDeg, needsReview, spine:[{x,y}…]|null }.
//
// v1 LIMITATIONS (accepted — see docs/caption-seating-redesign.md):
//   • θ from the 2 raw endpoint probes — a pixel groove at an endpoint can tilt the
//     whole caption; the robust live-span line fit is the deferred upgrade.
//   • Flat-chord depth (no sagitta term) — a straight pill can't hug a curved border,
//     so depth d submerges the residual; the profile-settle is the curve-aware fix. Step 5
//     guards the worst symptom (a strong convex midpoint bulge into the text) by shrinking
//     then flagging, but it does NOT make the pill follow the curve — that's still deferred.
//
// ⚠ PS layer.rotate sign: CONFIG.seatRotationSign multiplies the angle fed to
//   layer.rotate(). If captions tilt the WRONG way in validation, flip seatRotationSign
//   1 → -1. _rotateLayersAbout now feeds the SAME signed angle into both the content
//   rotation AND the pivot-correction matrix, so the rigid lock holds for either sign
//   (an earlier version hard-coded the unsigned angle in the matrix and sheared at -1).
function seatCaptionConform(doc, refLayer, pillLayer, moveLayers, spine, radius) {
    var seat = { rotDeg: 0, needsReview: false,
                 spine: spine ? spine.slice(0) : null };

    // We work analytically from the capsule geometry; without it, leave the caption at
    // its Step 3A rough placement rather than guess from bounding boxes.
    if (!spine || spine.length < 1 || !radius || radius <= 0) {
        log("[step3B] WARN | seat skipped — no capsule geometry (spine/radius).");
        seat.needsReview = true;
        return seat;
    }

    var geom = _seatGeometry(refLayer, pillLayer);

    // Steps 1+2: analytic inner-edge endpoints. Steps 3+4: probe + overhang shrink.
    var ends = _innerEdgeEndpoints(spine, radius, geom);
    var E0 = ends.E0, E1 = ends.E1;
    var B0 = _probeBorder(doc, refLayer, geom, E0);
    var B1 = _probeBorder(doc, refLayer, geom, E1);
    var shrunk = false;                       // one shrink budget, shared by overhang + bulge

    if (!B0 || !B1) {
        var sh  = _shrinkAlongSpine(spine, radius, geom, CONFIG.seatShrinkFrac);
        var sB0 = _probeBorder(doc, refLayer, geom, sh.E0);
        var sB1 = _probeBorder(doc, refLayer, geom, sh.E1);
        if (sB0 && sB1) {
            E0 = sh.E0; E1 = sh.E1; B0 = sB0; B1 = sB1; shrunk = true;
            log("[step3B] seat | overhang rescued by "
                + Math.round(CONFIG.seatShrinkFrac * 100) + "% balanced shrink.");
        } else {
            seat.needsReview = true;
            log("[step3B] WARN | caption too wide for art — no border under the inner "
                + "edge even after shrink; seat skipped (element still groups).");
            return seat;
        }
    }

    // Step 4b: convex midpoint bulge. A straight pill seated on its corners is blind to a
    // border that bulges toward the caption BETWEEN them; the middle submerges into the pill
    // by d + sagitta and pokes into the text. Measure that protrusion analytically at the
    // inner-edge midpoint (p = sagitta + d, from B0/B1/Bm — no extra seating pass). If it
    // crosses captionMidProtrudeFrac of the pill thickness (T = 2r; default T/4 = r/2),
    // relieve it by shrinking the seated span along the spine (same rescue as overhang: the
    // kiss then pins a deeper point so the whole pill backs outward). One shrink budget shared
    // with overhang; still over after it → flag for rework.
    if (CONFIG.captionMidProtrudeFrac > 0) {
        var bulgeLimit = CONFIG.captionMidProtrudeFrac * 2 * radius;
        var p = _midProtrusion(B0, B1,
            _probeBorder(doc, refLayer, geom, { x: (E0.x + E1.x) / 2, y: (E0.y + E1.y) / 2 }),
            geom, CONFIG.captionBorderOverlapPx);
        if (p !== null && p > bulgeLimit) {
            if (!shrunk) {
                var bh  = _shrinkAlongSpine(spine, radius, geom, CONFIG.seatShrinkFrac);
                var bB0 = _probeBorder(doc, refLayer, geom, bh.E0);
                var bB1 = _probeBorder(doc, refLayer, geom, bh.E1);
                if (bB0 && bB1) {
                    E0 = bh.E0; E1 = bh.E1; B0 = bB0; B1 = bB1; shrunk = true;
                    var pAfter = _midProtrusion(B0, B1,
                        _probeBorder(doc, refLayer, geom,
                            { x: (E0.x + E1.x) / 2, y: (E0.y + E1.y) / 2 }),
                        geom, CONFIG.captionBorderOverlapPx);
                    log("[step3B] seat | midpoint bulge " + Math.round(p) + "px > limit "
                        + Math.round(bulgeLimit) + "px — relieved by "
                        + Math.round(CONFIG.seatShrinkFrac * 100) + "% shrink to "
                        + (pAfter === null ? "n/a" : Math.round(pAfter) + "px") + ".");
                    p = pAfter;
                }
            }
            if (p !== null && p > bulgeLimit) {
                seat.needsReview = true;
                log("[step3B] WARN | midpoint bulge " + Math.round(p) + "px still > limit "
                    + Math.round(bulgeLimit) + "px after shrink — flagged for rework.");
            }
        }
    }

    // Step 5a: rotation φ = chord(B0→B1) − baseline(E0→E1), pivoted on E0.
    var baseLen = Math.sqrt((E1.x - E0.x) * (E1.x - E0.x)
                          + (E1.y - E0.y) * (E1.y - E0.y));
    if (CONFIG.seatConform && baseLen >= CONFIG.seatBaselineEpsPx) {
        var phi = _normalizeDeg(_chordAngleDeg(B0, B1) - _chordAngleDeg(E0, E1));
        if (Math.abs(phi) <= CONFIG.maxSeatRotationDeg) {
            _rotateLayersAbout(moveLayers, E0, phi);
            if (seat.spine) seat.spine = _rotateSpine(seat.spine, E0, phi);
            seat.rotDeg = phi;
            log("[step3B] seat | rotated " + phi.toFixed(1) + "° to border chord (axis="
                + (geom.travelIsX ? "x" : "y") + ").");
        } else {
            seat.needsReview = true;
            log("[step3B] seat | chord tilt " + phi.toFixed(1)
                + "° exceeds maxSeatRotationDeg — rotation skipped, flagged for review.");
        }
    } else if (CONFIG.seatConform) {
        // Near-zero baseline (circular / 1-char pill): the angle is undefined → kiss only.
        log("[step3B] seat | near-zero baseline — rotation skipped (kiss only).");
    }

    // Step 5b: kiss — slide E0 onto B0 along the travel axis, submerged by depth d. E0 is
    // the rotation pivot (fixed) and B0 is on the stationary border, so both still hold.
    var k = _kissVector(E0, B0, geom, CONFIG.captionBorderOverlapPx);
    _translateLayers(moveLayers, k.tx, k.ty);
    if (seat.spine) seat.spine = _translateSpine(seat.spine, k.tx, k.ty);
    log("[step3B] seat | kissed | axis=" + (geom.travelIsX ? "x" : "y") + " move="
        + Math.round(geom.travelIsX ? k.tx : k.ty) + "px depth="
        + CONFIG.captionBorderOverlapPx + "px");

    if (seat.needsReview) log("[step3B] FLAG | caption seat needs review.");
    return seat;
}

// Travel axis (pill centre → art centre) and its sign. The pill only ever slides along
// this axis; the sign points toward the art (+1 = the larger coordinate). Shared by the
// analytic endpoints, the border probe, and the kiss.
function _seatGeometry(refLayer, pillLayer) {
    var rb = layerBoundsPx(refLayer);
    var pb = layerBoundsPx(pillLayer);
    var dx = (rb[0] + rb[2]) / 2 - (pb[0] + pb[2]) / 2;
    var dy = (rb[1] + rb[3]) / 2 - (pb[1] + pb[3]) / 2;
    var travelIsX = Math.abs(dx) > Math.abs(dy);
    var sign = travelIsX ? (dx >= 0 ? 1 : -1) : (dy >= 0 ? 1 : -1);
    return { travelIsX: travelIsX, sign: sign, rb: rb, pb: pb };
}

// The pill's inner (art-facing) edge endpoints, computed analytically from the capsule
// spine + radius — no raster sampling. E = spineEnd + r·n, where n is the spine normal at
// that end chosen to point toward the art. For a straight spine these are the flat top's
// corners; for a curved/tilted WC spine they follow the curve. Pure geometry.
function _innerEdgeEndpoints(spine, r, geom) {
    var n = spine.length;
    var s0 = spine[0], s1 = spine[n - 1];
    var nextI = (n > 1) ? 1 : 0;            // forward neighbour of the start
    var prevI = (n > 1) ? n - 2 : 0;        // backward neighbour of the end
    var t0 = _unit(spine[nextI].x - s0.x, spine[nextI].y - s0.y);  // tangent at start
    var t1 = _unit(s1.x - spine[prevI].x, s1.y - spine[prevI].y);  // tangent at end
    return { E0: _offsetTowardArt(s0, t0, r, geom),
             E1: _offsetTowardArt(s1, t1, r, geom) };
}

// Offsets point p by r along the spine normal that points toward the art (the normal
// whose dot with the travel direction is positive). A degenerate tangent (single-point
// spine) offsets straight along the travel axis. Pure geometry.
function _offsetTowardArt(p, tan, r, geom) {
    var ux = geom.travelIsX ? geom.sign : 0;
    var uy = geom.travelIsX ? 0 : geom.sign;
    var nx = -tan[1], ny = tan[0];                  // a unit normal to the tangent
    var d  = nx * ux + ny * uy;
    if (d < 0) { nx = -nx; ny = -ny; }              // flip to face the art
    if (Math.abs(d) < 1e-6) { nx = ux; ny = uy; }   // degenerate → use the travel axis
    return { x: p.x + r * nx, y: p.y + r * ny };
}

// Casts a 1px ray from inner-edge endpoint E toward the art and returns the first border
// ink as {x,y}, or null when the ray finds no border (overhang). Reads the border's
// facing edge — the ink extreme nearest the pill — in a 1px-wide strip at E's cross
// coordinate. This is the ONLY raster touch in the seat.
function _probeBorder(doc, refLayer, geom, E) {
    var docW = doc.width.as("px"), docH = doc.height.as("px");
    var cross = geom.travelIsX ? E.y : E.x;         // strip centre on the cross axis
    var c0 = cross - 0.5, c1 = cross + 0.5;
    var rect = geom.travelIsX
        ? [[0, c0], [docW, c0], [docW, c1], [0, c1]]    // y-row  (travel = x)
        : [[c0, 0], [c1, 0], [c1, docH], [c0, docH]];   // x-col  (travel = y)

    loadLayerTransparency(refLayer);
    var b = null;
    try {
        doc.selection.select(rect, SelectionType.INTERSECT, 0, false);
        b = doc.selection.bounds;
    } catch (e) { b = null; }                       // empty intersection → no ink
    try { doc.selection.deselect(); } catch (e2) {}
    if (!b) return null;

    var loV = (geom.travelIsX ? b[0] : b[1]).as("px");   // min on travel axis
    var hiV = (geom.travelIsX ? b[2] : b[3]).as("px");   // max on travel axis
    var edge = (geom.sign > 0) ? loV : hiV;              // facing edge = nearest the pill
    return geom.travelIsX ? { x: edge, y: cross } : { x: cross, y: edge };
}

// Signed angle (deg) of the chord p→q in PS y-down space. Pure geometry.
function _chordAngleDeg(p, q) {
    return Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
}

// Normalises an angle to (-180, 180]. Pure geometry.
function _normalizeDeg(d) {
    while (d <= -180) d += 360;
    while (d >   180) d -= 360;
    return d;
}

// The pill's inner (art-facing) edge point at fraction t (0..1) ALONG THE SPINE — the
// curve-following generalisation of _innerEdgeEndpoints (t=0 → E0, t=1 → E1). Interpolates
// the spine by index fraction (the sampler spaces points ~evenly), then offsets that point
// by r along the LOCAL spine normal toward the art. Unlike a straight chord between the two
// endpoints, this stays ON the (possibly arced) inner edge — so a shrink built from it lands
// on the real pill top, not floating above an arced one. Pure geometry.
function _innerEdgeAt(spine, r, geom, t) {
    var n = spine.length;
    if (n < 2) return _offsetTowardArt(spine[0], _unit(0, 0), r, geom);  // single-point spine
    var f = t * (n - 1);
    var i = Math.floor(f);
    if (i < 0) i = 0;
    if (i > n - 2) i = n - 2;
    var u  = f - i;
    var p0 = spine[i], p1 = spine[i + 1];
    var px = p0.x + u * (p1.x - p0.x);
    var py = p0.y + u * (p1.y - p0.y);
    return _offsetTowardArt({ x: px, y: py },
        _unit(p1.x - p0.x, p1.y - p0.y), r, geom);
}

// Insets both seating endpoints to t = frac and t = 1-frac ALONG THE SPINE (not the chord) —
// the curve-aware balanced shrink that masks an overhanging/bulging seat to its centred live
// span. For a straight spine this equals the old chord inset; for an arced spine it follows
// the curve, so the shrunk anchors sit on the real inner edge (no float → no under-seat gap).
// Pure geometry.
function _shrinkAlongSpine(spine, r, geom, frac) {
    return { E0: _innerEdgeAt(spine, r, geom, frac),
             E1: _innerEdgeAt(spine, r, geom, 1 - frac) };
}

// How far the border at the inner-edge MIDPOINT protrudes INTO the pill, along the travel
// axis: p = sagitta + depth, where sagitta = the midpoint border point Bm's deviation from
// the endpoint chord B0→B1, signed positive toward the pill (a convex border bulges in).
// Bm is probed at the midpoint's cross coordinate (= the average of B0/B1's cross coords),
// so the chord's travel value there is just (B0+B1)/2 — no interpolation needed. The +depth
// folds in the kiss submersion, so p is the white edge's true depth past the inner edge once
// the corners are seated. Returns null when any probe is missing (e.g. a true mid-notch with
// no border above it → ignore). Pure geometry. See seatCaptionConform step 5.
// NOTE: this is the TRAVEL-axis sagitta. After step 5a the inner edge is rotated parallel to
// the B0→B1 chord, so the true protrusion is the PERPENDICULAR distance to that chord =
// (this value)·cos(tilt). The travel-axis measure is thus an UPPER BOUND — conservative: it
// over-flags a strongly tilted seat (by up to 1/cos(maxSeatRotationDeg)) but never lets a real
// bulge slip through. Fine for the near-flat seats we see; a cos(tilt) divide is the deferred
// refinement if a tilted border ever over-flags in validation.
function _midProtrusion(B0, B1, Bm, geom, depth) {
    if (!B0 || !B1 || !Bm) return null;
    var b0 = geom.travelIsX ? B0.x : B0.y;
    var b1 = geom.travelIsX ? B1.x : B1.y;
    var bm = geom.travelIsX ? Bm.x : Bm.y;
    var chordMid = (b0 + b1) / 2;
    var sagitta  = -geom.sign * (bm - chordMid);   // + = Bm deeper into the pill than chord
    return sagitta + depth;
}

// Translation (along the travel axis only) that lands E0 on B0 and submerges the pill
// into the border by depth d. Bidirectional: if the caption already sits deeper than d,
// the move is outward (signed). Pure geometry.
function _kissVector(E0, B0, geom, depth) {
    var dT = (geom.travelIsX ? (B0.x - E0.x) : (B0.y - E0.y)) + geom.sign * depth;
    return geom.travelIsX ? { tx: dT, ty: 0 } : { tx: 0, ty: dT };
}

// Translates each layer rigidly by (tx, ty). No-op below sub-pixel.
function _translateLayers(layers, tx, ty) {
    if (Math.abs(tx) < 1e-9 && Math.abs(ty) < 1e-9) return;
    for (var i = 0; i < layers.length; i++) {
        if (layers[i]) layers[i].translate(tx, ty);
    }
}

// Rotates each layer rigidly about the shared pivot by phiDeg. PS layer.rotate spins a
// layer about its OWN centre, so we rotate the content then translate the (fixed) centre
// to where rotation-about-pivot would put it. R(φ)=[[c,-s],[s,c]] is clockwise in PS's
// y-down space, matching layer.rotate(+)=clockwise (seatRotationSign hedges that).
function _rotateLayersAbout(layers, pivot, phiDeg) {
    if (Math.abs(phiDeg) < 0.01) return;
    // The content is rotated by CONFIG.seatRotationSign * phiDeg (the L.rotate below), so the
    // pivot-correction matrix MUST use the SAME signed angle — otherwise, when seatRotationSign
    // is flipped to -1, the pixels spin one way while each layer's centre is repositioned the
    // other way, shearing the rigid text+pill+plate assembly apart. (At sign=+1 the two agree,
    // which is why this was invisible in validation.)
    var rad = (CONFIG.seatRotationSign * phiDeg) * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
    var i, L, b, cx, cy, ex, ey, nx, ny;
    for (i = 0; i < layers.length; i++) {
        L = layers[i];
        if (!L) continue;
        b = layerBoundsPx(L);
        cx = (b[0] + b[2]) / 2; cy = (b[1] + b[3]) / 2;
        L.rotate(CONFIG.seatRotationSign * phiDeg, AnchorPosition.MIDDLECENTER);
        ex = cx - pivot.x; ey = cy - pivot.y;
        nx = pivot.x + (c * ex - s * ey);
        ny = pivot.y + (s * ex + c * ey);
        L.translate(nx - cx, ny - cy);
    }
}

// Rotates spine points about pivot by R(phiDeg) — the same matrix the layers got, so the
// carried spine stays locked to the rotated pill.
function _rotateSpine(spine, pivot, phiDeg) {
    var rad = phiDeg * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
    var out = [], i, ex, ey;
    for (i = 0; i < spine.length; i++) {
        ex = spine[i].x - pivot.x; ey = spine[i].y - pivot.y;
        out.push({ x: pivot.x + (c * ex - s * ey), y: pivot.y + (s * ex + c * ey) });
    }
    return out;
}

// Translates spine points by (tx,ty) — applied after the kiss so the spine tracks it.
function _translateSpine(spine, tx, ty) {
    var out = [], i;
    for (i = 0; i < spine.length; i++) out.push({ x: spine[i].x + tx, y: spine[i].y + ty });
    return out;
}

// Detects whether the caption is stacked on two (or more) lines, using a single
// cheap probe: a thin horizontal band across the centre of the text's bounding box.
// A single line has its ink (x-height) right at that vertical centre → band inked.
// Two lines have the inter-line GAP at the centre → band empty. The band spans the
// central 50% of the width so a word-space can't masquerade as an empty line.
// Returns true when the centre band holds no ink (i.e. a gap between stacked lines).
function _isMultiLineText(doc, textLayer) {
    var b = layerBoundsPx(textLayer);
    var w = b[2] - b[0], h = b[3] - b[1];
    if (w <= 0 || h <= 0) return false;

    var cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    var halfW  = w * 0.25;   // central 50% of width
    var halfBand = h * 0.05; // thin ±5%-height band at the vertical centre

    // loadLayerTransparency switches the active layer to textLayer; restore it
    // afterwards so the caller's target layer (the White pill) stays active for Fill.
    var prevActive = doc.activeLayer;
    loadLayerTransparency(textLayer);
    var inked = true;
    try {
        doc.selection.select(
            [[cx - halfW, cy - halfBand], [cx + halfW, cy - halfBand],
             [cx + halfW, cy + halfBand], [cx - halfW, cy + halfBand]],
            SelectionType.INTERSECT, 0, false);
        doc.selection.bounds; // throws if the intersection is empty
    } catch (e) {
        inked = false; // no ink at the vertical centre → gap between lines
    }
    try { doc.selection.deselect(); } catch (e2) {}
    try { doc.activeLayer = prevActive; } catch (e3) {}
    return !inked;
}

// Samples the text's vertical centre across vertical slices. Returns
// { pts:[{x,y}...], heights:[...], bounds:[L,T,R,B] } in px, or null if no ink.
// heights = per-slice ink span; the caller picks a percentile for the pen size
// on curved text (the bounding box is used for straight text instead).
function _sampleTextSpine(doc, textLayer) {
    var bnds = layerBoundsPx(textLayer);
    var L = bnds[0], T = bnds[1], R = bnds[2], B = bnds[3];
    if (R - L <= 0 || B - T <= 0) return null;

    var step    = CONFIG.whiteSliceStepPx;
    var pts     = [];
    var heights = [];

    var x;
    for (x = L; x < R; x += step) {
        var xb = (x + step < R) ? x + step : R;

        // Intersect the text alpha with this column; read its vertical span.
        loadLayerTransparency(textLayer);
        try {
            doc.selection.select(
                [[x, T - 1], [xb, T - 1], [xb, B + 1], [x, B + 1]],
                SelectionType.INTERSECT, 0, false);
        } catch (eSel) { continue; }   // INTERSECT yielding empty throws

        var sb;
        try { sb = doc.selection.bounds; } catch (eB) { continue; } // empty slice
        var st = sb[1].as("px"), sBot = sb[3].as("px");
        if (sBot - st <= 0) continue;

        pts.push({ x: (x + xb) / 2, y: (st + sBot) / 2 });
        heights.push(sBot - st);
    }

    if (pts.length === 0) return null;

    return { pts: pts, heights: heights, bounds: bnds };
}

// Builds a smooth spine over [x0,x1] by least-squares quadratic fit of the
// sampled centre points: y = a(x-xm)^2 + b(x-xm) + c (x shifted by mean for
// conditioning). If the fit stays within whiteStraightSnapPx of a flat line, it
// snaps to a perfectly straight spine. Returns { spine:[{x,y}...], straight:bool };
// the straight flag tells the caller which pen-height metric to use.
function _quadFitSpine(pts, x0, x1) {
    var n = pts.length, i;

    var xm = 0, ym = 0;
    for (i = 0; i < n; i++) { xm += pts[i].x; ym += pts[i].y; }
    xm /= n; ym /= n;

    var S0 = n, S1 = 0, S2 = 0, S3 = 0, S4 = 0, Ty = 0, Txy = 0, Tx2y = 0;
    for (i = 0; i < n; i++) {
        var dx = pts[i].x - xm, y = pts[i].y;
        var dx2 = dx * dx;
        S1 += dx; S2 += dx2; S3 += dx2 * dx; S4 += dx2 * dx2;
        Ty += y; Txy += dx * y; Tx2y += dx2 * y;
    }

    // Solve the 3x3 normal equations [[S4 S3 S2],[S3 S2 S1],[S2 S1 S0]]·[a,b,c]=[Tx2y,Txy,Ty]
    var a = 0, b = 0, c = ym;
    var sol = _solve3(S4, S3, S2, S3, S2, S1, S2, S1, S0, Tx2y, Txy, Ty);
    if (sol) { a = sol[0]; b = sol[1]; c = sol[2]; }

    function yAt(px) { var d = px - xm; return a * d * d + b * d + c; }

    // Straightness check: max deviation of fit from a flat line at mean y.
    var flat = ym, maxDev = 0;
    var probes = 16, p;
    for (p = 0; p <= probes; p++) {
        var px = x0 + (x1 - x0) * (p / probes);
        var dev = Math.abs(yAt(px) - flat);
        if (dev > maxDev) maxDev = dev;
    }
    if (maxDev <= CONFIG.whiteStraightSnapPx) {
        return { spine: _straightSpine(x0, x1, flat), straight: true };
    }

    var out = [], M = 40;
    for (p = 0; p <= M; p++) {
        var sx = x0 + (x1 - x0) * (p / M);
        out.push({ x: sx, y: yAt(sx) });
    }
    return { spine: out, straight: false };
}

// Two-point horizontal spine at height y over [x0,x1].
function _straightSpine(x0, x1, y) {
    return [{ x: x0, y: y }, { x: x1, y: y }];
}

// Solves a 3x3 linear system by Cramer's rule. Returns [x,y,z] or null if singular.
function _solve3(a11, a12, a13, a21, a22, a23, a31, a32, a33, b1, b2, b3) {
    function det3(m11, m12, m13, m21, m22, m23, m31, m32, m33) {
        return m11 * (m22 * m33 - m23 * m32)
             - m12 * (m21 * m33 - m23 * m31)
             + m13 * (m21 * m32 - m22 * m31);
    }
    var D = det3(a11, a12, a13, a21, a22, a23, a31, a32, a33);
    if (Math.abs(D) < 1e-9) return null;
    var Dx = det3(b1, a12, a13, b2, a22, a23, b3, a32, a33);
    var Dy = det3(a11, b1, a13, a21, b2, a23, a31, b3, a33);
    var Dz = det3(a11, a12, b1, a21, a22, b2, a31, a32, b3);
    return [Dx / D, Dy / D, Dz / D];
}

// Offsets a spine polyline by ±radius into a closed capsule polygon (rounded
// ends), selects it, and fills white. The active layer must already be the
// target White layer.
function _fillCapsule(doc, spine, radius) {
    var poly = _capsulePolygon(spine, radius);
    doc.selection.select(poly, SelectionType.REPLACE, 0, true);
    doc.selection.fill(solidWhite());
}

// Builds the capsule outline: top edge (spine + r·normal) along the spine, a
// semicircular cap around the last point, the bottom edge back, then a cap
// around the first point. Returns an array of [x,y] for Selection.select().
function _capsulePolygon(spine, r) {
    var n = spine.length, i;
    var top = [], bot = [];

    for (i = 0; i < n; i++) {
        // Local tangent from neighbours (forward/backward diff at the ends).
        var p0 = spine[i > 0 ? i - 1 : i];
        var p1 = spine[i < n - 1 ? i + 1 : i];
        var tx = p1.x - p0.x, ty = p1.y - p0.y;
        var len = Math.sqrt(tx * tx + ty * ty) || 1;
        var nx = -ty / len, ny = tx / len;   // unit normal
        top.push([spine[i].x + r * nx, spine[i].y + r * ny]);
        bot.push([spine[i].x - r * nx, spine[i].y - r * ny]);
    }

    // Tangent directions at the two ends (outward = forward at end, back at start).
    var endT  = _unit(spine[n - 1].x - spine[n - 2 >= 0 ? n - 2 : 0].x,
                      spine[n - 1].y - spine[n - 2 >= 0 ? n - 2 : 0].y);
    var startT = _unit(spine[0].x - spine[1 < n ? 1 : 0].x,
                       spine[0].y - spine[1 < n ? 1 : 0].y);

    var poly = [];
    var k;
    for (k = 0; k < top.length; k++) poly.push(top[k]);                // top L→R
    _appendCap(poly, spine[n - 1], r, top[n - 1], bot[n - 1], endT);   // right cap
    for (k = bot.length - 1; k >= 0; k--) poly.push(bot[k]);           // bottom R→L
    _appendCap(poly, spine[0], r, bot[0], top[0], startT);             // left cap
    return poly;
}

// Appends a semicircular arc of `steps` points around centre C (radius r), from
// vector v0 to v1, sweeping through the outward direction `through`.
function _appendCap(poly, C, r, fromPt, toPt, through) {
    var steps = 10;
    var a0 = Math.atan2(fromPt[1] - C.y, fromPt[0] - C.x);
    var a1 = Math.atan2(toPt[1]   - C.y, toPt[0]   - C.x);
    // Pick sweep direction (±π) whose midpoint aligns with the outward tangent.
    var sweep = a1 - a0;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;
    while (sweep > Math.PI)  sweep -= 2 * Math.PI;
    var midAng = a0 + sweep / 2;
    if (Math.cos(midAng) * through[0] + Math.sin(midAng) * through[1] < 0) {
        sweep += (sweep > 0 ? -2 * Math.PI : 2 * Math.PI);
    }
    var s;
    for (s = 1; s < steps; s++) {
        var ang = a0 + sweep * (s / steps);
        poly.push([C.x + r * Math.cos(ang), C.y + r * Math.sin(ang)]);
    }
}

function _unit(x, y) {
    var len = Math.sqrt(x * x + y * y) || 1;
    return [x / len, y / len];
}

// Creates a White pill layer from explicit pixel coordinates.
// Used for the plate treatment where White dimensions are fixed rather than
// derived from text bounds.
// Pill = centre rectangle + two semicircular end caps (three fills on one layer).
// Returns { layer, spine:[{x,y},{x,y}], radius } — the spine is the straight centreline
// between the two cap centres and radius = h/2, so the analytic seat (seatCaptionConform)
// can treat the GC plate pill exactly like a WC capsule (one unified path, no type
// branch). seat.spine is not carried to Illustrator for GC (parametric pill there).
function createPillFromRect(doc, x1, y1, x2, y2) {
    var h = y2 - y1;
    var r = h / 2; // radius = half height → fully rounded ends

    doc.activeLayer = doc.layers[0]; // add new layer at top of stack so it's above textLayer
    var layer       = doc.artLayers.add();
    layer.name      = "White";
    var white       = solidWhite();

    // Centre rectangle body (between end caps).
    doc.selection.select([[x1+r, y1], [x2-r, y1], [x2-r, y2], [x1+r, y2]]);
    doc.selection.fill(white);

    // Left semicircular end cap.
    selectEllipse(doc, x1, y1, x1 + h, y2);
    doc.selection.fill(white);

    // Right semicircular end cap.
    selectEllipse(doc, x2 - h, y1, x2, y2);
    doc.selection.fill(white);

    doc.selection.deselect();
    var midY = (y1 + y2) / 2;
    // Normal pill (width >= 2r): the spine is the straight centreline between the two cap
    // centres, x1+r .. x2-r. For a very short caption narrower than the pill height
    // (width < 2r), x1+r would exceed x2-r and the spine would REVERSE — flipping E0/E1 in
    // the seat and swinging the chord angle ~180°. Collapse to a single centre point there;
    // _innerEdgeEndpoints treats a 1-point spine as a degenerate (circular) pill → kiss-only.
    var spine = ((x2 - x1) > 2 * r)
        ? [ { x: x1 + r, y: midY }, { x: x2 - r, y: midY } ]
        : [ { x: (x1 + x2) / 2, y: midY } ];
    return { layer: layer, spine: spine, radius: r };
}

// loadLayerTransparency() is defined in psUtils.jsx.

// Sets an elliptical marquee selection (replaces current selection).
// Coordinates are in pixels; ruler must be set to PIXELS before calling.
function selectEllipse(doc, left, top, right, bottom) {
    var desc      = new ActionDescriptor();
    var selRef    = new ActionReference();
    selRef.putProperty(charIDToTypeID("Chnl"), charIDToTypeID("fsel"));
    desc.putReference(charIDToTypeID("null"), selRef);
    var ellipDesc = new ActionDescriptor();
    ellipDesc.putUnitDouble(charIDToTypeID("Top "), charIDToTypeID("#Pxl"), top);
    ellipDesc.putUnitDouble(charIDToTypeID("Left"), charIDToTypeID("#Pxl"), left);
    ellipDesc.putUnitDouble(charIDToTypeID("Btom"), charIDToTypeID("#Pxl"), bottom);
    ellipDesc.putUnitDouble(charIDToTypeID("Rght"), charIDToTypeID("#Pxl"), right);
    desc.putObject(charIDToTypeID("T   "), charIDToTypeID("Elps"), ellipDesc);
    executeAction(charIDToTypeID("setd"), desc, DialogModes.NO);
}

// ─── CAPTION PLATE HELPERS ────────────────────────────────────────────────────

// Elongates a Caption plate group using 3-piece (L/C/R) scaling.
// L and R end caps are never scaled; only C (the centre fill) is stretched.
// plateGroup must be a LayerSet with child layers named "L", "C", and "R".
function elongateCaptionPlate(plateGroup, targetWidth) {
    var lLayer = null, cLayer = null, rLayer = null;

    for (var i = 0; i < plateGroup.layers.length; i++) {
        var child = plateGroup.layers[i];
        if (child.name === "L")      lLayer = child;
        else if (child.name === "C") cLayer = child;
        else if (child.name === "R") rLayer = child;
    }

    if (!lLayer || !cLayer || !rLayer) {
        log("[step3B] WARN | Caption plate group is missing L/C/R child layers. "
            + "Expected layers named \"L\", \"C\", \"R\". Using plate as-is.");
        return;
    }

    var lWidth = lLayer.bounds[2].as("px") - lLayer.bounds[0].as("px");
    var rWidth = rLayer.bounds[2].as("px") - rLayer.bounds[0].as("px");
    var cCurrentWidth = cLayer.bounds[2].as("px") - cLayer.bounds[0].as("px");
    var cTargetWidth  = targetWidth - lWidth - rWidth;

    if (cTargetWidth <= 0) {
        log("[step3B] WARN | Caption plate targetWidth (" + targetWidth + "px) is narrower "
            + "than L+R end caps (" + (lWidth + rWidth) + "px). Using plate as-is.");
        return;
    }

    if (cCurrentWidth <= 0) {
        log("[step3B] WARN | Caption plate C layer has zero width. Using plate as-is.");
        return;
    }

    var scalePct = (cTargetWidth / cCurrentWidth) * 100;

    // Scale C horizontally from its left edge, keeping height unchanged.
    cLayer.resize(scalePct, 100, AnchorPosition.MIDDLELEFT);

    // Slide R layer to abut the right edge of the scaled C.
    var cRight = cLayer.bounds[2].as("px");
    var rLeft  = rLayer.bounds[0].as("px");
    rLayer.translate(cRight - rLeft, 0);
}

// ─── LAYER SELECTION AND GROUPING ─────────────────────────────────────────────

// Groups ArtLayers into a new sub-LayerSet inside elementsGroup.
// Uses elementsGroup.layerSets.add() so the sub-group is created directly
// inside Elements — avoiding PS 2026's restriction on moving or duplicating
// a LayerSet into another LayerSet. Callers iterate in reverse (bottom-to-top)
// so each new sub-group at position 0 of elementsGroup gives the correct final z-order.
function selectAndGroup(elementsGroup, layers, groupName) {
    if (!layers || layers.length === 0) return;

    var group = elementsGroup.layerSets.add();
    group.name = groupName;

    // Move ArtLayers in bottom-to-top order with PLACEATBEGINNING to preserve z-order.
    for (var i = layers.length - 1; i >= 0; i--) {
        layers[i].move(group, ElementPlacement.PLACEATBEGINNING);
    }
}

// selectLayerById, addLayerToSelectionById, buildCaptionAssignment, layerBoundsPx defined in psUtils.jsx.

// ─── UTILITY ──────────────────────────────────────────────────────────────────

// Finds the White Base_Cutline layer immediately below soLayer in the stack.
// Step 3 (white edge) always places it at soIndex + 1.
// Returns null if not found or if the next layer has a different name.
function findAdjacentCutline(doc, soLayer) {
    for (var i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i] === soLayer) {
            var next = (i + 1 < doc.layers.length) ? doc.layers[i + 1] : null;
            if (next && next.name === CONFIG.whiteEdgeLayerName) {
                return next;
            }
            return null; // next layer exists but is not a WBC
        }
    }
    return null;
}
