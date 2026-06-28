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
        return { error: "couldn't read the elements sidecar (" + elementsFilePath + ")" };
    }
    log("[step6] loaded " + elementsData.elements.length + " element(s) from sidecar.");

    if (CONFIG.dryRun) {
        log("[step6] [DRY RUN] would place, trace, and name paths from: " + silhPngPath);
        return { named: 0, stampsReplaced: 0, unmatched: 0 };
    }

    var pngFile = new File(silhPngPath);
    if (!pngFile.exists) {
        log("[step6] ERROR | silhouette PNG not found: " + silhPngPath);
        return { error: "couldn't find the silhouette image (" + silhPngPath + ")" };
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

    // Add via the layer's own collection, NOT doc.placedItems.add(): the latter targets
    // the topmost layer (now the locked Margin band from buildWorkingDocument), which
    // throws "Target layer cannot be modified". Layer-scoped add definitively lands here.
    var placed = cutlinesLayer.placedItems.add();
    placed.file = pngFile;
    log("[step6] placed silhouette PNG.");

    // Place at the source DPI so PSD pixels map to true physical size:
    // final width (pt) = psdWidth_px * 72 / sourceDPI. THIS is the governing print
    // scale (not workingAreaWidthMm); Step 7B sizes artwork by the same factor so the
    // art and cutlines stay twins. A 72-dpi silhouette places at psdWidth pt, so this
    // resolves to a flat 72/sourceDPI scale, but is written to tolerate other embeds.
    var targetWidthPt = elementsData.psdWidth * (72.0 / CONFIG.sourceDPI);
    var scalePct = (targetWidthPt / placed.width) * 100;
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
    var traceOpts  = pluginItem.tracing.tracingOptions;
    traceOpts.loadFromPreset("Silhouettes");
    // Tighten beyond the preset so the cutline follows the real edge instead of the
    // preset's smoothed/denoised approximation (see CONFIG.tracePathFidelity et al.).
    // Capture the apply/fail summary so the run status can warn on a silent no-op.
    var traceTuning = _tuneTraceOptions(traceOpts);
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

        if (matched.styleCode === "WC" || matched.styleCode === "GC") {
            // Native caption: name the outline + place review text. The PILL/PLATE/cut are built in
            // Pipeline 2 (AI_BuildAndExportCutlines) after the artist reviews the text. The sidecar
            // no longer carries a caption object — caption presence is decided by styleCode.
            setStrokeStyle(path, CONFIG.cutlineStrokePt, blackCmyk());
            path.name = matched.displayName + " outline";
            var capTf = _placeCaptionText(cutlinesLayer, matched.displayName, path,
                CONFIG.captionFont, CONFIG.captionSizePt, CONFIG.captionTracking, CONFIG.captionTextGapMm);
            log("[step6] caption text | " + matched.displayName);
            if (capTf && matched.styleCode === "WC" && CONFIG.captionWarpEnabled) {
                var warpRes = warpTextToBaseArc(capTf, path, {
                    minBowMm:          CONFIG.captionWarpMinBowMm,
                    maxResidFrac:      CONFIG.captionWarpMaxResidFrac,
                    tightRadiusFactor: CONFIG.captionWarpTightRadiusFactor,
                    gapMm:             CONFIG.captionTextGapMm,
                    calib:             CONFIG.captionWarpBendCalib,
                    maxBend:           CONFIG.captionWarpMaxBend
                });
                log("[step6] caption warp | " + matched.displayName + " -> "
                    + (warpRes.warped ? ("bend " + warpRes.bend.toFixed(3) + " (" + warpRes.reason + ")")
                                      : ("flat (" + warpRes.reason + ")")));
            }
            named++;
        } else {
            // ST and any uncaptioned element: bare named cutline path.
            setStrokeStyle(path, CONFIG.cutlineStrokePt, blackCmyk());
            path.name = matched.displayName;
            log("[step6] named | " + path.name);
            named++;
        }
    }

    var droppedJunk = droppedBackground + droppedFragment;
    log("[step6] done | named=" + named + " unmatched=" + unmatched
        + " dropped=" + droppedJunk);
    return { named: named, unmatched: unmatched, dropped: droppedJunk,
             traceTuning: traceTuning };
}


// ── Private helpers ───────────────────────────────────────────────────────────

// Applies the CONFIG trace-tuning overrides on top of the loaded "Silhouettes"
// preset so the traced contour hugs the silhouette edge (the preset is built to
// simplify, which rounds concave detail and sits the line loose). Each knob is set
// only when its CONFIG value is non-null; null means "keep the preset's value".
// Returns { requested, applied, failed: [names] } and logs a single status line.
// The summary is threaded into the run's result/status (see AI_BuildCutlines.jsx)
// so a silent no-op — e.g. a future Illustrator that renames a trace property —
// surfaces at the run level instead of only as a buried log line plus quietly-loose
// cutlines that every test still passes. See AI_BuildCutlines.jsx CONFIG
// (tracePathFidelity / traceCornerFidelity / traceNoiseFidelity / traceThreshold).
function _tuneTraceOptions(topts) {
    var knobs = [
        ["pathFidelity",   CONFIG.tracePathFidelity],
        ["cornerFidelity", CONFIG.traceCornerFidelity],
        ["noiseFidelity",  CONFIG.traceNoiseFidelity],
        ["threshold",      CONFIG.traceThreshold]
    ];
    var requested = 0, applied = 0, failed = [], i;
    for (i = 0; i < knobs.length; i++) {
        var r = _setTraceOpt(topts, knobs[i][0], knobs[i][1]);
        if (r === "skip") { continue; }
        requested++;
        if (r === "ok") { applied++; } else { failed.push(knobs[i][0]); }
    }
    if (requested > 0 && applied === 0) {
        log("[step6] trace tuning | WARN applied 0/" + requested
            + " — no overrides took effect (" + failed.join(", ")
            + "); cutlines will use the raw preset (loose). Check trace property"
            + " names for this Illustrator version.");
    } else if (failed.length > 0) {
        log("[step6] trace tuning | WARN applied " + applied + "/" + requested
            + " — not honored: " + failed.join(", "));
    } else {
        log("[step6] trace tuning | applied " + applied + "/" + requested);
    }
    return { requested: requested, applied: applied, failed: failed };
}

// Sets one tracing option and reports whether it ACTUALLY took effect, so a silent
// no-op is detectable rather than buried. Returns "skip" (CONFIG null → keep
// preset), "ok" (the property existed and read back the requested value), or "fail"
// (threw, or the value didn't stick — an absent/renamed property the build silently
// ignores, or a clamp). "ok" requires `was` to be defined (a real preset property,
// not a junk expando) AND the read-back to equal the request. Logs the outcome.
function _setTraceOpt(topts, name, value) {
    if (value === null || value === undefined) { return "skip"; }
    try {
        var was = topts[name];
        topts[name] = value;
        var now = topts[name];
        if (was !== undefined && now == value) {   // == tolerates int/float read-back
            log("[step6] trace opt | " + name + ": " + was + " -> " + now);
            return "ok";
        }
        log("[step6] trace opt | " + name + " did NOT take effect: requested "
            + value + ", read back " + now + " (was " + was + ")");
        return "fail";
    } catch (e) {
        log("[step6] trace opt | " + name + " not supported — keeping preset ("
            + e.message + ")");
        return "fail";
    }
}

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

// Places a native caption text frame (the printed ink, vector) below an element's traced outline
// as the artist's review pose. Names it "{displayName} caption text" so Pipeline 2
// (AI_BuildAndExportCutlines) can re-find it. Kalam 8pt / tracking -20 / centred / black.
// try/catch each characterAttributes set — a stale attribute throws -609 (see gotchas memory).
function _placeCaptionText(layer, displayName, outline, font, sizePt, tracking, gapMm) {
    var tf = layer.textFrames.add();
    var _lines = _capSplitLines(displayName);   // split on "|" -> stacked lines (aiUtils)
    tf.contents = _lines.join("\r");
    try { tf.textRange.characterAttributes.size     = sizePt; } catch (e1) {}
    try { tf.textRange.characterAttributes.textFont = app.textFonts.getByName(font); } catch (e2) {}
    try { tf.textRange.characterAttributes.tracking = tracking; } catch (e3) {}
    try { tf.textRange.characterAttributes.fillColor = blackCmyk(); } catch (e4) {}
    try { tf.textRange.paragraphAttributes.justification = Justification.CENTER; } catch (e5) {}

    var ob = outline.geometricBounds;                 // [l,t,r,b] y-up
    var ecx = (ob[0] + ob[2]) / 2;
    var tb = tf.geometricBounds, tcx = (tb[0] + tb[2]) / 2;
    tf.translate(ecx - tcx, (ob[3] - mmToPoints(gapMm)) - tb[1]);   // centre just below the element
    tf.name = displayName + " caption text";
    return tf;
}
