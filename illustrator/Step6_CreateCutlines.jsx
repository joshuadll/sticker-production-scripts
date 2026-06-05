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

    // ── 5. Collect traced PathItems (dropping the whole-sheet background) ──────
    // Stroke is applied per-path below, only where the path ends up visible.
    // Snapshot the selection refs first — removing items re-indexes the live
    // doc.selection collection mid-loop (see CLAUDE.md live-collection note).
    var selSnapshot = [];
    var si;
    for (si = 0; si < doc.selection.length; si++) { selSnapshot.push(doc.selection[si]); }

    // Stage A junk filter: drop the whole-sheet trace background. Image Trace
    // emits one path that is the frame rectangle plus every element's outline
    // (dozens of sub-paths) — its bbox spans most of the sheet. No real element
    // is that big, so a path that large is junk. Left in, it gets matched by
    // centroid to whatever element contains the sheet centre and becomes a ghost
    // cutline group (the "all elements leak into one SVG" bug).
    var fullSheetArea = pngWidth * pngHeight;
    var bgFloor       = CONFIG.traceBackgroundAreaFrac * fullSheetArea;
    var tracedPaths      = [];
    var droppedBackground = 0;
    for (si = 0; si < selSnapshot.length; si++) {
        var sel = selSnapshot[si];
        if (sel.typename !== "PathItem" && sel.typename !== "CompoundPathItem") { continue; }
        var sb    = sel.geometricBounds;
        var sArea = Math.abs(sb[2] - sb[0]) * Math.abs(sb[1] - sb[3]);
        if (sArea >= bgFloor) {
            log("[step6] DROP | whole-sheet trace background (bbox " + Math.round(sArea)
                + "pt^2 >= " + Math.round(bgFloor) + ")");
            sel.remove();
            droppedBackground++;
            continue;
        }
        tracedPaths.push(sel);
    }
    log("[step6] Image Trace complete. " + tracedPaths.length + " path(s) collected"
        + (droppedBackground ? " (" + droppedBackground + " background dropped)" : "") + ".");

    // ── 6. Match and name paths ───────────────────────────────────────────────
    var named     = 0;
    var unmatched = 0;
    var droppedFragment = 0;
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

        // Stage B junk filter: drop a trace fragment — a path far smaller than the
        // element it matched (e.g. a stray blob whose centroid happens to land in a
        // real element's box). Left in, it becomes a duplicate ghost group sharing
        // the element's name. Compared to the element's own expected AI bounds, so
        // it stays correct across SKUs without an absolute size constant.
        var elAi   = _psBoundsToAi(matched.left, matched.top, matched.right, matched.bottom,
                         elementsData, pngLeft, pngTop, pngWidth, pngHeight);
        var elArea = Math.abs(elAi[2] - elAi[0]) * Math.abs(elAi[1] - elAi[3]);
        var pb     = path.geometricBounds;
        var pArea  = Math.abs(pb[2] - pb[0]) * Math.abs(pb[1] - pb[3]);
        if (elArea > 0 && pArea < CONFIG.traceMinElementAreaFrac * elArea) {
            log("[step6] DROP | trace fragment near " + matched.displayName
                + " (" + Math.round((pArea / elArea) * 100) + "% of element box)");
            path.remove();
            droppedFragment++;
            continue;
        }

        if (matched.styleCode === "ST") {
            setStrokeStyle(path, CONFIG.cutlineStrokePt, blackCmyk());
            path.name = matched.displayName;
            log("[step6] named | " + path.name);
            named++;
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

    var droppedJunk = droppedBackground + droppedFragment;
    log("[step6] done | named=" + named + " unmatched=" + unmatched
        + " dropped=" + droppedJunk);
    return { named: named, unmatched: unmatched, dropped: droppedJunk };
}


// ── Private helpers ───────────────────────────────────────────────────────────

// Parses the JSON elements sidecar produced by PSAI_BuildAndExportCutlines.
// Shape (see writeElementsFile):
//   { psdWidth, psdHeight, elements: [
//       { displayName, styleCode, left, top, right, bottom,
//         caption: null | { lines, left, top, right, bottom,
//                           radius?, spine?: [{x,y}, ...] } } ] }
// Returns that object directly, or null on read/parse failure. Requires JSON
// (json2.jsx, #included by AI_BuildCutlines). WC captions carry radius+spine (the
// real fitted capsule); GC/stamps have caption.radius/spine absent (parametric pill).
function _readElementsFile(filePath) {
    var f = new File(filePath);
    if (!f.exists) return null;

    f.encoding = "UTF-8";
    f.open("r");
    var text = f.read();
    f.close();
    if (!text) return null;

    var data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        log("[step6] ERROR | elements sidecar is not valid JSON: " + e.message);
        return null;
    }
    if (!data || !data.psdWidth || !data.psdHeight || !data.elements) return null;
    return data;
}

// Transforms a single PSD pixel point to AI document points (AI y increases
// upward). Point twin of _psBoundsToAi.
function _psPointToAi(px, py, data, pngLeft, pngTop, pngWidth, pngHeight) {
    return {
        x: pngLeft + (px / data.psdWidth)  * pngWidth,
        y: pngTop  - (py / data.psdHeight) * pngHeight
    };
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

    // WC captions carry the real fitted spine + radius (from PS) → rebuild the
    // actual curved/tilted capsule so the cutline follows the caption. GC keeps the
    // axis-aligned parametric pill (its plate is a straight rect + gouache template,
    // not a text-spine capsule).
    var plate;
    if (element.styleCode === "WC") {
        var aiSpine = [], j;
        for (j = 0; j < cap.spine.length; j++) {
            aiSpine.push(_psPointToAi(cap.spine[j].x, cap.spine[j].y,
                data, pngLeft, pngTop, pngWidth, pngHeight));
        }
        var aiRadius = (cap.radius / data.psdWidth) * pngWidth;
        plate = buildCapsuleFromSpine(layer, aiSpine, aiRadius);
        log("[step6] caption capsule | " + element.displayName
            + " (spine " + aiSpine.length + "pts, r=" + Math.round(aiRadius) + "pt)");
    } else {
        var aiBounds = _psBoundsToAi(cap.left, cap.top, cap.right, cap.bottom,
                           data, pngLeft, pngTop, pngWidth, pngHeight);
        plate = buildPlate(layer, aiBounds);
    }
    var cutline = deriveCutline(elementOutline, plate);

    strokeRecursive(cutline, CONFIG.cutlineStrokePt, blackCmyk());
    var grp = assembleElementGroup(layer, element.displayName, elementOutline, plate, cutline);

    // Stash caption spec for Step 8b (Caption Normalisation), which has no sidecar.
    // Format: "{styleCode}|{capLines}" — e.g. "GC|2".
    grp.note = element.styleCode + "|" + cap.lines;
}

