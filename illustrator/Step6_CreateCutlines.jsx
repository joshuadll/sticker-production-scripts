// Step6_CreateCutlines.jsx — Phase function only.
// #included by AI_BuildCutlines.jsx. Requires: aiUtils.jsx, CONFIG in scope.
//
// Places the silhouette PNG (exported by PSAI_BuildAndExportCutlines) into the open AI
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
        // Stickers always exists (buildWorkingDocument creates it); place above it.
        cutlinesLayer.move(findLayer(doc, CONFIG.stickersLayerName), ElementPlacement.PLACEBEFORE);
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
    // Native Illustrator trace API (ActionDescriptor/executeAction is Photoshop-only).
    // placed.trace() returns a PluginItem whose .tracing is a TracingObject.
    // Tracing is asynchronous — redraw() forces it before we read/expand it.
    var pluginItem = placed.trace();
    pluginItem.tracing.tracingOptions.loadFromPreset("Silhouettes");
    app.redraw();
    // expandTracing() converts the tracing to a GroupItem, replacing the PluginItem.
    var tracedGroup = pluginItem.tracing.expandTracing();

    // Ungroup — expandTracing leaves a GroupItem; one ungroup gives PathItems.
    doc.selection = [tracedGroup];
    app.executeMenuCommand("ungroup");

    // ── 5. Collect traced PathItems ───────────────────────────────────────────
    // Stroke is applied per-path below, only where the path ends up visible.
    var tracedPaths = [];
    var si;
    for (si = 0; si < doc.selection.length; si++) {
        var sel = doc.selection[si];
        if (sel.typename === "PathItem" || sel.typename === "CompoundPathItem") {
            tracedPaths.push(sel);
        }
    }
    log("[step6] Image Trace complete. " + tracedPaths.length + " path(s) collected.");

    // ── 6. Match and name paths ───────────────────────────────────────────────
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
                setStrokeStyle(path, CONFIG.cutlineStrokePt, blackCmyk());
                path.name = matched.displayName;
                log("[step6] WARN | stamp path kept (no stampTemplatePath) | "
                    + matched.displayName);
                named++;
            }
        } else if (matched.caption) {
            // element_outline (path) gets hidden inside _buildSeparableCutline;
            // strokeRecursive there handles the cutline stroke.
            _buildSeparableCutline(doc, cutlinesLayer, matched, path,
                pngLeft, pngTop, pngWidth, pngHeight, elementsData);
            log("[step6] named | " + matched.displayName);
            named++;
        } else {
            setStrokeStyle(path, CONFIG.cutlineStrokePt, blackCmyk());
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

// Parses the elements sidecar text file produced by PSAI_BuildAndExportCutlines.
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
        if (parts.length < 6) continue;
        var el = {
            displayName: parts[0],
            styleCode:   parts[1],
            left:        parseInt(parts[2], 10),
            top:         parseInt(parts[3], 10),
            right:       parseInt(parts[4], 10),
            bottom:      parseInt(parts[5], 10),
            caption:     null
        };
        // Extended (separable) format appends: capLines|capL|capT|capR|capB.
        if (parts.length >= 11) {
            var capLines = parseInt(parts[6], 10);
            var capL = parseInt(parts[7], 10);
            if (capLines > 0 && (capL || parseInt(parts[9], 10))) {
                el.caption = {
                    lines:  capLines,
                    left:   capL,
                    top:    parseInt(parts[8],  10),
                    right:  parseInt(parts[9],  10),
                    bottom: parseInt(parts[10], 10)
                };
            }
        }
        elements.push(el);
    }

    return { psdWidth: psdWidth, psdHeight: psdHeight, elements: elements };
}

// Transforms PSD pixel bounds (left, top, right, bottom) to AI document points
// using the placed PNG's position and dimensions. Returns geometricBounds order
// [aiLeft, aiTop, aiRight, aiBottom] (AI y increases upward).
function _psBoundsToAi(left, top, right, bottom, data, pngLeft, pngTop, pngWidth, pngHeight) {
    var psdW = data.psdWidth;
    var psdH = data.psdHeight;
    return [
        pngLeft + (left   / psdW) * pngWidth,   // aiLeft
        pngTop  - (top    / psdH) * pngHeight,  // aiTop
        pngLeft + (right  / psdW) * pngWidth,   // aiRight
        pngTop  - (bottom / psdH) * pngHeight   // aiBottom
    ];
}

// Returns the element whose PSD bounds contain the given AI centroid, or null.
function _findMatchingElement(center, data, pngLeft, pngTop, pngWidth, pngHeight) {
    var els = data.elements;
    var i;

    for (i = 0; i < els.length; i++) {
        var el = els[i];
        var ai = _psBoundsToAi(el.left, el.top, el.right, el.bottom,
                     data, pngLeft, pngTop, pngWidth, pngHeight);

        if (center.x >= ai[0] && center.x <= ai[2] &&
            center.y <= ai[1] && center.y >= ai[3]) {
            return el;
        }
    }
    return null;
}

// Separable mode: builds the per-element bundle from a traced element-only
// outline. Creates the parametric plate at the caption's AI bounds, derives the
// fused cutline via boolean union, strokes it, and groups outline+plate+cutline.
// element.caption must be present (caller checks). See aiUtils.jsx seams and
// docs/caption-separability-architecture.md.
function _buildSeparableCutline(doc, layer, element, elementOutline,
        pngLeft, pngTop, pngWidth, pngHeight, data) {

    doc.activeLayer = layer;
    var cap = element.caption;

    var aiBounds = _psBoundsToAi(cap.left, cap.top, cap.right, cap.bottom,
                       data, pngLeft, pngTop, pngWidth, pngHeight);

    var plate   = buildPlate(layer, aiBounds);
    var cutline = deriveCutline(elementOutline, plate);

    strokeRecursive(cutline, CONFIG.cutlineStrokePt, blackCmyk());
    var grp = assembleElementGroup(layer, element.displayName, elementOutline, plate, cutline);

    // Stash caption spec for Step 8b (Caption Normalisation), which has no sidecar.
    // Format: "{styleCode}|{capLines}" — e.g. "GC|2".
    grp.note = element.styleCode + "|" + cap.lines;
}

// Places a copy of CONFIG.stampTemplatePath, scaled to fit the element's AI bounds.
function _placeStampTemplate(doc, layer, element, tracedPath,
        pngLeft, pngTop, pngWidth, pngHeight, data) {

    doc.activeLayer = layer;
    var tmpl = doc.placedItems.add();
    tmpl.file = new File(CONFIG.stampTemplatePath);

    var ai = _psBoundsToAi(element.left, element.top, element.right, element.bottom,
                 data, pngLeft, pngTop, pngWidth, pngHeight);
    var aiLeft = ai[0], aiTop = ai[1], aiRight = ai[2], aiBottom = ai[3];

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
