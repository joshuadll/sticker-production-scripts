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
    var srcDpi = (elementsData.sourceDPI && elementsData.sourceDPI > 0)
        ? elementsData.sourceDPI : CONFIG.sourceDPI;
    if (!elementsData.sourceDPI) log("[step6] WARN | sidecar has no sourceDPI; falling back to " + srcDpi);
    var targetWidthPt = elementsData.psdWidth * (72.0 / srcDpi);
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
    var artTargets = [];   // {name, register} per matched element — art placed after the loop
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

        // ── Cutline smoothing (corner-aware) ──────────────────────────────────
        // Flatten the trace's ruggedness while keeping intended sharp corners, the
        // way the artist does by hand (Object>Path>Simplify). Done HERE — on the raw
        // traced outline, before the caption text warps to it and before Pipeline 2's
        // seat/unite/half-cut derive from it — so the whole cutline inherits the smooth
        // shape. Applies to captioned AND stamp outlines alike. Handles compound paths
        // (outer contour + holes). See CONFIG.simplify* and aiUtils.simplifyPathItem.
        if (CONFIG.simplifyCutline) {
            var _before   = _cutlinePtCount(path);
            var _prePolys = samplePathToPolygons(path, 16);   // BEFORE geometry (detached {x,y})
            var _budgetMm = (CONFIG.smoothnessPct / 100) * CONFIG.whiteEdgeMm;
            var _r = _simplifyWithinBudget(path, _prePolys, CONFIG.simplifyMaxToleranceMm,
                         CONFIG.simplifyCornerAngleDeg, CONFIG.simplifySampleSteps, _budgetMm);
            var _pct = CONFIG.whiteEdgeMm > 0 ? Math.round(100 * _r.strayMm / CONFIG.whiteEdgeMm) : 0;
            if (_r.reduced) {
                log("[step6] simplify | " + matched.displayName + " | " + _before + " -> "
                    + _cutlinePtCount(path) + " pts | drift " + _r.strayMm.toFixed(2) + "mm ("
                    + _pct + "% <= " + CONFIG.smoothnessPct + "% budget) | tol " + _r.tol.toFixed(2)
                    + "mm x" + _r.iters);
            } else {
                log("[step6] simplify | " + matched.displayName + " | no reduction within budget ("
                    + _before + " pts)" + (_r.capped ? " [held un-smoothed to fit " + CONFIG.smoothnessPct + "%]" : ""));
            }
        }

        if (elementGetsCaption(matched.styleCode, matched.catCode)) {
            // Native caption: name the outline + place review text. The PILL/PLATE/cut are built in
            // Pipeline 2 (AI_BuildAndExportCutlines) after the artist reviews the text. The sidecar
            // no longer carries a caption object — caption presence is decided by styleCode.
            setStrokeStyle(path, CONFIG.cutlineStrokePt, blackRgb());
            path.name = matched.displayName + " outline";
            artTargets.push({ name: matched.displayName, register: path });
            var capTf = _placeCaptionText(cutlinesLayer, matched.displayName, path,
                CONFIG.captionFont, CONFIG.captionSizePt, CONFIG.captionTracking, CONFIG.captionTextGapMm);
            var capLineCount = _capSplitLines(matched.displayName).length;   // "A | B" -> 2 stacked lines
            log("[step6] caption text | " + matched.displayName + " (" + capLineCount + " line(s))");
            if (capTf && matched.styleCode === "WC" && CONFIG.captionWarpEnabled) {
                var warpRes = warpTextToBaseArc(capTf, path, {
                    minBowMm:          CONFIG.captionWarpMinBowMm,
                    maxResidFrac:      CONFIG.captionWarpMaxResidFrac,
                    tightRadiusFactor: CONFIG.captionWarpTightRadiusFactor,
                    maxTiltDeg:        CONFIG.captionWarpMaxTiltDeg,
                    calib:             CONFIG.captionWarpBendCalib,
                    maxBend:           CONFIG.captionWarpMaxBend
                });
                log("[step6] caption warp | " + matched.displayName + " -> "
                    + (warpRes.warped ? ("bend " + warpRes.bend.toFixed(3) + " (" + warpRes.reason + ")")
                                      : ("flat (" + warpRes.reason + ")")));
            }
            named++;
        } else {
            // Uncaptioned element: name the trace as a separable outline, then place a loose
            // default peel tab (PEEL HERE or semi-circle) for the artist to review/reposition.
            // Pipeline 2 seats + cuts + half-cuts it via the same machinery as captions.
            setStrokeStyle(path, CONFIG.cutlineStrokePt, blackRgb());
            path.name = matched.displayName + " outline";
            artTargets.push({ name: matched.displayName, register: path });
            if (_placeDefaultTab(cutlinesLayer, matched.displayName, path)) {
                named++;
            } else {
                unmatched++;   // flagged: artist resolves before Pipeline 2 (hard-error path)
            }
        }
    }

    // ── 7. Place review art on the Stickers layer ─────────────────────────────
    // Show each element's art beneath the cutlines so the artist reviews captions
    // against the real sticker. Art is EMBEDDED here (survives the save -> Deepnest ->
    // reopen gap) and Step 7B rides these same items to their nested pose — it does NOT
    // re-import. Missing PNG is a warn (review aid), not a gate — the element still has
    // its cutline + caption.
    var artPlaced = 0;
    if (!CONFIG.dryRun) {
        var artFolder     = _artFolderFromElementsPath(elementsFilePath);
        var stickersLayer = findLayer(doc, CONFIG.stickersLayerName);
        var artFactor     = artFactorFromData(elementsData, CONFIG.sourceDPI);
        if (!stickersLayer) {
            log("[step6] WARN | Stickers layer not found — review art not placed.");
        } else if (!artFolder || !artFolder.exists) {
            log("[step6] WARN | art folder not found ("
                + (artFolder ? artFolder.fsName : "null") + ") — review art not placed.");
        } else if (artFactor <= 0) {
            log("[step6] WARN | unusable art factor — review art not placed.");
        } else {
            var at;
            for (at = 0; at < artTargets.length; at++) {
                if (placeArtEmbedded(doc, stickersLayer, artFolder,
                        artTargets[at].name, artTargets[at].register, artFactor)) {
                    artPlaced++;
                }
            }
        }
        log("[step6] review art | placed " + artPlaced + " / " + artTargets.length + " element(s)");
    }

    var droppedJunk = droppedBackground + droppedFragment;
    log("[step6] done | named=" + named + " unmatched=" + unmatched
        + " dropped=" + droppedJunk);
    return { named: named, unmatched: unmatched, dropped: droppedJunk,
             artPlaced: artPlaced, traceTuning: traceTuning };
}

// Derives the per-element art PNG folder ({base}_elements) that sits beside the sidecar
// (written by PS exportElementPngs). Returns a Folder (may not exist — caller checks).
function _artFolderFromElementsPath(elementsFilePath) {
    var f    = new File(elementsFilePath);
    var base = f.name.replace(/_elements\.json$/i, "").replace(/\.json$/i, "");
    return new Folder(f.parent.fsName + "/" + base + "_elements");
}


// ── Private helpers ───────────────────────────────────────────────────────────

// Total anchor count of a cutline path — sums sub-paths for a CompoundPathItem
// (outer contour + holes), so the simplify before/after log is correct either way.
function _cutlinePtCount(p) {
    if (p.typename === "CompoundPathItem") {
        var c = 0, i;
        for (i = 0; i < p.pathItems.length; i++) c += p.pathItems[i].pathPoints.length;
        return c;
    }
    return (p.typename === "PathItem") ? p.pathPoints.length : 0;
}

// Largest-area polygon of a sampled set (the outer contour; holes are smaller).
function _largestPoly(polys) {
    var best = null, ba = -1, i, s, n, j, a, poly;
    for (i = 0; i < polys.length; i++) {
        poly = polys[i]; s = 0; n = poly.length;
        for (j = 0; j < n; j++) { var k = (j + 1) % n; s += poly[j].x * poly[k].y - poly[k].x * poly[j].y; }
        a = Math.abs(s) / 2;
        if (a > ba) { ba = a; best = poly; }
    }
    return best;
}

// How far (mm) the simplified outline's outer contour strays OUTSIDE the pre-simplify contour —
// i.e. beyond the outer white edge, the direction that risks an unprinted sliver. prePolys is the
// BEFORE sampling (plain {x,y}, detached from the DOM); the path is re-sampled AFTER. Concave dips
// are where smoothing pushes the cut outward, so this is the number that answers "still within the
// white edge?". Returns 0 when nothing crosses out.
function _maxOutwardMm(path, prePolys) {
    var pre = _largestPoly(prePolys);
    var post = _largestPoly(samplePathToPolygons(path, 16));
    if (!pre || !post) return 0;
    var i, v, d, mo = 0;
    for (i = 0; i < post.length; i++) {
        v = post[i];
        if (!pointInPolygon(v, pre)) { d = Math.sqrt(_minDist2ToPolyEdges(v, pre)); if (d > mo) mo = d; }
    }
    return pointsToMm(mo);
}

// The PathItems that make up a cutline (one for a PathItem, each sub-path for a CompoundPathItem).
function _constituentPaths(p) {
    if (p.typename === "CompoundPathItem") { var a = [], i; for (i = 0; i < p.pathItems.length; i++) a.push(p.pathItems[i]); return a; }
    if (p.typename === "PathItem") return [p];
    return [];
}

// Snapshot exact geometry (per sub-path anchors + handles + closed) so an element can be RESTORED
// and re-simplified from scratch at a different tolerance during the adaptive budget search.
function _snapshotPath(p) {
    var subs = _constituentPaths(p), snap = [], i, k;
    for (i = 0; i < subs.length; i++) {
        var pts = subs[i].pathPoints, A = [], L = [], R = [];
        for (k = 0; k < pts.length; k++) { A.push(pts[k].anchor); L.push(pts[k].leftDirection); R.push(pts[k].rightDirection); }
        snap.push({ sub: subs[i], A: A, L: L, R: R, closed: subs[i].closed });
    }
    return snap;
}
function _restorePath(snap) {
    var i, k;
    for (i = 0; i < snap.length; i++) {
        var s = snap[i], coords = [];
        for (k = 0; k < s.A.length; k++) coords.push([s.A[k][0], s.A[k][1]]);
        s.sub.setEntirePath(coords);
        s.sub.closed = s.closed;
        var pts = s.sub.pathPoints;
        for (k = 0; k < pts.length; k++) { pts[k].leftDirection = s.L[k]; pts[k].rightDirection = s.R[k]; }
    }
}

// STRICT per-element smoothing: give the element the MOST smoothing (largest tolerance, searched
// down from a ceiling) whose outward drift stays within budgetMm. Re-simplifies from the ORIGINAL
// each try, so the accepted result is GUARANTEED <= budget; if even minimal smoothing can't fit,
// the original is restored un-smoothed. Returns {reduced, tol, strayMm, iters, capped}.
function _simplifyWithinBudget(path, prePolys, startTolMm, cornerDeg, steps, budgetMm) {
    var snap = _snapshotPath(path);
    var tol = startTolMm, iters = 0, MAXIT = 9, FLOOR = 0.03, backoff = 0.62;
    while (iters < MAXIT) {
        iters++;
        _restorePath(snap);
        var did = simplifyPathItem(path, mmToPoints(tol), cornerDeg, steps);
        if (did <= 0) return { reduced: false, tol: tol, strayMm: 0, iters: iters, capped: false };
        var stray = _maxOutwardMm(path, prePolys);
        if (stray <= budgetMm) return { reduced: true, tol: tol, strayMm: stray, iters: iters, capped: false };
        tol *= backoff;
        if (tol < FLOOR) break;
    }
    _restorePath(snap);
    return { reduced: false, tol: tol, strayMm: 0, iters: iters, capped: true };
}

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
    try { tf.textRange.characterAttributes.fillColor = blackRgb(); } catch (e4) {}
    try { tf.textRange.paragraphAttributes.justification = Justification.CENTER; } catch (e5) {}

    var ob = outline.geometricBounds;                 // [l,t,r,b] y-up
    var ecx = (ob[0] + ob[2]) / 2;
    var tb = tf.geometricBounds, tcx = (tb[0] + tb[2]) / 2;
    tf.translate(ecx - tcx, (ob[3] - mmToPoints(gapMm)) - tb[1]);   // centre just below the element
    tf.name = displayName + " caption text";
    return tf;
}

// Pipeline 1 rough placement of a default peel tab for an uncaptioned element. Picks the longest
// near-straight edge, chooses PEEL HERE vs semi-circle by edge length, and places the asset as a
// loose "{displayName} tab" group. Returns true on success; false (logged) flags the element so
// the artist resolves it (e.g. an element with no straight edge) before Pipeline 2.
function _placeDefaultTab(cutlinesLayer, displayName, outlinePath) {
    var edge = pickTabEdge(outlinePath, {
        steps: CONFIG.peelTabEdgeSampleSteps,
        straightToleranceDeg: CONFIG.peelTabEdgeStraightToleranceDeg
    });
    if (!edge.ok) {
        log("[step6] TAB FLAG | " + displayName + " | " + edge.reason);
        return false;
    }
    var usePeelHere = edge.lengthMm >= (CONFIG.peelHereTabWidthMm + CONFIG.peelTabEdgeFitMarginMm);
    var assetFile = new File(usePeelHere ? CONFIG.peelTabAssetPathPeelHere : CONFIG.peelTabAssetPathSemiCircle);
    log("[step6] tab choice | " + displayName + " | edge " + Math.round(edge.lengthMm * 10) / 10
        + "mm -> " + (usePeelHere ? "PEEL HERE" : "semi-circle"));
    var res = placeTabAsset(cutlinesLayer.parent /*doc*/, cutlinesLayer, assetFile, edge, displayName);
    if (!res.ok) {
        log("[step6] TAB FLAG | " + displayName + " | " + res.reason);
        return false;
    }
    return true;
}
