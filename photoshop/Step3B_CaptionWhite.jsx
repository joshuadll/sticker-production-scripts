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
// Returns: { grouped, skipped[] }
//
// ── Caption-spine carry (Mechanism B) ─────────────────────────────────────────
// The White pill is a capsule fitted to the text spine (curved/tilted captions
// follow the art). Step 6 in Illustrator rebuilds the caption parametrically, so
// to make the cutline FOLLOW that curve we hand the real spine+radius across the
// PS→AI seam. createWhiteFromText computes them; we stash them here keyed by
// display name (in PSD px, as offsets from the White pill's pre-snap bbox so the
// later snapCaptionToBorder translation is irrelevant). PSAI's writeElementsFile
// re-anchors them to the final White bounds and writes them to the sidecar.
// WC-only consumer (GC keeps the parametric pill). PSAI always runs this step in
// the same session as the sidecar write, so every WC caption always carries a
// spine — Step 6 relies on that (it builds the WC capsule unconditionally).

var WC_CAPTION_SPINES = {};   // displayName -> { off:[{dx,dy}...], radius:Number }

// Records a caption's spine offsets (relative to the White pill's current bbox
// top-left, in px) + capsule radius, keyed by display name. snapCaptionToBorder
// only translates the pill, so bbox-relative offsets survive the move unchanged.
function _stashCaptionSpine(displayName, whiteLayer, spine, radius) {
    if (!displayName || !spine || spine.length < 2 || !radius) return;
    var b = _layerBoundsPx(whiteLayer);   // [L,T,R,B] at the current (pre-snap) position
    var off = [];
    for (var i = 0; i < spine.length; i++) {
        off.push({ dx: spine[i].x - b[0], dy: spine[i].y - b[1] });
    }
    WC_CAPTION_SPINES[displayName] = { off: off, radius: radius };
}

function runCaptionWhite(doc) {
    var origUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;

    var grouped  = 0;
    var skipped  = [];
    var gcLmCount = 0;  // track how many GC-LM elements used the caption plate

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

            // Find matching T layer: a TEXT layer whose name equals the display name.
            var textLayer = findTextLayerByDisplayName(doc, parsed.displayName);
            if (!textLayer) {
                // No caption text placed — group without caption.
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
                log("[step3B] grouped | " + name);
                grouped++;
            } catch (e) {
                log("[step3B] ERROR | \"" + name + "\" line " + e.line + ": " + e.message);
                skipped.push(name + " (error: " + e.message + ")");
            }
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

    return { grouped: grouped, skipped: skipped };
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

    // Carry the real capsule (spine + radius) to Illustrator so Step 6 can rebuild
    // a caption cutline that follows the curve, not an axis-aligned bbox pill.
    // Stash BEFORE snapCaptionToBorder: offsets are bbox-relative, so the upcoming
    // translation doesn't matter (see Mechanism B header).
    var parsedStd = parseLayerName(groupName);
    _stashCaptionSpine(parsedStd ? parsedStd.displayName : groupName,
        whiteLayer, whiteInfo.spine, whiteInfo.radius);

    // Re-seat text + pill so the pill overlaps the white border (falls back to the
    // SO when no border layer exists). Travels along pill-centre → art-centre.
    snapCaptionToBorder(doc, wbcLayer ? wbcLayer : soLayer, whiteLayer,
        [textLayer, whiteLayer]);

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
    var whiteLayer = createPillFromRect(doc, whiteX1, whiteY1, whiteX2, whiteY2);

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

    // Re-seat the whole caption assembly (text + pill + plate) so the pill overlaps
    // the white border. GC-LM sits below the element, so travel resolves to vertical.
    var moveLayers = plateLayer
        ? [textLayer, whiteLayer, plateLayer]
        : [textLayer, whiteLayer];
    snapCaptionToBorder(doc, wbcLayer ? wbcLayer : soLayer, whiteLayer, moveLayers);

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

    var bnds = spine ? spine.bounds : _layerBoundsPx(textLayer);
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

// Returns layer.bounds as plain px numbers [L, T, R, B] (ruler must be PIXELS).
function _layerBoundsPx(layer) {
    var b = layer.bounds;
    return [b[0].as("px"), b[1].as("px"), b[2].as("px"), b[3].as("px")];
}

// Re-seats the caption (text + pill, plus any extra layers) so the White pill
// overlaps the element's white border by CONFIG.captionBorderOverlapPx — measured
// against the ACTUAL ink of both shapes, not their bounding boxes. The element and
// its border stay put; the caption assembly slides toward them along ONE axis.
//
//   refLayer   — the white border (White Base_Cutline) the pill must fuse with;
//                pass the SO as a fallback when no border layer exists.
//   pillLayer  — the White pill (its leading edge is what overlaps the border).
//   moveLayers — every layer that travels as one rigid unit (text, pill, plate…).
//
// Universal in direction. The caption may sit below, above, left, or right of the
// element; the algorithm is identical, just measured along whichever axis separates
// them. Two ideas make it work:
//
//   1. Travel axis = the dominant axis from the pill's centre to the art's centre
//      (below/above → y, left/right → x). The pill only ever moves along this axis.
//
//   2. Why bin along the OTHER (cross) axis instead of comparing bounding boxes:
//      both shapes are irregular. A round plate reaches furthest toward the caption
//      at its centre; an arced caption reaches furthest toward the plate at its ends.
//      Comparing bbox edges lines up points that are far apart on the cross axis —
//      the boxes "touch" while the real ink has a gap. So we slice the overlap band
//      into strips across the cross axis, read each shape's real leading edge per
//      strip, and translate so the WORST strip (least overlap) reaches overlapPx.
//      Anchoring the worst strip guarantees every strip overlaps by at least that
//      much → a solid seam, no floating gap. (Anchoring the best strip would leave a
//      one-point bridge while the rest float.)
function snapCaptionToBorder(doc, refLayer, pillLayer, moveLayers) {
    var rb = _layerBoundsPx(refLayer);
    var pb = _layerBoundsPx(pillLayer);

    // Direction from pill centre → art centre. Dominant component = travel axis.
    var dx = (rb[0] + rb[2]) / 2 - (pb[0] + pb[2]) / 2;
    var dy = (rb[1] + rb[3]) / 2 - (pb[1] + pb[3]) / 2;
    var travelIsX = Math.abs(dx) > Math.abs(dy);
    var sign      = travelIsX ? (dx >= 0 ? 1 : -1) : (dy >= 0 ? 1 : -1); // +1 toward larger coord

    // Cross-axis band where both shapes exist — contact can only happen here.
    var lo = travelIsX ? Math.max(rb[1], pb[1]) : Math.max(rb[0], pb[0]);
    var hi = travelIsX ? Math.min(rb[3], pb[3]) : Math.min(rb[2], pb[2]);

    var n = CONFIG.snapColumns || 9;
    // pickMax = true → take the shape's MAX edge on the travel axis (right/bottom),
    // false → MIN edge (left/top). The pill leads toward the art (extreme in +sign);
    // the art faces the pill (extreme in −sign).
    var pillEdge = (hi - lo > 4) ? _edgeProfile(doc, pillLayer, travelIsX, lo, hi, n, sign > 0) : [];
    var artEdge  = (hi - lo > 4) ? _edgeProfile(doc, refLayer,  travelIsX, lo, hi, n, sign < 0) : [];

    // Gap measured along the +sign travel direction: positive = pill short of art.
    //   gap = sign · (artFacingEdge − pillLeadingEdge)
    var maxGap = null;
    for (var i = 0; i < pillEdge.length; i++) {
        if (!pillEdge[i] || !artEdge[i]) continue;
        var gap = sign * (artEdge[i].v - pillEdge[i].v);
        if (maxGap === null || gap > maxGap) maxGap = gap;
    }

    var move; // signed distance to travel along +sign
    if (maxGap === null) {
        // No shared-ink strip (caption outside the art's cross-span, or an opaque
        // ref layer). Fall back to bbox leading/facing edges.
        var pLead = (sign > 0) ? (travelIsX ? pb[2] : pb[3]) : (travelIsX ? pb[0] : pb[1]);
        var aFace = (sign > 0) ? (travelIsX ? rb[0] : rb[1]) : (travelIsX ? rb[2] : rb[3]);
        move = sign * (aFace - pLead) + CONFIG.captionBorderOverlapPx;
        log("[step3B] snapped caption (bbox fallback) | axis=" + (travelIsX ? "x" : "y")
            + " sign=" + sign + " move=" + Math.round(sign * move) + "px");
    } else {
        // Drive the worst strip to exactly overlapPx of overlap.
        move = maxGap + CONFIG.captionBorderOverlapPx;
        log("[step3B] snapped caption | axis=" + (travelIsX ? "x" : "y") + " sign=" + sign
            + " maxGap=" + Math.round(maxGap) + " move=" + Math.round(sign * move) + "px");
    }

    var t  = sign * move;
    var tx = travelIsX ? t : 0;
    var ty = travelIsX ? 0 : t;
    for (var j = 0; j < moveLayers.length; j++) {
        if (moveLayers[j]) moveLayers[j].translate(tx, ty);
    }
}

// Samples a layer's real ink edge per strip across the cross axis [lo, hi].
//   travelIsX — true: strips are y-rows, edge measured on x; false: x-columns, edge on y.
//   pickMax   — true: take the MAX edge on the travel axis (right/bottom);
//               false: the MIN edge (left/top).
// Returns an array of length n: { c: strip-centre on cross axis, v: edge on travel
// axis }, or null where a strip holds no ink. Uses the transparency selection so
// concave/arced shapes are measured truthfully, not as bounding boxes.
function _edgeProfile(doc, layer, travelIsX, lo, hi, n, pickMax) {
    var out  = [];
    var span = hi - lo;
    if (span <= 0 || n < 1) return out;

    var w    = span / n;
    var docW = doc.width.as("px");
    var docH = doc.height.as("px");

    for (var i = 0; i < n; i++) {
        var c0 = lo + i * w;
        var c1 = c0 + w;
        // Strip spans [c0,c1] on the cross axis, the full document on the travel axis.
        var rect = travelIsX
            ? [[0, c0], [docW, c0], [docW, c1], [0, c1]]   // y-row  (travel = x)
            : [[c0, 0], [c1, 0], [c1, docH], [c0, docH]];  // x-col  (travel = y)

        loadLayerTransparency(layer);  // selection = full layer ink
        var b = null;
        try {
            doc.selection.select(rect, SelectionType.INTERSECT);
            b = doc.selection.bounds;
        } catch (e) {
            b = null; // empty intersection → no ink in this strip
        }

        if (b) {
            var loV = (travelIsX ? b[0] : b[1]).as("px"); // min edge on travel axis
            var hiV = (travelIsX ? b[2] : b[3]).as("px"); // max edge on travel axis
            out.push({ c: (c0 + c1) / 2, v: pickMax ? hiV : loV });
        } else {
            out.push(null);
        }
    }
    try { doc.selection.deselect(); } catch (e2) {}
    return out;
}


// Detects whether the caption is stacked on two (or more) lines, using a single
// cheap probe: a thin horizontal band across the centre of the text's bounding box.
// A single line has its ink (x-height) right at that vertical centre → band inked.
// Two lines have the inter-line GAP at the centre → band empty. The band spans the
// central 50% of the width so a word-space can't masquerade as an empty line.
// Returns true when the centre band holds no ink (i.e. a gap between stacked lines).
function _isMultiLineText(doc, textLayer) {
    var b = _layerBoundsPx(textLayer);
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
    var bnds = _layerBoundsPx(textLayer);
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
    return layer;
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

// selectLayerById, addLayerToSelectionById, findTextLayerByDisplayName defined in psUtils.jsx.

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
