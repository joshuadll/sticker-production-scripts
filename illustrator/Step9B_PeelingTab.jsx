// Step9B_PeelingTab.jsx — Phase function only.
// #included by AI_AfterPencil.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Places the peeling tab asset and draws the half-cut line for stamp elements
// and unnamed paths (Phase 2 of Step 9). These are elements without a caption
// plate — either PlacedItems (stamps) or GroupItems with ST/no note.
//
// Tab selection: "PEEL HERE" if longest horizontal edge >= CONFIG.peelingTabMinLengthMm,
// else "Half Circle". PlacedItems use visibleBounds bottom edge as the peel surface;
// Compound Path is skipped for PlacedItems (flagged for manual application).
//
// Returns: { placed: N, flagged: M, flags: [{name, reason}, ...] }

function runPeelingTab(doc) {

    if (CONFIG.dryRun) {
        log("[step9b] [DRY RUN] would place peeling tabs for stamps/unnamed elements.");
        return { placed: 0, flagged: 0, flags: [] };
    }

    var halfcutLayer = getOrCreateHalfcutLayer(doc);
    if (!halfcutLayer) {
        log("[step9b] ERROR | could not get or create halfcut layer.");
        return { placed: 0, flagged: 0, flags: [] };
    }

    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        log("[step9b] ERROR | Cutlines layer not found: " + CONFIG.cutlinesLayerName);
        return { placed: 0, flagged: 0, flags: [] };
    }

    var items = _collectTabItems(cutlinesLayer);
    log("[step9b] found " + items.length + " stamp/unnamed item(s) for peeling tab.");

    var placed = 0, flags = [], i;

    for (i = 0; i < items.length; i++) {
        var entry = items[i];
        log("[step9b] processing | " + entry.name + " | " + entry.kind);
        var result = _placeTabAndHalfcut(doc, halfcutLayer, entry);
        if (result.ok) {
            placed++;
            log("[step9b] placed | " + entry.name);
        } else {
            flags.push({ name: entry.name, reason: result.reason });
            log("[step9b] FLAG | " + entry.name + " | " + result.reason);
        }
    }

    log("[step9b] done | placed=" + placed + " flagged=" + flags.length);
    return { placed: placed, flagged: flags.length, flags: flags };
}


// ── Private helpers ───────────────────────────────────────────────────────────

// Returns all non-GC/WC items from the Cutlines layer:
//   GroupItem (ST/no note) → kind "unnamed"   (analyse cutline child)
//   PlacedItem             → kind "stamp"     (bounding-box bottom edge)
//   bare PathItem/CompoundPathItem → kind "unnamed"
function _collectTabItems(cutlinesLayer) {
    var out = [], i, item, note, cutline;
    for (i = 0; i < cutlinesLayer.pageItems.length; i++) {
        item = cutlinesLayer.pageItems[i];
        if (item.parent !== cutlinesLayer) continue;
        var tn = item.typename;

        if (tn === "GroupItem") {
            note = parseNote(item.note);
            if (note && (note.styleCode === "GC" || note.styleCode === "WC")) {
                continue; // handled by Step9A
            }
            cutline = findGroupMember(item, "");
            out.push({
                name: item.name,
                kind: "unnamed",
                item: cutline ? cutline : item
            });
        } else if (tn === "PlacedItem") {
            out.push({ name: item.name || "(unnamed)", kind: "stamp", item: item });
        } else if (tn === "PathItem" || tn === "CompoundPathItem") {
            out.push({ name: item.name || "(unnamed)", kind: "unnamed", item: item });
        } else {
            log("[step9b] SKIP | " + tn + " | " + (item.name || "(unnamed)"));
        }
    }
    return out;
}

// Places tab asset, positions it flush to the peel edge, applies Compound Path
// (where possible), and draws the half-cut at the flat edge.
function _placeTabAndHalfcut(doc, halfcutLayer, entry) {
    var isStamp  = (entry.kind === "stamp");
    var pathItem = entry.item;

    // ── Find the peel surface ──────────────────────────────────────────────
    var seg;
    if (isStamp) {
        var vb  = pathItem.visibleBounds; // [left, top, right, bottom]
        var bbW = vb[2] - vb[0];
        seg = {
            startX: vb[0], startY: vb[3],
            endX:   vb[2], endY:   vb[3],
            lengthMm: bbW / 2.834645
        };
        log("[step9b] stamp | using bounding-box bottom edge ("
            + Math.round(seg.lengthMm * 10) / 10 + "mm) | " + entry.name);
    } else {
        seg = _findLongestHorizontalSeg(pathItem);
        if (!seg) {
            return { ok: false, reason: "no approximately-horizontal segment found" };
        }
    }

    // ── Choose tab shape ───────────────────────────────────────────────────
    var shapeName = (seg.lengthMm >= CONFIG.peelingTabMinLengthMm)
        ? CONFIG.peelingTabGroupName
        : CONFIG.halfCircleGroupName;
    log("[step9b] " + entry.name + " | edge "
        + Math.round(seg.lengthMm * 10) / 10 + "mm → " + shapeName);

    // ── Load and paste tab asset ───────────────────────────────────────────
    var pastedTab = _pasteTabAsset(doc, shapeName);
    if (!pastedTab) {
        return { ok: false,
            reason: "tab asset not found: \"" + shapeName
                + "\" — check CONFIG.peelingTabAssetPath, peelingTabGroupName, halfCircleGroupName" };
    }

    // ── Position: top edge flush with flat edge, centred horizontally ──────
    _positionTab(pastedTab, seg);

    // ── Compound Path ──────────────────────────────────────────────────────
    if (!isStamp) {
        var compoundOk = _applyCompoundPath(pathItem, pastedTab);
        if (!compoundOk) {
            log("[step9b] WARN | compound path failed for " + entry.name
                + " — apply Pathfinder manually.");
        }
    } else {
        log("[step9b] NOTE | stamp " + entry.name
            + " — compound path skipped (PlacedItem); apply Pathfinder manually.");
    }

    // ── Half-cut at the flat edge ──────────────────────────────────────────
    var ext = mmToPoints(CONFIG.halfcutExtendMm);
    drawHalfcutLine(halfcutLayer,
        seg.startX - ext, seg.startY,
        seg.endX   + ext, seg.startY);

    return { ok: true };
}

// Finds the longest run of approximately-horizontal sample segments (< 5° from
// horizontal). Returns { startX, startY, endX, endY, lengthMm } or null.
function _findLongestHorizontalSeg(pathItem) {
    var polys = samplePathToPolygons(pathItem, 12);
    if (!polys || polys.length === 0) return null;

    var maxAngleRad = 5 * Math.PI / 180;
    var bestLenPt = 0;
    var best = null;

    var p, poly, i, nx, dx, dy, segLenPt, angle;
    var inRun, runStartX, runStartY, runLenPt;

    for (p = 0; p < polys.length; p++) {
        poly = polys[p];
        inRun = false; runStartX = 0; runStartY = 0; runLenPt = 0;

        for (i = 0; i < poly.length; i++) {
            nx = (i + 1) % poly.length;
            dx = poly[nx].x - poly[i].x;
            dy = poly[nx].y - poly[i].y;
            segLenPt = Math.sqrt(dx * dx + dy * dy);
            if (segLenPt === 0) continue;

            angle = Math.atan2(Math.abs(dy), Math.abs(dx));

            if (angle <= maxAngleRad) {
                if (!inRun) {
                    runStartX = poly[i].x;
                    runStartY = poly[i].y;
                    runLenPt  = 0;
                    inRun = true;
                }
                runLenPt += segLenPt;
            } else {
                if (inRun && runLenPt > bestLenPt) {
                    bestLenPt = runLenPt;
                    best = {
                        startX: runStartX, startY: runStartY,
                        endX:   poly[i].x,  endY:  poly[i].y,
                        lengthMm: runLenPt / 2.834645
                    };
                }
                inRun = false;
            }
        }
        if (inRun && runLenPt > bestLenPt) {
            var last = poly[poly.length - 1];
            bestLenPt = runLenPt;
            best = {
                startX: runStartX, startY: runStartY,
                endX:   last.x,    endY:   last.y,
                lengthMm: runLenPt / 2.834645
            };
        }
    }

    return best;
}

// Opens CONFIG.peelingTabAssetPath (or reuses if already open), finds the group
// named shapeName, copies it and pastes into the active (production) doc.
// Returns the pasted PageItem or null on failure.
function _pasteTabAsset(productionDoc, shapeName) {
    if (!CONFIG.peelingTabAssetPath || CONFIG.peelingTabAssetPath === "") {
        log("[step9b] WARN | peelingTabAssetPath not configured.");
        return null;
    }

    var assetFile = new File(CONFIG.peelingTabAssetPath);
    if (!assetFile.exists) {
        log("[step9b] WARN | asset file not found: " + CONFIG.peelingTabAssetPath);
        return null;
    }

    var assetDoc = null, i;
    for (i = 0; i < app.documents.length; i++) {
        try {
            if (app.documents[i].fullName.fsName === assetFile.fsName) {
                assetDoc = app.documents[i];
                break;
            }
        } catch (e2) { /* fullName throws if doc is unsaved */ }
    }
    if (!assetDoc) {
        assetDoc = app.open(assetFile);
    }

    var grp = null, j, lay;
    for (j = 0; j < assetDoc.groupItems.length; j++) {
        if (assetDoc.groupItems[j].name === shapeName) {
            grp = assetDoc.groupItems[j];
            break;
        }
    }
    if (!grp) {
        for (i = 0; i < assetDoc.layers.length; i++) {
            lay = assetDoc.layers[i];
            for (j = 0; j < lay.groupItems.length; j++) {
                if (lay.groupItems[j].name === shapeName) {
                    grp = lay.groupItems[j];
                    break;
                }
            }
            if (grp) break;
        }
    }

    if (!grp) {
        log("[step9b] WARN | shape \"" + shapeName + "\" not found in "
            + CONFIG.peelingTabAssetPath);
        app.activeDocument = productionDoc;
        return null;
    }

    app.activeDocument = assetDoc;
    app.selection = null;
    grp.selected = true;
    app.executeMenuCommand("copy");

    app.activeDocument = productionDoc;
    app.executeMenuCommand("paste");

    if (!app.selection || app.selection.length === 0) {
        log("[step9b] WARN | paste returned no selection.");
        return null;
    }
    return app.selection[0];
}

// Translates pastedTab so its top edge aligns with seg.startY, centred on the segment.
function _positionTab(pastedTab, seg) {
    var gb   = pastedTab.geometricBounds;
    var tabW = gb[2] - gb[0];
    var midX = (seg.startX + seg.endX) / 2;

    var deltaX = (midX - tabW / 2) - gb[0];
    var deltaY = seg.startY - gb[1];

    pastedTab.translate(deltaX, deltaY);
}

// Selects pathItem + tabItem, applies Object > Compound Path > Make.
// Returns true if successful.
// ⚠️  Command name "compoundPath" — verify against installed Illustrator version.
function _applyCompoundPath(pathItem, tabItem) {
    try {
        app.selection = null;
        pathItem.selected = true;
        tabItem.selected  = true;
        app.executeMenuCommand("compoundPath");
        return true;
    } catch (e) {
        log("[step9b] WARN | compound path command failed: " + e.message);
        return false;
    }
}
