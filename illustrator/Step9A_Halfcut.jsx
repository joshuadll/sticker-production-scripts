// Step9A_Halfcut.jsx — Phase function only.
// #included by AI_ExportFinal.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Draws the half-cut line for every named GC/WC element (Phase 1 of Step 9).
// Junction Y = top of the hidden "[Display Name] plate" subpath. Crossing X
// endpoints are found by bezier ray intersection on the fused cutline, so the
// half-cut meets the Unite boundary exactly where element art transitions to
// the caption plate — not a bounding-box approximation.
//
// Returns: { placed: N, flagged: M, flags: [{name, reason}, ...] }

function runHalfcut(doc) {

    if (CONFIG.dryRun) {
        log("[step9a] [DRY RUN] would draw half-cut lines for GC/WC elements.");
        return { placed: 0, flagged: 0, flags: [] };
    }

    var halfcutLayer = getOrCreateHalfcutLayer(doc);
    if (!halfcutLayer) {
        log("[step9a] ERROR | could not get or create halfcut layer.");
        return { placed: 0, flagged: 0, flags: [] };
    }

    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        log("[step9a] ERROR | Cutlines layer not found: " + CONFIG.cutlinesLayerName);
        return { placed: 0, flagged: 0, flags: [] };
    }

    var items = _collectHalfcutItems(cutlinesLayer);
    log("[step9a] found " + items.length + " GC/WC item(s) for half-cut.");

    var placed = 0, flags = [], i;

    for (i = 0; i < items.length; i++) {
        var entry = items[i];
        log("[step9a] processing | " + entry.name);
        var result = _placeNamedHalfcut(halfcutLayer, entry);
        if (result.ok) {
            placed++;
            log("[step9a] placed | " + entry.name);
        } else {
            flags.push({ name: entry.name, reason: result.reason });
            log("[step9a] FLAG | " + entry.name + " | " + result.reason);
        }
    }

    log("[step9a] done | placed=" + placed + " flagged=" + flags.length);
    return { placed: placed, flagged: flags.length, flags: flags };
}


// ── Private helpers ───────────────────────────────────────────────────────────

// Returns all top-level GroupItems in the Cutlines layer whose note identifies
// them as GC or WC (the elements that have a caption plate seam).
function _collectHalfcutItems(cutlinesLayer) {
    var out = [], i, item, note;
    for (i = 0; i < cutlinesLayer.pageItems.length; i++) {
        item = cutlinesLayer.pageItems[i];
        if (item.parent !== cutlinesLayer) continue;
        if (item.typename !== "GroupItem") continue;
        note = parseNote(item.note);
        if (note && (note.styleCode === "GC" || note.styleCode === "WC")) {
            out.push({ name: item.name, group: item });
        }
    }
    return out;
}

// Draws the half-cut at the exact Y where the fused cutline transitions from
// element art to caption plate. Uses bezier ray intersection — not bounds.
function _placeNamedHalfcut(halfcutLayer, entry) {
    var plate = findGroupMember(entry.group, " plate");
    if (!plate) {
        return { ok: false, reason: "plate subpath not found in group" };
    }

    var cutline = findGroupMember(entry.group, "");
    if (!cutline) {
        return { ok: false, reason: "cutline not found in group" };
    }

    var junctionY = plate.geometricBounds[1]; // top of plate = art/caption junction
    var crossings  = _cutlineCrossingsAtY(cutline, junctionY);
    var ext        = mmToPoints(CONFIG.halfcutExtendMm);
    var x1, x2;

    if (crossings.length >= 2) {
        x1 = crossings[0];
        x2 = crossings[crossings.length - 1];
    } else {
        log("[step9a] WARN | expected 2 crossings at junction Y, got "
            + crossings.length + " — using bounds fallback | " + entry.group.name);
        x1 = plate.geometricBounds[0];
        x2 = plate.geometricBounds[2];
    }

    drawHalfcutLine(halfcutLayer, x1 - ext, junctionY, x2 + ext, junctionY);
    return { ok: true };
}

// Returns a sorted array of X values where pathItem's outline crosses targetY
// (AI y-up). Handles PathItem and CompoundPathItem. Uses coarse scan + bisection.
// Reuses _bezierPoint() from aiUtils.jsx.
function _cutlineCrossingsAtY(pathItem, targetY) {
    var out = [], i;
    if (pathItem.typename === "PathItem") {
        _crossingsInSubPath(pathItem, targetY, out);
    } else if (pathItem.typename === "CompoundPathItem") {
        for (i = 0; i < pathItem.pathItems.length; i++) {
            _crossingsInSubPath(pathItem.pathItems[i], targetY, out);
        }
    }
    out.sort(function(a, b) { return a - b; });
    return out;
}

// Walks one PathItem's bezier segments. For each segment crossing targetY,
// bisects to find the precise X and pushes it into out[].
function _crossingsInSubPath(subPath, targetY, out) {
    var pts   = subPath.pathPoints;
    var n     = pts.length;
    var limit = subPath.closed ? n : n - 1;
    var STEPS  = 64;
    var BISECT = 20;
    var i, j, k, t, lo, hi, mid, ptA, ptB, curY;

    for (i = 0; i < limit; i++) {
        var next = (i + 1) % n;
        var p0 = pts[i].anchor;
        var p1 = pts[i].rightDirection;
        var p2 = pts[next].leftDirection;
        var p3 = pts[next].anchor;

        var prevY = p0[1], prevT = 0;

        for (j = 1; j <= STEPS; j++) {
            t    = j / STEPS;
            ptA  = _bezierPoint(p0, p1, p2, p3, t);
            curY = ptA.y;

            if ((prevY > targetY) !== (curY > targetY)) {
                lo = prevT; hi = t;
                for (k = 0; k < BISECT; k++) {
                    mid = (lo + hi) / 2;
                    ptB = _bezierPoint(p0, p1, p2, p3, mid);
                    if ((ptB.y > targetY) === (prevY > targetY)) {
                        lo = mid;
                    } else {
                        hi = mid;
                    }
                }
                ptB = _bezierPoint(p0, p1, p2, p3, (lo + hi) / 2);
                out.push(ptB.x);
            }
            prevY = curY;
            prevT = t;
        }
    }
}
