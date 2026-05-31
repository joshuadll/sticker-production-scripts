// Step6_CreateCutlines.jsx — Phase function only.
// #included by AI_ToCutlines.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Places the silhouette PNG (exported by PS_AfterCaption) into the open AI
// template, runs Image Trace (Silhouettes preset), sets each path to 0.25pt
// black stroke, and names each path by matching its centroid to element bounds
// from the elements sidecar file.
//
// Stamp elements (styleCode "ST") have their traced path replaced with a
// scaled copy of CONFIG.stampTemplatePath. If that path is empty, the traced
// path is kept and a warning is logged.
//
// Returns: { named, stampsReplaced, unmatched }

function runCreateCutlines(doc, silhPngPath, elementsFilePath) {

    // ── 1. Read elements sidecar ──────────────────────────────────────────────
    var elementsData = _readElementsFile(elementsFilePath);
    if (!elementsData) {
        log("[step6] ERROR | could not read elements file: " + elementsFilePath);
        return null;
    }
    log("[step6] loaded " + elementsData.elements.length + " element(s) from sidecar.");

    if (CONFIG.dryRun) {
        log("[step6] [DRY RUN] would place, trace, and name paths from: " + silhPngPath);
        return { named: 0, stampsReplaced: 0, unmatched: 0 };
    }

    var pngFile = new File(silhPngPath);
    if (!pngFile.exists) {
        log("[step6] ERROR | silhouette PNG not found: " + silhPngPath);
        return null;
    }

    // ── 2. Ensure "Cutlines" layer above "Stickers" ───────────────────────────
    var cutlinesLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutlinesLayer) {
        cutlinesLayer = doc.layers.add();
        cutlinesLayer.name  = CONFIG.cutlinesLayerName;
        cutlinesLayer.color = UIColors.MAGENTA; // matches manual workflow; cosmetic only
        var stickersLayer = findLayer(doc, CONFIG.stickersLayerName);
        if (stickersLayer) {
            cutlinesLayer.move(stickersLayer, ElementPlacement.PLACEBEFORE);
        }
        log("[step6] created Cutlines layer (Magenta) above Stickers.");
    }

    // ── 3. Place silhouette PNG into Cutlines layer ───────────────────────────
    doc.activeLayer = cutlinesLayer;

    var placed = doc.placedItems.add();
    placed.file = pngFile;
    log("[step6] placed silhouette PNG.");

    // Scale to fit working area width (proportional).
    var workingWidthPt = mmToPoints(CONFIG.workingAreaWidthMm);
    var scalePct = (workingWidthPt / placed.width) * 100;
    placed.resize(scalePct, scalePct);

    // Centre on artboard.
    var artRect   = doc.artboards[0].artboardRect; // [left, top, right, bottom]
    var artCenterX = (artRect[0] + artRect[2]) / 2;
    var artCenterY = (artRect[1] + artRect[3]) / 2;
    placed.translate(
        artCenterX - (placed.position[0] + placed.width  / 2),
        artCenterY - (placed.position[1] - placed.height / 2)
    );

    // Save transform info BEFORE Image Trace (used for positional matching after).
    var pngLeft   = placed.position[0];
    var pngTop    = placed.position[1]; // y of top edge (larger value in AI y-up coords)
    var pngWidth  = placed.width;
    var pngHeight = placed.height;
    log("[step6] scaled to " + Math.round(pngWidth) + "pt wide, centred on artboard.");

    // ── 4. Image Trace ────────────────────────────────────────────────────────
    // ActionDescriptor approach: sets preset atomically and suppresses the
    // "Tracing may proceed slowly" performance warning via DialogModes.NO.
    doc.selection = [placed];
    var traceDesc = new ActionDescriptor();
    traceDesc.putString(stringIDToTypeID("preset"), "Silhouettes");
    executeAction(stringIDToTypeID("imageTrace"), traceDesc, DialogModes.NO);

    // Expand the trace result to live paths.
    app.executeMenuCommand("expandArt1");

    // Ungroup — trace result is a GroupItem; one ungroup gives PathItems.
    app.executeMenuCommand("ungroup");

    log("[step6] Image Trace complete. " + doc.selection.length + " path(s) in selection.");

    // ── 5. Apply stroke, collect PathItems ────────────────────────────────────
    var tracedPaths = [];
    var si;
    for (si = 0; si < doc.selection.length; si++) {
        var sel = doc.selection[si];
        if (sel.typename === "PathItem" || sel.typename === "CompoundPathItem") {
            setStrokeStyle(sel, CONFIG.cutlineStrokePt, blackCmyk());
            tracedPaths.push(sel);
        }
    }
    log("[step6] applied " + CONFIG.cutlineStrokePt + "pt stroke to "
        + tracedPaths.length + " path(s).");

    // ── 6. Name paths by positional matching ──────────────────────────────────
    var named          = 0;
    var stampsReplaced = 0;
    var unmatched      = 0;
    var pi;

    for (pi = 0; pi < tracedPaths.length; pi++) {
        var path    = tracedPaths[pi];
        var center  = boundsCenter(path.geometricBounds);
        var matched = _findMatchingElement(center, elementsData,
                          pngLeft, pngTop, pngWidth, pngHeight);

        if (!matched) {
            path.name = "Cutline_unmatched_" + (pi + 1);
            log("[step6] UNMATCHED path " + (pi + 1) + " centroid ("
                + Math.round(center.x) + "," + Math.round(center.y) + ")");
            unmatched++;
            continue;
        }

        if (matched.styleCode === "ST") {
            if (CONFIG.stampTemplatePath) {
                _placeStampTemplate(doc, cutlinesLayer, matched, path,
                    pngLeft, pngTop, pngWidth, pngHeight, elementsData);
                path.remove();
                stampsReplaced++;
                log("[step6] stamp replaced | " + matched.displayName);
            } else {
                path.name = matched.displayName;
                log("[step6] WARN | stamp path kept (no stampTemplatePath) | "
                    + matched.displayName);
                named++;
            }
        } else {
            path.name = matched.displayName;
            log("[step6] named | " + path.name);
            named++;
        }
    }

    log("[step6] done | named=" + named + " stamps=" + stampsReplaced
        + " unmatched=" + unmatched);
    return { named: named, stampsReplaced: stampsReplaced, unmatched: unmatched };
}


// ── Private helpers ───────────────────────────────────────────────────────────

// Parses the elements sidecar text file produced by PS_AfterCaption.
// Format:
//   width:{psdWidthPx}
//   height:{psdHeightPx}
//   {displayName}|{styleCode}|{left_px}|{top_px}|{right_px}|{bottom_px}
//
// Returns { psdWidth, psdHeight, elements: [{displayName, styleCode, left, top, right, bottom}] }
// or null on parse failure.
function _readElementsFile(filePath) {
    var f = new File(filePath);
    if (!f.exists) return null;

    f.open("r");
    var lines = [];
    while (!f.eof) {
        var ln = f.readln();
        if (ln !== "") lines.push(ln);
    }
    f.close();

    if (lines.length < 3) return null;

    var psdWidth  = parseInt(lines[0].split(":")[1], 10);
    var psdHeight = parseInt(lines[1].split(":")[1], 10);
    if (!psdWidth || !psdHeight) return null;

    var elements = [];
    var i;
    for (i = 2; i < lines.length; i++) {
        var parts = lines[i].split("|");
        if (parts.length !== 6) continue;
        elements.push({
            displayName: parts[0],
            styleCode:   parts[1],
            left:        parseInt(parts[2], 10),
            top:         parseInt(parts[3], 10),
            right:       parseInt(parts[4], 10),
            bottom:      parseInt(parts[5], 10)
        });
    }

    return { psdWidth: psdWidth, psdHeight: psdHeight, elements: elements };
}

// Returns the element whose PSD bounds contain the given AI centroid, or null.
// Transforms each element's PSD pixel bounds to AI document points using the
// placed PNG's position and dimensions.
function _findMatchingElement(center, data, pngLeft, pngTop, pngWidth, pngHeight) {
    var psdW = data.psdWidth;
    var psdH = data.psdHeight;
    var els  = data.elements;
    var i;

    for (i = 0; i < els.length; i++) {
        var el = els[i];
        var aiLeft   = pngLeft + (el.left   / psdW) * pngWidth;
        var aiRight  = pngLeft + (el.right  / psdW) * pngWidth;
        var aiTop    = pngTop  - (el.top    / psdH) * pngHeight; // AI y increases upward
        var aiBottom = pngTop  - (el.bottom / psdH) * pngHeight;

        if (center.x >= aiLeft  && center.x <= aiRight &&
            center.y <= aiTop   && center.y >= aiBottom) {
            return el;
        }
    }
    return null;
}

// Places a copy of CONFIG.stampTemplatePath, scaled to fit the element's AI bounds.
function _placeStampTemplate(doc, layer, element, tracedPath,
        pngLeft, pngTop, pngWidth, pngHeight, data) {

    doc.activeLayer = layer;
    var tmpl = doc.placedItems.add();
    tmpl.file = new File(CONFIG.stampTemplatePath);

    var psdW = data.psdWidth;
    var psdH = data.psdHeight;
    var aiLeft   = pngLeft + (element.left   / psdW) * pngWidth;
    var aiRight  = pngLeft + (element.right  / psdW) * pngWidth;
    var aiTop    = pngTop  - (element.top    / psdH) * pngHeight;
    var aiBottom = pngTop  - (element.bottom / psdH) * pngHeight;

    var targetW = aiRight - aiLeft;
    var targetH = aiTop   - aiBottom;

    // Uniform scale to fit within element bounds (shorter axis constrains).
    var scaleW   = (targetW / tmpl.width)  * 100;
    var scaleH   = (targetH / tmpl.height) * 100;
    var scalePct = (scaleW < scaleH) ? scaleW : scaleH;
    tmpl.resize(scalePct, scalePct);

    // Centre at element centre.
    var elCX  = (aiLeft + aiRight)  / 2;
    var elCY  = (aiTop  + aiBottom) / 2;
    tmpl.translate(
        elCX - (tmpl.position[0] + tmpl.width  / 2),
        elCY - (tmpl.position[1] - tmpl.height / 2)
    );

    tmpl.name = element.displayName;
}
