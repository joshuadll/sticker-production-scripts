// StepQA_Halfcut.jsx — Phase function only. #included by AI_LayoutQA.jsx.
// Requires: aiUtils.jsx, CONFIG in scope. Advisory ONLY (never gates export).
//
// APPENDS blue marks to the shared "Layout QA" overlay (Step 8c reset it first, StepQA
// appends). Per GC/WC/tab element it calls validateHalfcut and draws:
//   missing    → a translucent blue halo of the element's cut contour + a blue badge dot
//   undershoot → a blue dot on the short endpoint + a connector to the nearest cut point
// Real half-cut / cut geometry is never touched. Returns { checked, flagged, flags }.

function runHalfcutQA(doc) {
    if (CONFIG.dryRun) {
        log("[stepQA-halfcut] [DRY RUN] would flag missing/undershoot half-cuts.");
        return { checked: 0, flagged: 0, flags: [] };
    }
    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) { log("[stepQA-halfcut] ERROR | Cutlines layer not found."); return { checked: 0, flagged: 0, flags: [] }; }

    var items = _collectHalfcutItems(cutlinesLayer);   // shared with Step 9A (same file set)
    var overlay = getOrCreateQALayer(doc, CONFIG.qaLayerName, false);   // append, don't reset
    var blue = halfcutFlagRgb();

    var flags = [], i;
    for (i = 0; i < items.length; i++) {
        var group = items[i].group;
        var res = validateHalfcut(doc, group);
        if (res.ok) { log("[stepQA-halfcut] ok | " + items[i].name); continue; }
        flags.push({ name: items[i].name, reason: res.reason });
        if (res.reason === "missing") {
            _qaHalfcutMissing(overlay, group, blue);
        } else {
            _qaHalfcutUndershoot(overlay, group, res.hc, res.cutPoly, blue);
        }
        log("[stepQA-halfcut] FLAG | " + items[i].name + " | " + res.reason);
    }
    log("[stepQA-halfcut] done | checked=" + items.length + " flagged=" + flags.length);
    return { checked: items.length, flagged: flags.length, flags: flags };
}

// MISSING: translucent halo of the cut contour + a badge dot at its top-centre.
function _qaHalfcutMissing(overlay, group, blue) {
    var cut = findGroupMember(group, "");
    if (!cut) return;
    qaHaloElement(overlay, cut, blue, 16);
    var b = cut.geometricBounds;   // [l, t, r, b] (AI y-up)
    qaDrawDot(overlay, (b[0] + b[2]) / 2, b[1], mmToPoints(2.5), blue, 90);
}

// UNDERSHOOT: dot on each short endpoint + a connector to the nearest cut-contour point.
// hc + cutPoly come from validateHalfcut (already resolved — no re-fetch, no layer creation).
// If no endpoint can be marked (a degenerate / non-finite half-cut), fall back to the
// whole-element halo so the flagged element is still locatable on the overlay.
function _qaHalfcutUndershoot(overlay, group, hc, cutPoly, blue) {
    var drawn = 0;
    if (hc && hc.pathPoints && hc.pathPoints.length >= 2 && cutPoly) {
        var pts = hc.pathPoints, minGap = mmToPoints(1);
        var ends = [ { x: pts[0].anchor[0], y: pts[0].anchor[1] },
                     { x: pts[pts.length - 1].anchor[0], y: pts[pts.length - 1].anchor[1] } ];
        var e;
        for (e = 0; e < ends.length; e++) {
            var p = ends[e];
            if (!_isEndpointShort(p, cutPoly, minGap)) continue;
            if (!isFinite(p.x) || !isFinite(p.y)) continue;   // short but undrawable
            var near = _nearestPointOnPolygon(p, cutPoly);
            qaDrawSegment(overlay, p.x, p.y, near.x, near.y, blue, mmToPoints(0.35), 100);
            qaDrawDot(overlay, p.x, p.y, mmToPoints(1.2), blue, 90);
            drawn++;
        }
    }
    if (drawn === 0) _qaHalfcutMissing(overlay, group, blue);   // couldn't pinpoint — mark the element
}
