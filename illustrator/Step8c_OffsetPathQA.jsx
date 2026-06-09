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
// Violations are flagged red on the cut line itself. The caller halts on
// flagged > 0 so the artist can fix and re-run.
//
// Idempotent: every cut line is restroked to the canonical 0.25pt black BEFORE
// re-flagging, so a cut line the artist has since fixed loses its stale red and
// repeated runs converge. This lets the same check serve both the on-demand
// AI_LayoutQA pipeline (run many times as the layout iterates) and the
// AI_ExportFinal guard.
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
    var spacingPairs = 0;
    var a, b;
    for (a = 0; a < records.length; a++) {
        for (b = a + 1; b < records.length; b++) {
            if (!_bboxNear(records[a].bounds, records[b].bounds, threshPt)) continue;
            var dist = minPolygonSetDistance(records[a].polys, records[b].polys);
            if (dist < threshPt) {
                records[a].spacingFail = true;
                records[b].spacingFail = true;
                spacingPairs++;
                log("[step8c] FLAG | spacing " + _fmtMm(dist) + "mm (< "
                    + CONFIG.spacingThresholdMm + "mm) | "
                    + records[a].name + " <-> " + records[b].name);
            }
        }
    }

    // ── 4. Margin QA — cut-line bounds within safe area ──────────────────────
    var marginRect  = _resolveMarginRect(doc);
    var marginItems = 0;
    if (marginRect) {
        for (i = 0; i < records.length; i++) {
            if (boundsWithin(records[i].bounds, marginRect, 0.5)) continue;
            records[i].marginFail = true;
            marginItems++;
            log("[step8c] FLAG | cut line exceeds margin | " + records[i].name);
        }
    } else {
        log("[step8c] WARN | no margin rect resolved — margin QA skipped.");
    }

    // ── 5. Apply red flags ────────────────────────────────────────────────────
    var red = redCmyk();
    var flagged = 0;
    for (i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.spacingFail || r.marginFail) {
            if (r.kind === "path") {
                strokeRecursive(r.item, CONFIG.flagStrokePt, red);
            } else {
                log("[step8c] NOTE | stamp violation (cannot recolor PlacedItem) | " + r.name);
            }
            flagged++;
        }
    }

    log("[step8c] done | checked=" + records.length + " flagged=" + flagged
        + " (spacing: " + spacingPairs + " pair(s); margin: " + marginItems + ")");
    return { checked: records.length, flagged: flagged };
}


// ── Private helpers ───────────────────────────────────────────────────────────

// Returns [{ name, item, kind }] per top-level item in the Cutlines layer.
//   GroupItem (separable bundle) → kind "path", item = visible cutline member
//   bare PathItem / CompoundPathItem → kind "path", item = itself
//   PlacedItem (stamp) → kind "stamp", item = the PlacedItem (sampled via bounds)
function _collectCutlines(cutlinesLayer) {
    var out = [], i;
    for (i = 0; i < cutlinesLayer.pageItems.length; i++) {
        var item = cutlinesLayer.pageItems[i];
        if (item.parent !== cutlinesLayer) continue;
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
