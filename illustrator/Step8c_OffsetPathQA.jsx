// Step8c_OffsetPathQA.jsx — Phase function only.
// #included by AI_ExportFinal.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Playbook §6 "Offset Path QA": after the manual pencil pass, check that every
// cut line is at least 2mm from its neighbours and doesn't exceed the safe area.
//
// The manual workflow used 1mm offset paths as a visual indicator of spacing — a
// human needs something to eyeball. The automation measures inter-cutline distance
// directly (pure geometry, no DOM offset operation). Result is the same check,
// without the intermediate visual layer.
//
//   1. Spacing QA — minimum sampled distance between cut-line pairs < 2mm → fail.
//      Uses minPolygonSetDistance(), tolerant of sticker-scale sample density.
//   2. Margin QA — cut line bounding box exceeds safe area → fail.
//      Safe area: computed from artboard top-left + CONFIG working area + margins.
//
// Violations are drawn on a single shared "Layout QA" overlay layer (CONFIG.qaLayerName),
// NOT recoloured onto the cut line itself — the artist toggles one layer to show/
// hide all QA, and the real cut lines stay pristine 0.25pt black. The overlay uses
// two decoupled channels so an element with BOTH problems is shown correctly:
//   • ELEMENT HALO (neutral blue) — a translucent fill over each flagged sticker,
//     spottable at full-sheet zoom no matter how tiny the actual violation is. It
//     only says "look here"; it carries no type, so a both-issue element is fine.
//   • TYPED BADGES (fixed size, so zoom-out visibility doesn't depend on violation
//     magnitude) — SPACING = a red disc at the sub-2mm gap (+ thin connector);
//     MARGIN = an amber arrow in the gutter pointing inward (which way to pull in),
//     plus the amber overhang-sliver fill for zoomed-in detail.
// A both-issue sticker gets one halo + a red disc at its pinch + an amber arrow at
// its margin edge. The same layer also carries StepQA's NQI pocket fills. The caller
// halts on flagged > 0 so the artist can fix and re-run.
//
// Idempotent on two fronts: (1) every cut line is restroked to canonical 0.25pt
// black up front — clearing any legacy in-place red from older runs; (2) this phase
// runs first, so it RESETS the QA layer (rebuilds it empty) before drawing, so a
// fixed layout loses its stale markers and repeated runs converge. StepQA appends
// its pockets to the same layer (reset=false). This lets the check serve both the
// on-demand AI_LayoutQA pipeline and the AI_ExportFinal guard.
//
// Returns: { checked, flagged }

function runOffsetPathQA(doc) {

    // ── 1. Locate Cutlines layer ──────────────────────────────────────────────
    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        log("[step8c] ERROR | Cutlines layer not found: " + CONFIG.cutlinesLayerName);
        return { checked: 0, flagged: 0 };
    }

    if (CONFIG.dryRun) {
        log("[step8c] [DRY RUN] would check spacing (< " + CONFIG.spacingThresholdMm
            + "mm) and margin on all cut lines.");
        return { checked: 0, flagged: 0 };
    }

    // ── 2. Collect and sample all cut lines ──────────────────────────────────
    // Per-phase wall timing (ms via Date — $.hiresTimer is unreliable in Illustrator)
    // to pinpoint the bottleneck on a slow run. Advisory; stripped by the golden diff.
    var _tSample = 0, _tSpacing = 0, _tMargin = 0, _tOverlay = 0;
    var _mark = (new Date()).getTime();

    var cutlines = _collectCutlines(cutlinesLayer);
    log("[step8c] collected " + cutlines.length + " cut line(s).");

    var threshPt = mmToPoints(CONFIG.spacingThresholdMm);
    var records = [], i;

    for (i = 0; i < cutlines.length; i++) {
        var cl = cutlines[i];
        var polys, bounds;

        if (cl.kind === "stamp") {
            var vb = cl.item.visibleBounds;       // [left, top, right, bottom]
            polys  = [_vbToPolygon(vb)];
            bounds = vb;
        } else {
            polys  = samplePathToPolygons(cl.item, CONFIG.qaSpacingSampleSteps);
            bounds = cl.item.geometricBounds;
        }

        records.push({
            name:         cl.name,
            kind:         cl.kind,
            item:         cl.item,
            polys:        polys,
            bounds:       bounds,
            spacingFail:  false,
            marginFail:   false
        });
    }

    _tSample = (new Date()).getTime() - _mark; _mark = (new Date()).getTime();

    // ── 2b. Reset prior QA flags (idempotent) ─────────────────────────────────
    // Restroke every cut line to the canonical 0.25pt black before re-flagging.
    // Every cut line in this layer is 0.25pt black by construction (Step 6/8a/8b
    // restroke), so the reset never clobbers a legitimately different stroke — it
    // only clears stale red from a prior run. Stamps (PlacedItem) can't be
    // recolored, so they're skipped here just as they are when flagging.
    var resetPt = CONFIG.cutlineStrokePt || 0.25;
    var black   = blackCmyk();
    for (i = 0; i < records.length; i++) {
        if (records[i].kind === "path") {
            strokeRecursive(records[i].item, resetPt, black);
        }
    }

    // ── 3. Spacing QA — pairwise, bbox-prefiltered ────────────────────────────
    // minPolygonSetDistanceEx returns the witness pair (the two closest points)
    // so the overlay can draw a connector across the actual gap — not just recolor
    // the whole outline.
    var spacingPairs = 0;
    var spacingMarks = [];   // { ax, ay, bx, by } — gap endpoints per failing pair
    var a, b;
    for (a = 0; a < records.length; a++) {
        for (b = a + 1; b < records.length; b++) {
            if (!_bboxNear(records[a].bounds, records[b].bounds, threshPt)) continue;
            var dm = minPolygonSetDistanceEx(records[a].polys, records[b].polys);
            if (dm.dist < threshPt) {
                records[a].spacingFail = true;
                records[b].spacingFail = true;
                spacingPairs++;
                spacingMarks.push(dm);
                log("[step8c] FLAG | spacing " + _fmtMm(dm.dist) + "mm (< "
                    + CONFIG.spacingThresholdMm + "mm) | "
                    + records[a].name + " <-> " + records[b].name);
            }
        }
    }

    _tSpacing = (new Date()).getTime() - _mark; _mark = (new Date()).getTime();

    // ── 4. Margin QA — cut-line bounds within safe area ──────────────────────
    // For each violator, record WHICH edges it crosses so the overlay can fill the
    // overhang sliver beyond each (the amber "out of bounds" cue, see _drawFlagOverlay).
    var marginRect  = _resolveMarginRect(doc);
    var marginItems = 0;
    if (marginRect) {
        for (i = 0; i < records.length; i++) {
            if (boundsWithin(records[i].bounds, marginRect, 0.5)) continue;
            records[i].marginFail  = true;
            records[i].marginEdges = _crossedMarginEdges(records[i].bounds, marginRect);
            marginItems++;
            log("[step8c] FLAG | cut line exceeds margin | " + records[i].name);
        }
    } else {
        log("[step8c] WARN | no margin rect resolved — margin QA skipped.");
    }

    _tMargin = (new Date()).getTime() - _mark; _mark = (new Date()).getTime();

    // ── 5. Draw flags on the shared QA overlay layer ──────────────────────────
    // Cut lines are NEVER recoloured in place — every QA visual goes on one
    // toggleable "Layout QA" layer (shared with the NQI pocket overlay). This phase
    // runs first, so it resets the layer (clearing stale markers); StepQA appends.
    var flagged = 0;
    for (i = 0; i < records.length; i++) {
        if (records[i].spacingFail || records[i].marginFail) flagged++;
    }

    if (!CONFIG.dryRun) {
        var qaLayer = getOrCreateQALayer(doc, CONFIG.qaLayerName, true);
        if (CONFIG.showFlagMarkers !== false) {
            _drawFlagOverlay(qaLayer, records, spacingMarks, marginRect);
        }
    }

    _tOverlay = (new Date()).getTime() - _mark;

    log("[timing] step8c | sample=" + _tSample
        + " spacing=" + _tSpacing + " margin=" + _tMargin
        + " overlay=" + _tOverlay + " (ms)");

    log("[step8c] done | checked=" + records.length + " flagged=" + flagged
        + " (spacing: " + spacingPairs + " pair(s); margin: " + marginItems + ")");
    return { checked: records.length, flagged: flagged };
}


// ── Private helpers ───────────────────────────────────────────────────────────

// Renders the QA flags onto the shared overlay layer, on two decoupled channels so
// "which element" (zoom-out) and "what kind of problem, where" (zoom-in) never
// collide — and an element with BOTH problems is shown correctly:
//   ELEMENT HALO (neutral blue) — a translucent fill over every flagged sticker, so
//     it's spottable at full-sheet zoom no matter how small the violation is.
//   BADGES (fixed size → zoom-out visible, colour+shape coded by type):
//     • SPACING → a red disc at each sub-2mm gap (+ a thin connector for zoom-in).
//     • MARGIN  → an amber arrow in the gutter at each crossed edge, pointing inward
//       (which way to pull it in), + the amber overhang sliver fill for zoom-in.
//   Type lives on the per-issue badges, not the element, so a both-issue sticker
//   gets one halo + a red disc at its pinch + an amber arrow at its margin edge.
// Stamps (PlacedItem) can't be filled; their halo + overhang use the bounding box.
function _drawFlagOverlay(qaLayer, records, spacingMarks, marginRect) {
    var red       = redCmyk();
    var amber      = amberCmyk();
    var halo       = haloCmyk();
    var connPt     = CONFIG.flagStrokePt;
    var discR      = mmToPoints(2.5);  // spacing badge disc radius (~5mm dia)
    var arrowPt    = mmToPoints(6);    // margin arrow length
    var gutterPt   = mmToPoints(5);    // arrow offset into the gutter from the safe line
    var fillSteps  = CONFIG.qaMarginFillSteps || 40;  // finer sampling for the sliver
    var haloOpacity = 20;
    var i;

    // Channel 1 — element halo over every flagged sticker (drawn first = behind).
    var halos = 0;
    for (i = 0; i < records.length; i++) {
        var r = records[i];
        if (!(r.spacingFail || r.marginFail)) continue;
        if (r.kind === "path") {
            qaHaloElement(qaLayer, r.item, halo, haloOpacity);
        } else {
            qaFillPolygon(qaLayer, _vbToPolygon(r.bounds), halo, haloOpacity);
        }
        halos++;
    }

    // Channel 2a — margin overhang sliver fills (zoom-in detail; behind badges).
    var slivers = 0;
    if (marginRect) {
        for (i = 0; i < records.length; i++) {
            if (records[i].marginFail) {
                slivers += _fillMarginOverhang(qaLayer, records[i], marginRect, amber, fillSteps);
            }
        }
    }

    // Channel 2b — spacing badges: red disc at the gap midpoint + a thin connector.
    for (i = 0; i < spacingMarks.length; i++) {
        var m = spacingMarks[i];
        qaDrawSegment(qaLayer, m.ax, m.ay, m.bx, m.by, red, connPt, 100);
        qaDrawDot(qaLayer, (m.ax + m.bx) / 2, (m.ay + m.by) / 2, discR, red, 90);
    }

    // Channel 2c — margin badges: amber inward-pointing arrow in the gutter.
    var arrows = 0;
    if (marginRect) {
        for (i = 0; i < records.length; i++) {
            if (records[i].marginFail) {
                arrows += _drawMarginArrows(qaLayer, records[i], marginRect,
                                            amber, arrowPt, gutterPt);
            }
        }
    }

    log("[step8c] overlay | drew flags on \"" + CONFIG.qaLayerName + "\" layer | "
        + halos + " halo(s), " + spacingMarks.length + " spacing badge(s), "
        + arrows + " margin arrow(s), " + slivers + " sliver(s)");
}

// Draws an inward-pointing amber arrow in the margin gutter for each safe-area edge
// the record crosses. Positioned at the element's mid-extent along that edge, offset
// gutterPt into the gutter, pointing toward the safe area. Returns arrows drawn.
function _drawMarginArrows(qaLayer, record, mR, amber, arrowPt, gutterPt) {
    var bb = record.bounds;                 // [l, t, r, b] (AI y-up)
    var cxMid = (bb[0] + bb[2]) / 2;
    var cyMid = (bb[1] + bb[3]) / 2;
    var e = record.marginEdges, n = 0;

    if (e.left)   { qaDrawArrow(qaLayer, mR[0] - gutterPt, cyMid,  1,  0, arrowPt, amber, 100); n++; }
    if (e.right)  { qaDrawArrow(qaLayer, mR[2] + gutterPt, cyMid, -1,  0, arrowPt, amber, 100); n++; }
    if (e.top)    { qaDrawArrow(qaLayer, cxMid, mR[1] + gutterPt,  0, -1, arrowPt, amber, 100); n++; }
    if (e.bottom) { qaDrawArrow(qaLayer, cxMid, mR[3] - gutterPt,  0,  1, arrowPt, amber, 100); n++; }
    return n;
}

// Fills the overhang of one margin violator: for each safe-area edge the record
// crosses, clip its outline to the OUTSIDE half-plane of that edge and fill the
// result amber. Paths are re-sampled finely (fillSteps) so the sliver hugs the
// curve; stamps fall back to their bounding-box polygon. Returns slivers drawn.
function _fillMarginOverhang(qaLayer, record, mR, amber, fillSteps) {
    var polys;
    if (record.kind === "stamp") {
        polys = [_vbToPolygon(record.item.visibleBounds)];
    } else {
        polys = samplePathToPolygons(record.item, fillSteps);
    }

    // Each entry: [axis, value, keepGreater] for the outside half-plane of an edge.
    var e = record.marginEdges, clips = [];
    if (e.left)   clips.push(["x", mR[0], false]); // outside-left  : x <= left
    if (e.right)  clips.push(["x", mR[2], true ]); // outside-right : x >= right
    if (e.top)    clips.push(["y", mR[1], true ]); // outside-top   : y >= top
    if (e.bottom) clips.push(["y", mR[3], false]); // outside-bottom: y <= bottom

    var count = 0, p, c;
    for (p = 0; p < polys.length; p++) {
        for (c = 0; c < clips.length; c++) {
            var sliver = clipPolygonToHalfPlane(polys[p], clips[c][0], clips[c][1], clips[c][2]);
            if (qaFillPolygon(qaLayer, sliver, amber, 50)) count++;
        }
    }
    return count;
}

// Returns { left, right, top, bottom } booleans for which safe-area edges a
// bounding box bb = [l,t,r,b] crosses. mR = [left, top, right, bottom] (AI y-up:
// top > bottom). 0.5pt tolerance matches the boundsWithin gate.
function _crossedMarginEdges(bb, mR) {
    return {
        left:   bb[0] < mR[0] - 0.5,
        right:  bb[2] > mR[2] + 0.5,
        top:    bb[1] > mR[1] + 0.5,
        bottom: bb[3] < mR[3] - 0.5
    };
}

// Returns [{ name, item, kind }] per cutline unit in the Cutlines layer.
//   GroupItem (separable bundle) → kind "path", item = visible cutline member
//   bare PathItem / CompoundPathItem → kind "path", item = itself
//   PlacedItem (stamp) → kind "stamp", item = the PlacedItem (sampled via bounds)
//
// Descends child SUBLAYERS first: a Cutlines layer can nest child layers, and
// their contents are NOT in the parent's pageItems. Artist deliverables routinely
// tuck stamps/loose paths into a sublayer (the same case StepQA's _qa_collectPaths
// defends against) — skipping them would let those items evade the spacing/margin
// gate entirely. Each GroupItem is kept whole (one per-sticker unit); only its
// visible fused member is measured. NOTE: this stays a separate routine from
// StepQA's _qa_collectPaths by design — 8c needs per-sticker UNITS (compare
// sticker-to-sticker), StepQA needs every LEAF path (occupancy is a union).
function _collectCutlines(container) {
    var out = [], i, j, inner;

    // Sublayers first (Layer containers have .layers; GroupItems don't — and we
    // never recurse into groups, we treat them as units).
    if (container.layers) {
        for (i = 0; i < container.layers.length; i++) {
            inner = _collectCutlines(container.layers[i]);
            for (j = 0; j < inner.length; j++) out.push(inner[j]);
        }
    }

    for (i = 0; i < container.pageItems.length; i++) {
        var item = container.pageItems[i];
        if (item.parent !== container) continue;   // direct children only (pageItems recurses groups)
        var tn = item.typename;

        if (tn === "GroupItem") {
            var cut = findGroupMember(item, "");
            if (cut) {
                out.push({ name: item.name, item: cut, kind: "path" });
            } else {
                log("[step8c] SKIP | group has no visible cutline | " + item.name);
            }
        } else if (tn === "PathItem" || tn === "CompoundPathItem") {
            out.push({ name: item.name || "(unnamed)", item: item, kind: "path" });
        } else if (tn === "PlacedItem") {
            out.push({ name: item.name || "(unnamed)", item: item, kind: "stamp" });
        } else {
            log("[step8c] SKIP | " + tn + " | " + (item.name || "(unnamed)"));
        }
    }
    return out;
}

// Converts a visibleBounds/geometricBounds [left, top, right, bottom] (AI y-up)
// into a four-point polygon [{x, y}, …] for distance sampling.
function _vbToPolygon(vb) {
    return [
        { x: vb[0], y: vb[1] },  // top-left
        { x: vb[2], y: vb[1] },  // top-right
        { x: vb[2], y: vb[3] },  // bottom-right
        { x: vb[0], y: vb[3] }   // bottom-left
    ];
}

// Returns true if two geometricBounds [l, t, r, b] (AI y-up) are within
// threshPt of each other — fast prefilter before the exact distance check.
function _bboxNear(g1, g2, threshPt) {
    if (g1[2] + threshPt < g2[0] || g2[2] + threshPt < g1[0]) return false;
    if (g1[3] - threshPt > g2[1] || g2[3] - threshPt > g1[1]) return false;
    return true;
}

// Resolves the safe-area rectangle as geometricBounds [left, top, right, bottom].
// Delegates to aiUtils.marginRect so QA, the drawn margin band (buildWorkingDocument),
// and the nesting placement (Step 7B) all share one boundary.
function _resolveMarginRect(doc) {
    var r = marginRect(doc);
    log("[step8c] margin | "
        + CONFIG.workingAreaWidthMm + "x" + CONFIG.workingAreaHeightMm + "mm safe area.");
    return r;
}

// Formats a distance in points as mm to one decimal place for the log.
function _fmtMm(pt) {
    return Math.round((pt / 2.834645) * 10) / 10;
}
