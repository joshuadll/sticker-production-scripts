// aiUtils.jsx — Shared Illustrator utilities
// #included by pipeline scripts. Not run directly.
// All functions assume CONFIG is defined in the including pipeline script.

// ─── REGEX ────────────────────────────────────────────────────────────────────

// Same naming convention as Photoshop — element names are consistent across apps.
// Keep this regex identical to psUtils.jsx NAME_REGEX.
// Matches "Horseshoe Bend [WC-LM]"  → captures (Horseshoe Bend)(WC)(LM)(undefined)
// Matches "Eiffel Tower [WC-LM+]"   → captures (Eiffel Tower)(WC)(LM)(+)
// Matches "Small Snack [WC-FD-]"    → captures (Small Snack)(WC)(FD)(-)
// Matches "Orlando Stamp [ST]"      → captures (Orlando Stamp)(ST)(undefined)(undefined)
// Matches "Big Stamp [ST+]"         → captures (Big Stamp)(ST)(undefined)(+)
// Matches "Tiny Stamp [ST-]"        → captures (Tiny Stamp)(ST)(undefined)(-)
// The size hint is OUTSIDE the catCode group so it can follow a category-less
// style code (stamps); without this an "[ST+]" typo would parse to null and the
// stamp would be silently dropped from the cutline/export pipeline.
var NAME_REGEX = /^(.+)\s\[([A-Z]+)(?:-([A-Z]+))?([+-])?\]$/;

// ─── PURE HELPERS ─────────────────────────────────────────────────────────────

function parseLayerName(name) {
    var m = name.match(NAME_REGEX);
    if (!m) return null;
    return {
        displayName: m[1],
        styleCode:   m[2],
        catCode:     m[3] || null,
        sizeHint:    m[4] || null   // "+" = large end, "-" = small end, null = midpoint
    };
}

// Categories whose elements are SELF-LABELLED — a Map (MP) or a Location Name (TL) already carry
// their own text, so they get a DEFAULT PEEL TAB instead of a redundant caption. NOTE: Landmarks
// (LM) and Transportation (TR) are illustrations that DO need their name, so they stay captioned.
// Overridable via CONFIG.peelTabCategories; the array here is the fallback (also used by the node
// unit test, where CONFIG is not in scope).
function _peelTabCategory(catCode) {
    var cats = (typeof CONFIG !== "undefined" && CONFIG.peelTabCategories)
             ? CONFIG.peelTabCategories : ["MP", "TL"];
    for (var i = 0; i < cats.length; i++) { if (cats[i] === catCode) return true; }
    return false;
}

// Single source of truth for "does this element get a named caption?" — its inverse is exactly the
// set that gets a DEFAULT PEEL TAB (routed through the SAME placeDefaultTab/buildDefaultTab path as
// stamps — no duplication). Used by Step 6 (Pipeline 1) and AI_BuildAndExportCutlines (Pipeline 2).
//   GC → always caption (GC-LM is the decorative caption-plate product).
//   WC → caption UNLESS its category is a self-labelled peel-tab category (MP/TL; LM/TR stay captioned).
//   ST / anything else → peel tab.
function elementGetsCaption(styleCode, catCode) {
    if (styleCode === "GC") return true;
    if (styleCode === "WC") return !_peelTabCategory(catCode);
    return false;
}

// Converts millimetres to Illustrator points (1 mm = 2.834645 pt).
// Used for offset path distances, stroke weights, etc.
function mmToPoints(mm) {
    return mm * 2.834645;
}

// Returns the centre {x, y} of an Illustrator geometricBounds array
// [left, top, right, bottom]. Note: Illustrator y-axis is inverted.
function boundsCenter(bounds) {
    return {
        x: (bounds[0] + bounds[2]) / 2,
        y: (bounds[1] + bounds[3]) / 2
    };
}

// Largest distance between any two points in a set ([{x,y}]). 0 for fewer than 2 points.
// The caption's junction span = this over the plate-art boundary crossings; 0 means the caption
// only touches tangentially (a pinch), which cuts as two pieces. Pure.
function _farthestPairDist(pts) {
    if (!pts || pts.length < 2) return 0;
    var best = 0, i, j, dx, dy, d;
    for (i = 0; i < pts.length; i++) {
        for (j = i + 1; j < pts.length; j++) {
            dx = pts[i].x - pts[j].x; dy = pts[i].y - pts[j].y;
            d = dx * dx + dy * dy;
            if (d > best) best = d;
        }
    }
    return Math.sqrt(best);
}

// Subdivides a closed polygon so no edge is longer than maxLen, WITHOUT decimating anything that
// is already finer. samplePathToPolygons samples per BEZIER SEGMENT, so a flat caption whose inner
// edge is ONE segment gets ~40x coarser spacing than a warped one built from ~40 spine segments —
// which quantized the contact measure and could read a real weld as zero. Densifying to a fixed
// arc length makes the measurement resolution comparable across captions. Pure.
function _densifyPoly(poly, maxLen) {
    var N = poly.length;
    if (N < 3 || !(maxLen > 0)) return poly;
    var out = [], i, a, b, dx, dy, len, cuts, k;
    for (i = 0; i < N; i++) {
        a = poly[i]; b = poly[(i + 1) % N];
        out.push({ x: a.x, y: a.y });
        dx = b.x - a.x; dy = b.y - a.y;
        len = Math.sqrt(dx * dx + dy * dy);
        // CEIL, not floor: with floor, an edge in [maxLen, 2*maxLen) gives cuts === 1 and the loop
        // below never runs, so the edge is left UNSUBDIVIDED at up to 2x maxLen — the function
        // silently failed to deliver the spacing it promises.
        cuts = Math.ceil(len / maxLen);
        for (k = 1; k < cuts; k++) {
            out.push({ x: a.x + dx * (k / cuts), y: a.y + dy * (k / cuts) });
        }
    }
    return out;
}

// Total CONTACT length between a sampled plate polygon and the art: the summed length of the parts
// of the plate boundary that lie INSIDE the art. This is what mechanically welds the caption on,
// and it accumulates across multiple separate contact regions. Deliberately NOT the farthest-pair
// span of the crossings — that measures tip-to-tip and scores two hairline welds the same as two
// solid ones (spec amendment 2).
// A partially-submerged edge contributes its SUBMERGED PORTION (bisected via _segCrossArt), not 0:
// counting only both-endpoints-inside edges quantized the result to the sample spacing, so a real
// weld shorter than one step read as exactly 0.000 — indistinguishable from a detached caption.
// platePoly = [{x,y}]; artPolys = samplePathToPolygons output. Pure; node-testable.
function _contactRunsTotal(platePoly, artPolys) {
    if (!platePoly || platePoly.length < 3 || !artPolys || artPolys.length === 0) return 0;
    var N = platePoly.length, i, j, inside = [], total = 0, a, b, c, dx, dy;
    for (i = 0; i < N; i++) inside[i] = _pointInPolysEO(platePoly[i], artPolys);
    for (i = 0; i < N; i++) {
        j = (i + 1) % N;
        a = platePoly[i]; b = platePoly[j];
        if (inside[i] && inside[j]) {                       // fully submerged edge
            dx = b.x - a.x; dy = b.y - a.y;
            total += Math.sqrt(dx * dx + dy * dy);
        } else if (inside[i]) {                             // a inside, b outside
            c = _segCrossArt(b, a, artPolys);               // (outside, inside) -> boundary point
            dx = c.x - a.x; dy = c.y - a.y;
            total += Math.sqrt(dx * dx + dy * dy);
        } else if (inside[j]) {                             // a outside, b inside
            c = _segCrossArt(a, b, artPolys);
            dx = b.x - c.x; dy = b.y - c.y;
            total += Math.sqrt(dx * dx + dy * dy);
        }
    }
    return total;
}

// ─── PLATE-ECHO PREDICATE (single source of truth) ────────────────────────────
// "Does leaf f echo reference shape `ref`?" — bbox-centroid within PLATE_ECHO_DIST_PT and bbox area
// within PLATE_ECHO_AREA_LO..HI of it.
//
// ⚠ THIS MUST STAY A SINGLE DEFINITION. Two consumers depend on being EXACT COMPLEMENTS:
//   • removeCaptionJunctionSlivers KEEPS a fused-cut leaf that echoes the plate (so a shallow-seated
//     pill is never deleted as a "crumb"), and
//   • fuseCaptionCutline's phase-2 re-assert FLAGS that same leaf as a still-detached caption.
// If the two ever used different tolerances, a detached pill could be deleted by the remover before
// the re-assert runs — phase 2 would then find no plate-like leaf, report ok:true, and the cutline
// would ship with NO caption at all (the 079f75b "caption plate deleted" failure). They previously
// hard-coded the same four literals independently; this predicate removes that drift risk.
var PLATE_ECHO_DIST_PT = 10;
var PLATE_ECHO_AREA_LO = 0.75;
var PLATE_ECHO_AREA_HI = 1.25;

function _bboxEcho(f, ref) {
    if (!f || !ref || ref.area <= 0) return false;
    var dx = f.c.x - ref.c.x, dy = f.c.y - ref.c.y;
    if (dx * dx + dy * dy > PLATE_ECHO_DIST_PT * PLATE_ECHO_DIST_PT) return false;
    var ratio = f.area / ref.area;
    return (ratio >= PLATE_ECHO_AREA_LO && ratio <= PLATE_ECHO_AREA_HI);
}

// True iff some fused-cut leaf IS the caption plate — i.e. the caption failed to fuse and remains
// a separate piece. leafMetrics = [{c:{x,y},area}], plate = {c:{x,y},area}. A single contour, or a
// real art-hole leaf (off the plate centroid), is NOT flagged. Pure; node-testable.
function _captionLeafDetached(leafMetrics, plate) {
    if (!leafMetrics || !plate || plate.area <= 0) return false;
    var i;
    for (i = 0; i < leafMetrics.length; i++) {
        if (_bboxEcho(leafMetrics[i], plate)) return true;
    }
    return false;
}

// Centroid ({x,y}) of an array of {x,y} points, or null when empty.
function _anchorCentroid(pts) {
    if (!pts || !pts.length) return null;
    var sx = 0, sy = 0, i;
    for (i = 0; i < pts.length; i++) { sx += pts[i].x; sy += pts[i].y; }
    return { x: sx / pts.length, y: sy / pts.length };
}

// Long-axis angle (degrees, +CCW, y-up) of a point cloud = the direction of its
// farthest-apart pair. The two ends of a pill/tab are its farthest points, so the
// pair direction is the long axis (robust on warped WC capsules: the end tips define
// the chord). Returns null for < 2 points or a degenerate (coincident) cloud. O(n^2)
// on the small reference-path anchor set.
function _longAxisAngleDeg(pts) {
    if (!pts || pts.length < 2) return null;
    var bi = 0, bj = 1, bd = -1, i, j, dx, dy, d;
    for (i = 0; i < pts.length; i++) {
        for (j = i + 1; j < pts.length; j++) {
            dx = pts[j].x - pts[i].x; dy = pts[j].y - pts[i].y;
            d = dx * dx + dy * dy;
            if (d > bd) { bd = d; bi = i; bj = j; }
        }
    }
    if (bd <= 0) return null;
    return Math.atan2(pts[bj].y - pts[bi].y, pts[bj].x - pts[bi].x) * 180 / Math.PI;
}

// Degrees (+CCW) to rotate an element into its upright design orientation for export:
// makes the reference feature's long axis horizontal AND places the reference BELOW the
// art. refPts = reference (plate/tab) anchors; artPts = outline (art) anchors, may be
// null (then the up/down resolution is skipped). Returns null when refPts has < 2
// points (caller falls back). Pure geometry — reflects the element's CURRENT orientation
// (nest + any manual rotation), independent of any item matrix.
function _uprightRotationDeg(refPts, artPts) {
    var phi = _longAxisAngleDeg(refPts);
    if (phi === null) return null;
    var theta = -phi;                              // long axis -> horizontal
    var cRef = _anchorCentroid(refPts);
    var cArt = _anchorCentroid(artPts);
    if (cRef && cArt) {
        // Rotate (cRef - cArt) by theta; in upright the reference sits BELOW the art
        // (negative y, y-up). If it lands above (y > 0), the element is upside down.
        var vx = cRef.x - cArt.x, vy = cRef.y - cArt.y;
        var r  = theta * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
        var ry = vx * sn + vy * cs;
        if (ry > 0) theta += 180;
    }
    return theta;
}

// Flat array of {x,y} anchor points of a PathItem or CompoundPathItem (all sub-paths);
// [] for any other type. DOM-only (not unit-tested).
function _pathAnchors(item) {
    var out = [], i, j, pts;
    if (!item) return out;
    if (item.typename === "CompoundPathItem") {
        for (i = 0; i < item.pathItems.length; i++) {
            pts = item.pathItems[i].pathPoints;
            for (j = 0; j < pts.length; j++) out.push({ x: pts[j].anchor[0], y: pts[j].anchor[1] });
        }
    } else if (item.typename === "PathItem") {
        pts = item.pathPoints;
        for (j = 0; j < pts.length; j++) out.push({ x: pts[j].anchor[0], y: pts[j].anchor[1] });
    }
    return out;
}

// Rotation-about-pivot matrix (mirrors Step 7B's _nestPivotMatrix; kept here so Step 10,
// which does not #include Step 7B, can rotate its export group in the same +CCW,
// DOCUMENTORIGIN convention). Apply with item.transform(m, true,true,true,true,1,
// Transformation.DOCUMENTORIGIN).
function pivotRotationMatrix(angleDeg, px, py) {
    var m = app.getTranslationMatrix(-px, -py);
    m = app.concatenateRotationMatrix(m, angleDeg);
    m = app.concatenateTranslationMatrix(m, px, py);
    return m;
}

// AI points per PSD pixel = 72 / sourceDPI — the SAME scale Step 6 uses to place the
// silhouette at its source DPI, so art and cutlines are twins at true physical size.
// Reads elementsData.sourceDPI; falls back to fallbackDpi (CONFIG.sourceDPI) when the
// sidecar omits it. Returns 0 when unusable (no psdWidth / no positive DPI). Pure — no
// logging — so it is node-unit-testable.
function artFactorFromData(elementsData, fallbackDpi) {
    if (!elementsData || !elementsData.psdWidth) return 0;
    var dpi = (elementsData.sourceDPI && elementsData.sourceDPI > 0)
        ? elementsData.sourceDPI : fallbackDpi;
    if (!dpi || dpi <= 0) return 0;
    var factor = 72.0 / dpi;
    return factor > 0 ? factor : 0;
}

// Returns the art item on the Stickers layer whose name === displayName, or null.
// Art is EMBEDDED at Step 6 (a RasterItem); a stray linked item (PlacedItem) from an
// older run is matched too. Direct children only — never reaches into a nested group.
function findArtByName(stickersLayer, displayName) {
    if (!stickersLayer) return null;
    var i, it;
    for (i = 0; i < stickersLayer.rasterItems.length; i++) {
        it = stickersLayer.rasterItems[i];
        if (it.parent === stickersLayer && it.name === displayName) return it;
    }
    for (i = 0; i < stickersLayer.placedItems.length; i++) {
        it = stickersLayer.placedItems[i];
        if (it.parent === stickersLayer && it.name === displayName) return it;
    }
    return null;
}

// Places {displayName}.png from artFolder onto the Stickers layer, sized to true physical
// size (artFactor × 100 %), centred on registerItem's geometricBounds, then EMBEDDED so it
// survives the save -> close -> Deepnest -> reopen gap independent of the PNG folder. Names
// it displayName. Returns the embedded RasterItem, or null (logged) when the PNG is missing
// or placement throws. registerItem is the element-art bounds reference (Step 6: the
// "{name} outline" path; Step 7B fallback would use the group's " outline" member).
function placeArtEmbedded(doc, stickersLayer, artFolder, displayName, registerItem, artFactor) {
    var safeName = displayName.replace(/[\/\\:*?"<>|]/g, "_");
    var pngFile  = new File(artFolder.fsName + "/" + safeName + ".png");
    if (!pngFile.exists) {
        log("[aiutils] WARN | art PNG not found for: " + displayName + " (" + pngFile.fsName + ")");
        return null;
    }

    var prevLayer = doc.activeLayer;
    doc.activeLayer = stickersLayer;
    var placed = null;
    try {
        // Layer-scoped add (NOT doc.placedItems.add(), which targets the locked Margin band).
        placed = stickersLayer.placedItems.add();
        placed.file = pngFile;
        placed.name = displayName;
        if (placed.layer !== stickersLayer) {
            placed.move(stickersLayer, ElementPlacement.PLACEATBEGINNING);
        }

        // Size to true AI size = element_px × factor (for a 72-dpi PNG this is a flat
        // factor×100 resize since placed.width == element_px). Centre on the reference bounds.
        placed.resize(artFactor * 100, artFactor * 100);
        var rb = registerItem.geometricBounds;
        var rc = boundsCenter(rb);
        placed.translate(rc.x - (placed.position[0] + placed.width  / 2),
                         rc.y - (placed.position[1] - placed.height / 2));

        var agb = placed.geometricBounds;
        var aW = Math.abs(agb[2] - agb[0]), aH = Math.abs(agb[1] - agb[3]);
        var rW = Math.abs(rb[2] - rb[0]),   rH = Math.abs(rb[1] - rb[3]);
        log("[aiutils] ART-FIT | " + displayName
            + " art=" + Math.round(aW) + "x" + Math.round(aH)
            + " ref=" + Math.round(rW) + "x" + Math.round(rH)
            + " dW=" + Math.round(aW - rW) + " dH=" + Math.round(aH - rH));

        // Embed now: at Step 6 nothing transforms this item afterwards, so the phantom-ref
        // hazard (embed() detaches the PlacedItem ref) does not apply — we do not reuse `placed`.
        placed.embed();
        doc.activeLayer = prevLayer;
        return findArtByName(stickersLayer, displayName);   // the embedded RasterItem
    } catch (e) {
        if (placed) { try { placed.remove(); } catch (e2) {} }
        doc.activeLayer = prevLayer;
        log("[aiutils] WARN | art placement failed for: " + displayName
            + " — line " + e.line + ": " + e.message);
        return null;
    }
}

// Returns true if a path item is a caption path (name ends with " caption").
// NOTE: Step 6 does not produce separate caption paths — caption is part of the
// element silhouette. This helper is retained for potential use in Steps 8b/9.
function isCaption(pathItem) {
    return (/\scaption$/).test(pathItem.name);
}

// ─── DOM HELPERS ──────────────────────────────────────────────────────────────

// Logging is normally immediate (one file open/write/close per line) so a crash
// never loses context. On hot paths that emit many lines (e.g. Layout QA logs per
// path + per pocket), the per-call syscall churn is measurable on slow disks. A
// pipeline can opt into buffered logging with beginLogBuffer(): log() then
// accumulates in memory and flushLog() writes the whole run in ONE open/close.
// Default (buffer null) is the original immediate behaviour, so every other
// pipeline is unaffected. flushLog() is also called from scriptAlert() so any
// buffered context is on disk before a modal alert blocks the script.
var _logBuf = null;   // non-null array → buffering active

function beginLogBuffer() {
    _logBuf = [];
}

function _writeLogLines(lines) {
    if (lines.length === 0) return;
    var f = new File(CONFIG.logPath);
    f.encoding = "UTF-8";       // accented element names (Devín, Šúľance) write as
                                // valid UTF-8, not invalid Mac-Roman bytes
    f.lineFeed = "Unix";        // \n terminators so grep/diff treat the log as text
    f.open("a");
    f.write(lines.join("\n") + "\n");
    f.close();
}

function flushLog() {
    if (_logBuf === null) return;
    _writeLogLines(_logBuf);
    _logBuf = null;             // back to immediate mode after a flush
}

function log(msg) {
    $.writeln(msg);
    if (_logBuf !== null) { _logBuf.push(msg); return; }
    _writeLogLines([msg]);
}

function scriptAlert(msg) {
    log(msg);
    flushLog();                 // ensure buffered context hits disk before blocking
    if (!CONFIG.suppressAlerts) alert(msg);
}

// Copies this run's log to `folderFsName` under `niceName` so a FAILURE's details land
// right next to the artist's files (their job folder) instead of the hidden
// ~/Library/Application Support path. flushLog() first so the buffered run is on disk.
// Reads + rewrites (not File.copy) so spaced/unicode paths and UTF-8 element names survive.
// Returns the beside-files path, or CONFIG.logPath if the copy can't be made.
function copyLogBeside(folderFsName, niceName) {
    try {
        flushLog();
        if (!folderFsName) return CONFIG.logPath;
        var src = new File(CONFIG.logPath);
        if (!src.exists) return CONFIG.logPath;
        src.encoding = "UTF-8"; src.open("r"); var txt = src.read(); src.close();
        var dest = new File(folderFsName + "/" + niceName);
        dest.encoding = "UTF-8"; dest.lineFeed = "Unix";
        if (!dest.open("w")) return CONFIG.logPath;
        dest.write(txt); dest.close();
        return dest.fsName;
    } catch (e) { return CONFIG.logPath; }
}

// Resolves and creates the organized export tree beside the working file:
//   {baseFolder}/{stkCode}_export/
//     ├── {stkCode}_final.ai         (root)
//     ├── previews/                  (the two sheet JPEGs)
//     └── elements/                  (per-element PNGs)
// So the deliverables no longer mix with the working .ai + sidecars in one flat dir.
// Returns { root, previews, elements } as fsName strings. Idempotent — Folder.create
// no-ops on an existing dir, so re-running the export pipeline just reuses the tree.
function ensureExportFolders(baseFolder, stkCode) {
    function ensure(path) {
        var f = new Folder(path);
        // Verify creation succeeded — Folder.create() returns false (rather than throwing)
        // on a read-only/permission-restricted volume; returning the fsName anyway would
        // surface later as a confusing exportFile error with no hint at the real cause.
        if (!f.exists && !f.create())
            throw new Error("Could not create export folder: " + path);
        return f.fsName;
    }
    var root = ensure(baseFolder + "/" + stkCode + "_export");
    return {
        root:     root,
        previews: ensure(root + "/previews"),
        elements: ensure(root + "/elements")
    };
}

// Per-phase wall-timer for profiling slow runs. `lap()` returns the ms elapsed
// since the last lap (or since creation) and resets, so a phase is timed with one
// call: `var t = _newPhaseTimer(); … phaseA(); var msA = t.lap(); phaseB(); …`.
// Uses Date (NOT $.hiresTimer, which returns nonsense deltas in Illustrator).
function _newPhaseTimer() {
    return {
        last: (new Date()).getTime(),
        lap: function () {
            var now = (new Date()).getTime();
            var d = now - this.last;
            this.last = now;
            return d;
        }
    };
}

// Finds a top-level layer by exact name (case-sensitive).
// Returns null if not found. Illustrator uses exact string matching — no fallback.
function findLayer(doc, name) {
    for (var i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i].name === name) return doc.layers[i];
    }
    return null;
}

// Builds the working document the AI pipeline runs on. The values below are the
// print-production spec — they must match the press/cutting setup, so don't change
// them without confirming against a real production file:
//   - A4 sheet (210 x 297 mm), CMYK, mm ruler units
//   - Color Block : full-sheet green rect, fill CMYK(55,0,100,0), locked, bottom
//                   (the green background for Step 10's green preview JPEG)
//   - Grid        : vector 1-inch reference grid, locked (artist manual-check aid)
//   - Stickers    : empty (Step 7B places nested artwork here)
// Cutlines / Halfcut layers are created later by their own steps, above Stickers.
// Returns the new document.
function buildWorkingDocument() {
    var SHEET_W_MM = 210;   // A4 — matches template artboard
    var SHEET_H_MM = 297;
    var GRID_MM    = 25.4;  // 1 inch

    // RGB working space — the source art is sRGB and the target is an RGB inkjet
    // (Canon PIXMA iX6780 + a custom RGB ICC profile applied at PRINT time). Staying
    // in RGB keeps the art at full gamut; a CMYK document would clip saturated colours
    // (greens/blues/oranges) irreversibly before the ICC profile ever runs.
    var doc = app.documents.add(
        DocumentColorSpace.RGB,
        mmToPoints(SHEET_W_MM),
        mmToPoints(SHEET_H_MM)
    );
    doc.rulerUnits = RulerUnits.Millimeters;

    var ab     = doc.artboards[0].artboardRect; // [left, top, right, bottom] pt
    var left   = ab[0], top = ab[1], right = ab[2], bottom = ab[3];

    // Default doc ships with one empty layer — repurpose it as Color Block (bottom).
    var colorBlock = doc.layers[0];
    colorBlock.name = CONFIG.colorBlockLayerName ? CONFIG.colorBlockLayerName : "Color Block";
    doc.activeLayer = colorBlock;
    var green = doc.pathItems.rectangle(top, left, right - left, top - bottom);
    green.stroked   = false;
    green.filled    = true;
    green.fillColor = _bwdGreen();
    colorBlock.locked = true;

    // Grid (above Color Block): vector 1-inch lines.
    var grid = doc.layers.add();
    grid.name = "Grid";
    var gridColor = _bwdGridColor();
    var step = mmToPoints(GRID_MM);
    var x, y;
    for (x = left; x <= right + 0.01; x += step) {
        _bwdGridLine(grid, x, top, x, bottom, gridColor);
    }
    for (y = top; y >= bottom - 0.01; y -= step) {
        _bwdGridLine(grid, left, y, right, y, gridColor);
    }
    grid.locked = true;

    // Stickers (above Grid): empty; Step 7B fills it after nesting.
    var stickers = doc.layers.add();
    stickers.name = CONFIG.stickersLayerName ? CONFIG.stickersLayerName : "Sticker";

    // Margin band (top): the printable-area guide. Cutlines must stay inside it
    // (touching allowed); nesting and QA both reference its inner rectangle.
    _bwdMarginBand(doc);

    log("[aiutils] built working document | A4 RGB | Margin > Stickers > Grid > Color Block");
    return doc;
}

// Canonical printable-area spec — the SINGLE source of truth for the margin.
// Documented working area: 190 x 267 mm = A4 minus 10mm top/left/right + 20mm bottom.
// Pipelines reference these (e.g. workingAreaWidthMm: MARGIN_SPEC.workingAreaWidthMm)
// instead of repeating literals, so the value cannot drift between pipeline and QA.
var MARGIN_SPEC = {
    marginLeftMm:       10,
    marginTopMm:        10,
    workingAreaWidthMm: 190,
    workingAreaHeightMm: 267
};

// Single source of truth for the shared QA overlay layer name. Pipelines set
// CONFIG.qaLayerName from this, and Step 11 strips QA_LAYER_NAME.toLowerCase() —
// so the reserved name cannot drift between where it's created and where it's
// stripped (a drift would leak the overlay into the final print file).
var QA_LAYER_NAME = "Layout QA";

// Inner safe-area rectangle as geometricBounds [left, top, right, bottom] (AI y-up).
// Reads CONFIG when a pipeline supplies the values, else falls back to MARGIN_SPEC —
// so nesting, the drawn margin band, and Steps 8c/QA all resolve the same boundary.
function marginRect(doc) {
    var ab = doc.artboards[0].artboardRect;
    var lM = (CONFIG && CONFIG.marginLeftMm        != null) ? CONFIG.marginLeftMm       : MARGIN_SPEC.marginLeftMm;
    var tM = (CONFIG && CONFIG.marginTopMm         != null) ? CONFIG.marginTopMm        : MARGIN_SPEC.marginTopMm;
    var wW = (CONFIG && CONFIG.workingAreaWidthMm   != null) ? CONFIG.workingAreaWidthMm  : MARGIN_SPEC.workingAreaWidthMm;
    var wH = (CONFIG && CONFIG.workingAreaHeightMm  != null) ? CONFIG.workingAreaHeightMm : MARGIN_SPEC.workingAreaHeightMm;
    var left   = ab[0] + mmToPoints(lM);
    var top    = ab[1] - mmToPoints(tM);
    var right  = left  + mmToPoints(wW);
    var bottom = top   - mmToPoints(wH);
    return [left, top, right, bottom];
}

// Builds the "Margin" layer's band: a compound path of two rectangles (outer =
// artboard, inner = safe area), filled 30% black with the even-odd rule so the
// border band shows and the printable interior is a transparent hole. Locked,
// brought to front — matches the band style artists are used to seeing.
function _bwdMarginBand(doc) {
    var ab = doc.artboards[0].artboardRect;   // [l, t, r, b]
    var mr = marginRect(doc);                  // inner safe area [l, t, r, b]

    var margin = doc.layers.add();
    margin.name = (CONFIG && CONFIG.marginLayerName) ? CONFIG.marginLayerName : "Margin";
    doc.activeLayer = margin;

    var outer = margin.pathItems.rectangle(ab[1], ab[0], ab[2] - ab[0], ab[1] - ab[3]);
    var inner = margin.pathItems.rectangle(mr[1], mr[0], mr[2] - mr[0], mr[1] - mr[3]);

    // Style the rects BEFORE compounding — setting fill on the compound does not
    // propagate to its sub-paths (they keep the default 0-ink fill), so the band
    // would render invisible. Set black fill + no stroke on each rect first.
    var rects = [outer, inner], ri;
    for (ri = 0; ri < rects.length; ri++) {
        rects[ri].filled     = true;
        rects[ri].fillColor  = blackRgb();
        rects[ri].stroked    = false;
        rects[ri].evenodd    = true;   // even-odd lives on PathItem (NOT CompoundPathItem);
                                       // set on the members so the inner rect reads as a hole.
                                       // Winding-independent, so the frame punches regardless of
                                       // which direction pathItems.rectangle() winds the rects.
    }

    // Build the compound path natively via the DOM — NOT executeMenuCommand,
    // which drives the "Object > Compound Path > Make" UI menu and silently
    // NO-OPs on a cold-launched (not-yet-warm) Illustrator: it creates ZERO
    // compound paths, so margin.compoundPathItems[0] then throws Error 1302
    // ("No such element") and the whole pipeline dies at document setup. Instead
    // add an empty compound path item and reparent the two styled rects into it
    // (an empty-container + move() reparenting idiom) — works cold.
    var cp = margin.compoundPathItems.add();
    outer.move(cp, ElementPlacement.PLACEATEND);
    inner.move(cp, ElementPlacement.PLACEATEND);

    // Guard: a healthy compound now holds exactly the two subpaths. If the DOM
    // construction somehow yielded nothing (rather than silently limping on to a
    // 1302 elsewhere), fail loudly with an actionable message.
    if (margin.compoundPathItems.length === 0 || cp.pathItems.length < 2) {
        throw new Error("Margin band: compound path build failed (compoundPaths=" +
            margin.compoundPathItems.length + ", subpaths=" +
            (cp ? cp.pathItems.length : "n/a") +
            ") — expected 1 compound of 2 rects. Try re-running once Illustrator is fully launched.");
    }

    // A DOM-created compound does NOT inherit appearance from a Make-Compound-Path
    // selection, so paint the compound itself black too (belt-and-suspenders with
    // the per-rect styling above) — otherwise the band could render invisible.
    // NOTE: the hole comes from evenodd set on the MEMBER PathItems above, not here —
    // CompoundPathItem has no evenodd property, so setting it on `cp` was a silent
    // no-op that left the band a solid slab (default non-zero winding, same-direction
    // rects → no hole). Do not re-add cp.evenodd.
    cp.filled    = true;
    cp.fillColor = blackRgb();
    cp.stroked   = false;
    cp.opacity   = 30;     // 30% black band — container opacity (applies to the whole compound)

    margin.zOrder(ZOrderMethod.BRINGTOFRONT);
    margin.locked = true;
    return margin;
}

// The Color Block green — the Step 10 green-preview background (mimics the green
// backing sheet). sRGB equivalent of the old CMYK(55,0,100,0). Preview only; not
// printed art. Adjust here if the artist wants a specific brand green.
function _bwdGreen() {
    var c = new RGBColor();
    c.red = 133; c.green = 184; c.blue = 68;
    return c;
}

// Light grey for the reference grid — subtle, non-printing visual aid.
function _bwdGridColor() {
    var c = new RGBColor();
    c.red = 204; c.green = 204; c.blue = 204;   // was CMYK K=20
    return c;
}

// Draws one thin open grid line on the given layer.
function _bwdGridLine(layer, x1, y1, x2, y2, color) {
    var ln = layer.pathItems.add();
    ln.setEntirePath([[x1, y1], [x2, y2]]);
    ln.filled      = false;
    ln.stroked     = true;
    ln.strokeColor = color;
    ln.strokeWidth = 0.3;
    ln.closed      = false;
}

// Finds a path item by exact name within a layer.
// Returns null if not found.
function findPathInLayer(layer, name) {
    for (var i = 0; i < layer.pathItems.length; i++) {
        if (layer.pathItems[i].name === name) return layer.pathItems[i];
    }
    return null;
}

// ─── COLOUR HELPERS ───────────────────────────────────────────────────────────
// RGB (sRGB) throughout — the working document is RGB (see buildWorkingDocument).
// Cut lines stay pure black; the RGB values below are the sRGB equivalents of the
// former CMYK definitions (comments record the original CMYK for reference).

// Returns an RGBColor set to pure black (cut/half-cut lines).
function blackRgb() {
    var c = new RGBColor();
    c.red = 0; c.green = 0; c.blue = 0;   // was CMYK K=100
    return c;
}

// Returns an RGBColor set to white (caption pills, stamp backing).
function whiteRgb() {
    var c = new RGBColor();
    c.red = 255; c.green = 255; c.blue = 255;   // was CMYK 0/0/0/0
    return c;
}

// Returns an RGBColor set to pure red (#ff0000) — QA spacing stroke.
function redRgb() {
    var c = new RGBColor();
    c.red = 255; c.green = 0; c.blue = 0;   // was CMYK 0/100/100/0
    return c;
}

// Warm amber/orange — the QA colour for MARGIN overflow, distinct at a glance from
// the red used for spacing pinches. Reads clearly over the grey margin band where
// the overhang fill sits.
function amberRgb() {
    var c = new RGBColor();
    c.red = 255; c.green = 115; c.blue = 0;   // was CMYK 0/55/100/0
    return c;
}

// Cool blue — the NEUTRAL "this element needs attention" halo colour. Deliberately
// not red/amber so an element with BOTH a spacing and a margin issue isn't forced
// into one type-colour: the halo just says "look here" (visible at full-sheet zoom
// as a tint over the sticker), while the red/amber badges carry the problem type.
function haloRgb() {
    var c = new RGBColor();
    c.red = 76; c.green = 178; c.blue = 255;   // was CMYK 70/30/0/0
    return c;
}

// The half-cut QA flag colour — a medium blue, distinct from red (spacing) and amber
// (margin) on the shared Layout QA overlay, and readable on the green Color Block.
function halfcutFlagRgb() {
    var c = new RGBColor();
    c.red = 26; c.green = 102; c.blue = 255;
    return c;
}

// ─── PATH STYLE HELPERS ───────────────────────────────────────────────────────

// Applies stroke style to a PathItem or CompoundPathItem.
// colorObj must be an RGBColor (or CMYKColor) instance.
function setStrokeStyle(path, weightPt, colorObj) {
    path.stroked    = true;
    path.strokeWidth = weightPt;
    path.strokeColor = colorObj;
    path.filled     = false;
}

// Calls fn(pathItem) on every leaf PathItem reachable from item, handling the three
// container shapes uniformly: a PathItem is the leaf; a CompoundPathItem is styled
// through its sub-paths (its own .filled/.strokeColor do NOT reliably propagate —
// setting them left fused cutlines black-filled); a GroupItem is recursed via
// pageItems (the typed collections pathItems/compoundPathItems/groupItems are
// inconsistently recursive across AI versions and silently miss deeper nestings,
// while pageItems lists every direct child of any type). Both strokeRecursive and
// _qaFillRecursive share this walker so a traversal fix lands in one place.
function applyToPathTree(item, fn) {
    if (item.typename === "PathItem") {
        fn(item);
        return;
    }
    if (item.typename === "CompoundPathItem") {
        for (var c = 0; c < item.pathItems.length; c++) fn(item.pathItems[c]);
        return;
    }
    if (item.typename === "GroupItem") {
        for (var i = 0; i < item.pageItems.length; i++) applyToPathTree(item.pageItems[i], fn);
    }
}

// Applies stroke style (and clears fill) to every leaf path of item (PathItem,
// CompoundPathItem sub-paths, or any depth of GroupItem).
function strokeRecursive(item, weightPt, colorObj) {
    applyToPathTree(item, function (p) { setStrokeStyle(p, weightPt, colorObj); });
}

// ─── CAPTION PLATE HELPERS ───────────────────────────────────────────────────

// Builds a caption-plate pill PathItem from AI-space bounds [left, top, right,
// bottom] (AI y-up). Fully rounded ends (radius = half height).
function buildPlate(layer, aiBounds) {
    var left = aiBounds[0], top = aiBounds[1], right = aiBounds[2], bottom = aiBounds[3];
    var w = right - left;
    var h = top - bottom;
    var r = (h < w ? h : w) / 2; // never exceed the shorter half-extent
    var p = layer.pathItems.roundedRectangle(top, left, w, h, r, r);
    p.filled  = true;   // filled so the boolean union has an area to add
    p.stroked = false;
    return p;
}

// Builds a caption-plate capsule PathItem that FOLLOWS a fitted spine (curved or
// tilted captions), instead of an axis-aligned pill. spinePts is an array of
// {x,y} in AI points (y-up); radius in points. The offset-spine sides mirror
// Step 3B's _capsulePolygon (Photoshop); the rounded ENDS are exact bezier arcs
// (_capsuleBezierNodes) so they trace true circles, not the old 10-chord facets,
// so the cutline's caption portion matches the real White pill. Returns a filled,
// unstroked PathItem ready for deriveCutline's boolean union.
function buildCapsuleFromSpine(layer, spinePts, radius) {
    var nodes = _capsuleBezierNodes(spinePts, radius);   // sides = corners, ends = bezier arcs
    var coords = [], i;
    for (i = 0; i < nodes.length; i++) coords.push(nodes[i].anchor);
    var p = layer.pathItems.add();
    p.setEntirePath(coords);
    p.closed = true;    // setEntirePath can drop the closed flag
    // Assign the cap bezier handles (setEntirePath lays down straight corners only).
    var pts = p.pathPoints;
    for (i = 0; i < nodes.length; i++) {
        var pp = pts[i], nd = nodes[i];
        pp.leftDirection  = nd.leftDir;
        pp.rightDirection = nd.rightDir;
        pp.pointType = nd.smooth ? PointType.SMOOTH : PointType.CORNER;
    }
    p.filled  = true;
    p.stroked = false;
    return p;
}

function _capUnit(x, y) {
    var len = Math.sqrt(x * x + y * y) || 1;
    return [x / len, y / len];
}

// ─── BEZIER END-CAPS (smooth rounded pill ends — the Live Corners equivalent) ───
// The pill's rounded ends were once a 10-STRAIGHT-chord polygon approximation of a semicircle,
// whose flat facets read as jagged at print zoom. These two helpers rebuild each cap as exact
// circular-arc CUBIC bezier segments (kappa handles), so the ends are truly round — the scripted
// twin of manually dragging Illustrator's Live Corners widget to maximum. Node-testable (see
// tests/integration/unit/test-caption-capend.js).

// Returns the bezier anchor nodes of a circular arc around centre C {x,y}, radius r, sweeping
// from fromPt [x,y] to toPt [x,y] through the outward direction `through` [x,y] (the sweep is
// disambiguated so the cap bulges away from the pill, not through it). Each node
// is { anchor:[x,y], leftDir:[x,y], rightDir:[x,y], ang }. Endpoints are node[0] (=fromPt) and
// node[k] (=toPt); handles use the exact quarter-arc constant h = r·(4/3)·tan(Δ/4).
function _capArcNodes(C, r, fromPt, toPt, through) {
    var a0 = Math.atan2(fromPt[1] - C.y, fromPt[0] - C.x);
    var a1 = Math.atan2(toPt[1]   - C.y, toPt[0]   - C.x);
    var sweep = a1 - a0;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;
    while (sweep > Math.PI)  sweep -= 2 * Math.PI;
    var midAng = a0 + sweep / 2;
    if (Math.cos(midAng) * through[0] + Math.sin(midAng) * through[1] < 0) {
        sweep += (sweep > 0 ? -2 * Math.PI : 2 * Math.PI);
    }
    var k = Math.ceil(Math.abs(sweep) / (Math.PI / 2));   // ≤90° per segment for arc accuracy
    if (k < 2) k = 2;                                      // a 180° cap is always ≥2 segments
    var d = sweep / k;
    var h = r * (4 / 3) * Math.tan(d / 4);                // signed: h carries the sweep direction
    var out = [], s;
    for (s = 0; s <= k; s++) {
        var ang = a0 + d * s;
        var ax = C.x + r * Math.cos(ang), ay = C.y + r * Math.sin(ang);
        var tx = -Math.sin(ang), ty = Math.cos(ang);      // unit tangent (dir of increasing ang)
        out.push({
            anchor:   [ax, ay],
            rightDir: [ax + h * tx, ay + h * ty],
            leftDir:  [ax - h * tx, ay - h * ty],
            ang: ang
        });
    }
    return out;
}

// Builds the capsule outline from a fitted spine: the long sides are offset-spine corner nodes
// (as in Step 3B's PS _capsulePolygon), but the two rounded ENDS are exact bezier arcs instead of
// 10-chord polylines. Returns an ordered, CLOSED list of path nodes for setEntirePath + handle
// assignment: { anchor:[x,y], leftDir:[x,y], rightDir:[x,y], smooth:Bool }. The long sides stay
// corner nodes at the offset-spine points (unchanged); only the caps curve. smooth=true marks
// the arc-interior anchors (collinear handles → PointType.SMOOTH); junction/side anchors are
// corners with one straight side and one arc-tangent side.
function _capsuleBezierNodes(spine, r) {
    var n = spine.length, i;
    var top = [], bot = [];
    for (i = 0; i < n; i++) {
        var p0 = spine[i > 0 ? i - 1 : i];
        var p1 = spine[i < n - 1 ? i + 1 : i];
        var tx = p1.x - p0.x, ty = p1.y - p0.y;
        var len = Math.sqrt(tx * tx + ty * ty) || 1;
        var nx = -ty / len, ny = tx / len;               // unit normal (same as _capsulePolygon)
        top.push([spine[i].x + r * nx, spine[i].y + r * ny]);
        bot.push([spine[i].x - r * nx, spine[i].y - r * ny]);
    }
    var endT   = _capUnit(spine[n - 1].x - spine[n - 2 >= 0 ? n - 2 : 0].x,
                          spine[n - 1].y - spine[n - 2 >= 0 ? n - 2 : 0].y);
    var startT = _capUnit(spine[0].x - spine[1 < n ? 1 : 0].x,
                          spine[0].y - spine[1 < n ? 1 : 0].y);
    var endArc   = _capArcNodes(spine[n - 1], r, top[n - 1], bot[n - 1], endT);
    var startArc = _capArcNodes(spine[0],     r, bot[0],     top[0],     startT);
    var ke = endArc.length - 1, ks = startArc.length - 1;

    function corner(a) { return { anchor: a, leftDir: a, rightDir: a, smooth: false }; }
    var nodes = [];
    // node[0] = top[0]: closes the ring, so its leftDir carries the start-cap's final tangent.
    nodes.push({ anchor: top[0], leftDir: startArc[ks].leftDir, rightDir: top[0], smooth: false });
    for (i = 1; i <= n - 2; i++) nodes.push(corner(top[i]));                 // top side interior
    // top[n-1]: junction — straight into the side (left), curves into the end cap (right).
    nodes.push({ anchor: endArc[0].anchor, leftDir: endArc[0].anchor, rightDir: endArc[0].rightDir, smooth: false });
    for (i = 1; i <= ke - 1; i++) nodes.push({ anchor: endArc[i].anchor, leftDir: endArc[i].leftDir, rightDir: endArc[i].rightDir, smooth: true });
    // bot[n-1]: junction — curves out of the end cap (left), straight into the side (right).
    nodes.push({ anchor: endArc[ke].anchor, leftDir: endArc[ke].leftDir, rightDir: endArc[ke].anchor, smooth: false });
    for (i = n - 2; i >= 1; i--) nodes.push(corner(bot[i]));                 // bot side interior
    // bot[0]: junction — straight into the side (left), curves into the start cap (right).
    nodes.push({ anchor: startArc[0].anchor, leftDir: startArc[0].anchor, rightDir: startArc[0].rightDir, smooth: false });
    for (i = 1; i <= ks - 1; i++) nodes.push({ anchor: startArc[i].anchor, leftDir: startArc[i].leftDir, rightDir: startArc[i].rightDir, smooth: true });
    return nodes;   // ring closes from the last start-cap interior node back to node[0] (top[0])
}

// ─── CAPTION SPINE FIT (baseline-based — pure geometry, node-testable) ───
// The pill spine is derived from the text BASELINE (per-column bottom-of-ink), NOT the ink
// midpoint. The midpoint moves with glyph height (caps vs x-height vs ascenders) and isolated
// marks, so it spuriously bows/tilts under straight text; the baseline is glyph-height-invariant
// — every on-baseline glyph sits on it — so straight text fits flat regardless of the letters.
// Under a warp the baseline and the centreline are parallel arcs (same curvature), so curvature
// measured on the clean baseline transfers to the centreline. (Replaces the old midpoint
// _capQuadFitSpine, which the new crisp-vector pill exposed as under-robust — see
// docs/superpowers/specs/2026-06-27-caption-pill-baseline-spine-design.md.)

// y of a fitted quadratic { a, b, c, xm } at px. Coordinate-agnostic (PS y-down / AI y-up).
function _capYAt(fit, px) { var d = px - fit.xm; return fit.a * d * d + fit.b * d + fit.c; }

// Slope dy/dx of a fitted quadratic { a, b, c, xm } at px. Twin of _capYAt.
function _capSlopeAt(fit, px) { return 2 * fit.a * (px - fit.xm) + fit.b; }

// The pill spine: M+1 points spanning [x0,x1], following the fitted baseline lifted by halfBody.
//
// The subtlety is what happens OUTSIDE the fitted baseline range [fx0,fx1]. The spine must span
// the full text box, but the quadratic must NOT be extrapolated past its data — a parabola
// overshoots hard beyond the last sample, which flared the pill ends (worst on a multi-line
// caption whose bottom line is narrower than the box).
//
// The previous guard clamped the VALUE (y = y(fx0) for every sx < fx0), which fixed the overshoot
// but destroyed the END TANGENT — the thing the caps are built from. buildCapsuleFromSpine takes
// each cap's orientation from spine[0]->spine[1] (and spine[n-2]->spine[n-1]). With a clamped
// spine[0] those two points sit ~1.5pt apart in x while their heights come from x-positions only
// ~0.08pt apart on the curve (the sampler's first baseline point is the MIDPOINT of a 1mm band,
// so fx0 already sits ~1.4pt inside x0). The chord between them therefore carried ~5% of the true
// end slope — effectively horizontal — and the cap, laid perpendicular to it, came out
// axis-aligned on a pill whose end genuinely rises. That is the "curved caption with horizontal
// pill ends" bug (artist, 2026-07-17).
//
// So: extend LINEARLY along the fit's tangent at the endpoint instead. C1-continuous at fx0/fx1,
// the end tangent stays honest (caps tilt with the curve), and a straight line cannot overshoot
// the way the parabola could — which is what the clamp was defending against. Clamp the
// CURVATURE, not the value.
function _capSpinePoints(fit, x0, x1, fx0, fx1, halfBody, M) {
    var spine = [], p, sx, y;
    for (p = 0; p <= M; p++) {
        sx = x0 + (x1 - x0) * (p / M);
        if (sx < fx0)      y = _capYAt(fit, fx0) + _capSlopeAt(fit, fx0) * (sx - fx0);
        else if (sx > fx1) y = _capYAt(fit, fx1) + _capSlopeAt(fit, fx1) * (sx - fx1);
        else               y = _capYAt(fit, sx);
        spine.push({ x: sx, y: y + halfBody });
    }
    return spine;
}

// Robust least-squares quadratic through baseline-candidate points (per-column bottom-of-ink).
// Rejects descenders (sit below the baseline) and floating marks — apostrophes, dots, accents
// (sit above) — via a median/MAD inlier test, 2 iterations. Decides straight vs curved from the
// inlier fit's deviation from its endpoint CHORD (pure curvature, tilt removed). pts: [{x,y}].
// Returns { straight:Bool, bow:Number, nIn:Number, fit:{a,b,c,xm} }.
// straight when there are fewer than minCols inliers (too sparse to trust a curve) OR the
// chord-bow stays within snapTolPt.
function _capRobustBaselineFit(pts, x0, x1, snapTolPt, minCols) {
    if (!pts || pts.length < 3) {
        return { straight: true, bow: 0, nIn: pts ? pts.length : 0, fit: { a: 0, b: 0, c: 0, xm: 0 } };
    }
    function fitQuad(ps) {
        var n = ps.length, i, xm = 0;
        for (i = 0; i < n; i++) xm += ps[i].x; xm /= n;
        var S0 = n, S1 = 0, S2 = 0, S3 = 0, S4 = 0, Ty = 0, Txy = 0, Tx2y = 0;
        for (i = 0; i < n; i++) {
            var dx = ps[i].x - xm, y = ps[i].y, dx2 = dx * dx;
            S1 += dx; S2 += dx2; S3 += dx2 * dx; S4 += dx2 * dx2;
            Ty += y; Txy += dx * y; Tx2y += dx2 * y;
        }
        var a = 0, b = 0, c = Ty / n;
        var sol = _capSolve3(S4, S3, S2, S3, S2, S1, S2, S1, S0, Tx2y, Txy, Ty);
        if (sol) { a = sol[0]; b = sol[1]; c = sol[2]; }
        return { a: a, b: b, c: c, xm: xm };
    }
    function median(arr) {
        var a = arr.slice(0).sort(function (p, q) { return p - q; }), n = a.length;
        if (!n) return 0;
        return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
    }
    var inl = pts, f = fitQuad(inl), iter, i;
    for (iter = 0; iter < 2; iter++) {
        var res = [];
        for (i = 0; i < pts.length; i++) res.push(pts[i].y - _capYAt(f, pts[i].x));
        var med = median(res), ad = [];
        for (i = 0; i < res.length; i++) ad.push(Math.abs(res[i] - med));
        var mad = median(ad); if (mad < 0.5) mad = 0.5;   // floor: don't over-reject a clean baseline
        var keep = [];
        for (i = 0; i < pts.length; i++) if (Math.abs(res[i] - med) <= 2.5 * mad) keep.push(pts[i]);
        if (keep.length < minCols) break;                  // too few inliers to refine — stop
        inl = keep; f = fitQuad(inl);
    }
    // Pure curvature = max deviation of the inlier fit from the chord through its endpoints.
    var y0 = _capYAt(f, x0), y1 = _capYAt(f, x1), bow = 0, p;
    for (p = 0; p <= 24; p++) {
        var px = x0 + (x1 - x0) * (p / 24);
        var ch = (x1 === x0) ? y0 : y0 + (y1 - y0) * ((px - x0) / (x1 - x0));
        var dv = Math.abs(_capYAt(f, px) - ch);
        if (dv > bow) bow = dv;
    }
    var straight = (inl.length < minCols) || (bow <= snapTolPt);
    return { straight: straight, bow: bow, nIn: inl.length, fit: f };
}

// For a MULTI-LINE caption, keep only the bottom line's baseline points. The per-column
// bottom-of-ink (the baseline proxy) jumps UP to an upper line wherever the bottom line is
// narrower and doesn't cover that column, so the full-width envelope of a flat-but-narrow-bottom
// caption (e.g. "St Elizabeth's Cathedral | (Dóm Svätej Alzbety)") fakes a ∪ curve and the pill
// is wrongly built curved. We split the baseline-y values at their single largest gap (the
// inter-line break ≈ the leading, far bigger than within-line column noise) and return the LOW
// group (y-up: the bottom line sits at smaller y). Guards keep it conservative — only when the
// caller says the caption is multi-line, only when a real break exists, and only if the bottom
// group is big enough to trust; otherwise the input is returned untouched (single-line is never
// reshaped, and a lone descender can't split a one-line caption). Pure geometry — node-testable.
// The break gap is SIZE-RELATIVE: a fraction (lineBreakFrac) of the caption's per-line height
// (`lineHeightPt`, passed by the caller as text-box-height / line-count), so it tracks the font
// instead of a fixed pt value (the caption size is a CONFIG knob that has changed before). A real
// inter-line break is ≈0.6–0.7 of a line; the within-line bottom-of-ink noise (descenders) ≈0.25;
// 0.3 separates them. Fallback ≈ an 8pt-caption leading if the caller can't supply a height.
function _capBottomLineBaseline(base, isMultiLine, lineHeightPt) {
    var lineBreakFrac = 0.3;
    var lineBreakPt = (lineHeightPt > 0 ? lineHeightPt : 9.6) * lineBreakFrac;
    if (!isMultiLine || !base || base.length < 6) return base;
    var ys = [], i;
    for (i = 0; i < base.length; i++) ys.push(base[i].y);
    ys.sort(function (p, q) { return p - q; });
    var maxGap = 0, splitY = ys[0];
    for (i = 1; i < ys.length; i++) {
        var g = ys[i] - ys[i - 1];
        if (g > maxGap) { maxGap = g; splitY = (ys[i] + ys[i - 1]) / 2; }
    }
    if (maxGap < lineBreakPt) return base;              // no real line break -> leave untouched
    var low = [];
    for (i = 0; i < base.length; i++) if (base[i].y < splitY) low.push(base[i]);
    return (low.length >= 4) ? low : base;              // bottom cluster too small to trust
}

// Two-point horizontal spine at height y over [x0, x1].
function _capStraightSpine(x0, x1, y) { return [{ x: x0, y: y }, { x: x1, y: y }]; }

// Splits a caption display name into stacked lines on "|": "A | B" -> ["A","B"]. Trims each
// segment and drops empties; a name with no "|" returns a single-element array. The cutline
// group name and the text-frame name keep the FULL string — only the visible text uses these.
function _capSplitLines(displayName) {
    var whole = String(displayName == null ? "" : displayName);
    var raw = whole.split("|"), out = [], i, s;
    for (i = 0; i < raw.length; i++) {
        s = raw[i].replace(/^\s+|\s+$/g, "");
        if (s.length > 0) out.push(s);
    }
    if (out.length === 0) out.push(whole.replace(/^\s+|\s+$/g, ""));
    return out;
}

// p-quantile (0..1) of a numeric array (need not be sorted).
function _capPercentile(arr, p) {
    var a = arr.slice(0);
    a.sort(function (x, y) { return x - y; });
    var idx = Math.floor(p * (a.length - 1));
    if (idx < 0) idx = 0;
    if (idx > a.length - 1) idx = a.length - 1;
    return a[idx];
}

// Solves a 3x3 linear system by Cramer's rule. Returns [x,y,z] or null if singular.
function _capSolve3(a11, a12, a13, a21, a22, a23, a31, a32, a33, b1, b2, b3) {
    function det3(m11, m12, m13, m21, m22, m23, m31, m32, m33) {
        return m11 * (m22 * m33 - m23 * m32) - m12 * (m21 * m33 - m23 * m31) + m13 * (m21 * m32 - m22 * m31);
    }
    var D = det3(a11, a12, a13, a21, a22, a23, a31, a32, a33);
    if (Math.abs(D) < 1e-9) return null;
    var Dx = det3(b1, a12, a13, b2, a22, a23, b3, a32, a33);
    var Dy = det3(a11, b1, a13, a21, b2, a23, a31, b3, a33);
    var Dz = det3(a11, a12, b1, a21, a22, b2, a31, a32, b3);
    return [Dx / D, Dy / D, Dz / D];
}

// ─── CAPTION TEXT SAMPLER (AI vector analog of PS _sampleTextSpine) ───
// Outlines a COPY of the text and samples it in 1mm-wide BANDS (matching PS _sampleTextSpine,
// which reads the bounding-span of all ink in a slice — the AI port had regressed this to a
// single scan line, which over-reacts to isolated marks and gaps). Per band it records the
// bottom-of-ink (baseline candidate) and the ink height. Returns
//   { base:[{x,y}…] (band centre x, bottom-of-ink y), heights:[Number…], bounds:[l,t,r,b] }
// in AI points (y-up), or null if there is no ink.
function _capSampleTextOutline(textFrame, sliceMm) {
    var dup = textFrame.duplicate();
    // Bake any live appearance (e.g. a Step-6 Arc warp) into geometry so the sampled baseline
    // reflects the warp. expandStyle is a no-op for a plain frame, which then still needs
    // createOutline; a warped frame expands to a group of warped paths we can sample directly.
    var outlined;
    try {
        app.selection = [dup];
        app.executeMenuCommand("expandStyle");
        var ex = (app.selection && app.selection.length) ? app.selection[0] : dup;
        outlined = (ex.typename === "TextFrame") ? ex.createOutline() : ex;
    } catch (eEx) {
        outlined = dup.createOutline();
    }
    var polys = samplePathToPolygons(outlined, 16);
    var gb = outlined.geometricBounds;           // [l, t, r, b]  (t > b, y-up)
    try { outlined.remove(); } catch (e) {}
    if (!polys || polys.length === 0) return null;

    var L = gb[0], T = gb[1], R = gb[2], B = gb[3];
    if (R - L <= 0 || T - B <= 0) return null;
    var step = mmToPoints(sliceMm), base = [], heights = [], x;
    for (x = L; x < R; x += step) {
        var bx1 = (x + step < R) ? x + step : R;
        var span = _capBandSpan(polys, x, bx1, 8); // {lo, hi} = span of all ink in the band, or null
        if (!span) continue;
        base.push({ x: (x + bx1) / 2, y: span.lo }); // bottom-of-ink = baseline candidate
        heights.push(span.hi - span.lo);
    }
    if (base.length === 0) return null;
    return { base: base, heights: heights, bounds: [L, T, R, B] };
}

// Filled vertical span of a polygon set over a BAND [x0, x1]: union of the per-scanline spans
// at sub+1 sample columns across the band (PS reads the band's pixel bounding box). {lo,hi} or null.
function _capBandSpan(polys, x0, x1, sub) {
    var lo = null, hi = null, j, n = (sub > 0 ? sub : 1);
    for (j = 0; j <= n; j++) {
        var x = (x1 === x0) ? x0 : x0 + (x1 - x0) * (j / n);
        var sp = _capColumnSpan(polys, x);
        if (!sp) continue;
        if (lo === null || sp.lo < lo) lo = sp.lo;
        if (hi === null || sp.hi > hi) hi = sp.hi;
    }
    if (lo === null) return null;
    return { lo: lo, hi: hi };
}

// Filled vertical span of a polygon set at vertical line x: the min and max y over all
// crossings of the line x with the polygons' edges. Returns {lo, hi} or null.
function _capColumnSpan(polys, x) {
    var lo = null, hi = null, p, k, A, Bp, ys;
    for (p = 0; p < polys.length; p++) {
        var poly = polys[p];
        for (k = 0; k < poly.length; k++) {
            A = poly[k]; Bp = poly[(k + 1) % poly.length];
            if ((A.x <= x && Bp.x > x) || (Bp.x <= x && A.x > x)) {   // edge straddles x
                ys = A.y + (Bp.y - A.y) * ((x - A.x) / (Bp.x - A.x));
                if (lo === null || ys < lo) lo = ys;
                if (hi === null || ys > hi) hi = ys;
            }
        }
    }
    if (lo === null) return null;
    return { lo: lo, hi: hi };
}

// Bottom-edge profile of a sampled outline (polys from samplePathToPolygons) over [x0,x1]:
// per column the LOWEST crossing y (lower envelope). Returns [{x,y}…] (y-up: lower = smaller y);
// columns with no ink are skipped. Pure geometry (reuses _capColumnSpan) — node-testable.
function _capBottomProfile(polys, x0, x1, stepPt) {
    var out = [], x, step = (stepPt > 0 ? stepPt : 1);
    for (x = x0; x <= x1 + 1e-6; x += step) {
        var sp = _capColumnSpan(polys, x);
        if (sp) out.push({ x: x, y: sp.lo });
    }
    return out;
}

// Decides whether a caption under this base should warp. CONSERVATIVE: returns warp:false on
// anything wavy/ambiguous (default flat). Reuses _capRobustBaselineFit (robust quadratic + chord
// bow) then gates:
//   A arc-like:  residual RMS over ALL profile pts <= maxResidPt (wavy/notched => high resid => flat)
//   B symmetric: fitted vertex near the span centre (an off-centre lump => flat)
//   C round:     SIZE-RELATIVE — the curve's circle is no bigger than the element
//                (radius <= tightFactor*elementWidth), scale-invariant, so a tiny egg and a big plate
//                both pass AND a short caption over a round base still warps; OR the edge clearly
//                dips across the caption (bow >= minBowPt), catching a wide gently-round base whose
//                circle is large vs the element. NO radius floor — a sharp notch is caught by A.
// radius ~ 1/(2|a|). bend carries DIRECTION only (a>0 = valley/smile = round base; a<0 = arch) —
// warpTextToBaseArc computes the magnitude that matches the base radius. Pure geometry —
// node-testable. Returns {warp,bend,radius,bow,resid,reason}.
function _capBaseArcFit(profilePts, x0, x1, opts) {
    opts = opts || {};
    var minCols     = opts.minCols     != null ? opts.minCols     : 8;
    var minBowPt    = opts.minBowPt    != null ? opts.minBowPt    : 1.42;
    var maxResidPt  = opts.maxResidPt  != null ? opts.maxResidPt  : 1.42;
    var tightFactor = opts.tightFactor != null ? opts.tightFactor : 1.0;
    var elWidthPt   = opts.elementWidthPt != null ? opts.elementWidthPt : 0;
    var maxTiltDeg  = opts.maxTiltDeg  != null ? opts.maxTiltDeg  : 35;
    function none(reason) { return { warp: false, bend: 0, radius: 0, bow: 0, resid: 0, reason: reason }; }
    if (!profilePts || profilePts.length < minCols) return none("too few columns");

    var fit = _capRobustBaselineFit(profilePts, x0, x1, minBowPt, minCols);
    var i, se = 0, n = profilePts.length;
    for (i = 0; i < n; i++) { var dy = profilePts[i].y - _capYAt(fit.fit, profilePts[i].x); se += dy * dy; }
    var resid = Math.sqrt(se / n);
    if (resid > maxResidPt) return none("base not arc-like (resid " + resid.toFixed(2) + ")");

    var a = fit.fit.a;
    if (a === 0) return none("base ~flat (no curvature)");
    var radius = 1 / (2 * Math.abs(a));

    // Tilt cap (2026-07-04, replaces the old vertical-vertex "symmetry" test). A quadratic can only
    // be TILTED, not skewed, so "vertex xm-b/(2a) near the VERTICAL centre cx" was really rejecting
    // TILT in disguise: a balanced arc that is merely ANGLED has its lowest *vertical* point off to
    // the downhill side yet is centred along its own chord, and it SHOULD warp — the Run-2 seat
    // rotates the bent caption to the base chord (seatPlateToOutline), so a symmetric bend (radius R)
    // + seat tilt reconstructs the tilted arc. So judge in the chord frame (a symmetric arc is always
    // centred there) and reject only a base too STEEP to sit a caption on — it would climb the side.
    // Tilt = chord angle over the caption span.
    // ⚠ NOT yet Illustrator-validated: maxTiltDeg is a first guess. The reason string logs each
    //   element's tilt so a real fixture run reveals the actual distribution to tune against.
    if (x1 <= x0) return none("degenerate span");
    var tiltDeg = Math.abs(Math.atan2(_capYAt(fit.fit, x1) - _capYAt(fit.fit, x0), x1 - x0)) * 180 / Math.PI;
    if (tiltDeg > maxTiltDeg) return none("base too tilted (" + tiltDeg.toFixed(0) + "deg)");

    // Roundness — size-relative OR clear-dip (see header). The circle is the span-independent measure
    // of curvature; bow is span-dependent (a short caption under-reads a round base), so the size test
    // is primary and the bow test is the wide-gentle backup.
    var roundBySize = (elWidthPt > 0) && (radius <= tightFactor * elWidthPt);
    var roundByDip  = (fit.bow >= minBowPt);
    if (!roundBySize && !roundByDip) {
        return none("base ~flat (R/elW " + (elWidthPt > 0 ? (radius / elWidthPt).toFixed(2) : "?")
            + ", bow " + fit.bow.toFixed(2) + ")");
    }

    var bend = (a >= 0) ? 1 : -1;   // direction only; magnitude set by warpTextToBaseArc to match R
    return { warp: true, bend: bend, radius: radius, bow: fit.bow, resid: resid, tiltDeg: tiltDeg,
             reason: "warp (tilt " + tiltDeg.toFixed(0) + "deg)" };
}

// Builds the white caption pill around a native (artist-shaped) text frame: sample the text
// BASELINE -> robust-fit + snap -> radius from text height + pad -> sweep a capsule. One path
// for straight, multi-line, and curved text (no type branch). For straight/multi-line text it
// is the proven flat bbox stadium; the baseline-derived curved spine runs only for genuinely
// warped text. Returns { pill:PathItem (white, unstroked), spine:[{x,y}…], radius:Number }.
function buildCaptionPill(layer, textFrame, opts) {
    opts = opts || {};
    var sliceMm = opts.sliceMm != null ? opts.sliceMm : 1.0;
    var padPt   = mmToPoints(opts.padMm  != null ? opts.padMm  : 1.69);
    var snapPt  = mmToPoints(opts.snapMm != null ? opts.snapMm : 0.6);
    var pctile  = opts.pctile  != null ? opts.pctile  : 0.9;
    var minCols = opts.minCols != null ? opts.minCols : 8;

    var s = _capSampleTextOutline(textFrame, sliceMm);
    var bb = s ? s.bounds : textFrame.geometricBounds;   // [l,t,r,b] y-up
    var boxH = bb[1] - bb[3];

    // The flat bbox stadium: proven straight pill — covers the full text box (incl. descenders).
    function flatPill() {
        return { spine: _capStraightSpine(bb[0], bb[2], (bb[1] + bb[3]) / 2),
                 radius: boxH / 2 + padPt / 2 };
    }

    var spine, radius;
    if (!s || s.base.length < 3) {                 // degenerate -> flat
        var fp0 = flatPill(); spine = fp0.spine; radius = fp0.radius;
    } else {
        // For a multi-line caption judge straight/curved from only the BOTTOM line's baseline over
        // its own x-extent [fx0,fx1]: a narrower bottom line otherwise lets the upper line's baseline
        // (picked up at the edge columns it doesn't cover) fake a ∪ curve and build a wrongly curved
        // pill. The break gap is sized from the per-line height (boxH / line count). Single-line text
        // keeps all its points (only the sampler's edge margin is trimmed). See _capBottomLineBaseline.
        var lineCount = _capLineCount(textFrame);
        var lineHeightPt = (lineCount > 0) ? boxH / lineCount : boxH;
        var baseF = _capBottomLineBaseline(s.base, lineCount >= 2, lineHeightPt);
        var fx0 = baseF[0].x, fx1 = baseF[baseF.length - 1].x;
        var fit = _capRobustBaselineFit(baseF, fx0, fx1, snapPt, minCols);
        if (fit.straight) {                        // straight (single OR multi-line) -> flat bbox stadium
            var fp = flatPill(); spine = fp.spine; radius = fp.radius;
        } else {
            // Genuinely curved (single OR multi-line): the centreline is the bottom-of-ink baseline
            // lifted by half the body height (parallel under warp). For multi-line, the band sampler
            // reports the full two-line vertical span, so halfBody covers both lines + pad.
            var halfBody = _capPercentile(s.heights, pctile) / 2;
            radius = halfBody + padPt / 2;
            // Spans the full text box; outside the fitted baseline range the curve is extended
            // along its endpoint TANGENT (never extrapolated as a parabola, never flattened —
            // flattening is what gave curved captions horizontal caps). See _capSpinePoints.
            spine = _capSpinePoints(fit.fit, bb[0], bb[2], fx0, fx1, halfBody, 40);
        }
    }
    var pill = buildCapsuleFromSpine(layer, spine, radius);   // existing helper
    pill.filled = true; pill.fillColor = whiteRgb();
    pill.stroked = false;
    return { pill: pill, spine: spine, radius: radius };
}

// Warps a caption text frame to follow its element's curved base — but ONLY when the base is a
// confidently smooth, symmetric arc (see _capBaseArcFit). Measures the outline's bottom profile
// over the TEXT's x-span, fits, and on a pass applies a LIVE Arc warp via applyEffect (editable;
// the Pipeline-2 pill sampler bakes it for measurement). DOM-only, guarded — degrades to flat
// (warped:false) on any failure. Returns { warped:Bool, bend:Number, reason:String }.
function warpTextToBaseArc(textFrame, outline, opts) {
    opts = opts || {};
    var steps = opts.sampleSteps != null ? opts.sampleSteps : 16;
    var tb = textFrame.geometricBounds;            // [l,t,r,b] y-up
    var x0 = tb[0], x1 = tb[2], textH = tb[1] - tb[3];
    if (x1 - x0 <= 0) return { warped: false, bend: 0, reason: "empty text bounds" };

    var polys;
    try { polys = samplePathToPolygons(outline, steps); }
    catch (e) { return { warped: false, bend: 0, reason: "sample failed (" + e.message + ")" }; }

    var stepPt = (x1 - x0) / 48;                    // ~48 columns across the text span
    var profile = _capBottomProfile(polys, x0, x1, stepPt);
    var ob = outline.geometricBounds;               // element bounds — width is the scale the curve is judged against
    var elWidthPt = ob[2] - ob[0];
    var dec = _capBaseArcFit(profile, x0, x1, {
        minBowPt:       mmToPoints(opts.minBowMm != null ? opts.minBowMm : 0.5),
        maxResidPt:     (opts.maxResidFrac != null ? opts.maxResidFrac : 0.5) * textH,
        tightFactor:    opts.tightRadiusFactor != null ? opts.tightRadiusFactor : 1.0,
        maxTiltDeg:     opts.maxTiltDeg,   // null -> _capBaseArcFit's 35deg default
        elementWidthPt: elWidthPt
    });
    if (!dec.warp) return { warped: false, bend: 0, reason: dec.reason };

    // The caption arcs to the SAME radius as the base edge where it connects — an exact curvature
    // match (no offset). Illustrator's Arc obeys R = W / (2*sin(pi*B/2)) (measured, <1.5% error), so
    // the bend for a target radius R_text is B = (2/pi)*asin(W/(2*R_text)). W = the text width = the
    // connection span the base radius was measured over; R_text = the base radius itself. calib scales
    // it (1.0 = match exactly; <1 = gentler). (An earlier version added the placement gap to R_text,
    // making tight bases too gentle; dropped — the placement gap is temporary and unrelated to the
    // seated mate.)
    var W = x1 - x0;
    var calib   = opts.calib   != null ? opts.calib   : 1.0;
    var maxBend = opts.maxBend != null ? opts.maxBend : 0.6;
    var rTextPt = dec.radius;
    var sinArg  = (rTextPt > 0) ? (W / (2 * rTextPt)) : 1;
    if (sinArg > 1) sinArg = 1;                        // can't bend past a semicircle
    var mag = (2 / Math.PI) * Math.asin(sinArg) * calib;
    if (mag > maxBend) mag = maxBend;
    // "Adobe Deform" = Effect > Warp (NOT "Adobe Warp" — applyEffect silently ignores an unknown
    // name, which once made the whole warp a no-op). Arc = DeformStyle 1; Rotate 0 = horizontal.
    // Sign: Illustrator's Arc bends a POSITIVE value into an arch (middle up); a round/convex base
    // (dec.bend>=0, a U-valley bottom edge) needs a U, so DeformValue is NEGATIVE for a valley base.
    var deformValue = (dec.bend >= 0) ? -mag : mag;
    var xml = '<LiveEffect name="Adobe Deform"><Dict data="S DisplayString Warp:Arc I DeformStyle 1'
        + ' B Rotate 0 R DeformValue ' + deformValue + ' R DeformHoriz 0 R DeformVert 0 "/></LiveEffect>';
    // Defense-in-depth: applyEffect silently no-ops on an unrecognised effect name/dict (this is
    // exactly how the wrong "Adobe Warp" name passed once with zero visible bend). Compare the SAME
    // measure (visibleBounds = ink) before vs after: a real Arc warp lifts the ends (taller) and
    // pulls them inward (narrower). If neither moved, the effect did not render. (Comparing
    // visibleBounds to geometricBounds is WRONG — for text the ink box and the type box differ.)
    try { app.redraw(); } catch (eR0) {}
    var pre = textFrame.visibleBounds;             // [l,t,r,b] y-up — ink box before the warp
    var preH = pre[1] - pre[3], preW = pre[2] - pre[0];
    try { textFrame.applyEffect(xml); }
    catch (e2) { return { warped: false, bend: 0, reason: "warp effect rejected (" + e2.message + ")" }; }
    try { app.redraw(); } catch (eR1) {}           // render the live effect so visibleBounds is current
    var post = textFrame.visibleBounds;
    var dH = (post[1] - post[3]) - preH, dW = preW - (post[2] - post[0]);
    if (dH < 0.1 && Math.abs(dW) < 0.1) {
        return { warped: false, bend: 0, reason: "warp applied but did not render (effect no-op)" };
    }
    return { warped: true, bend: deformValue,
             reason: "warped R=" + Math.round(dec.radius) + "pt, tilt " + Math.round(dec.tiltDeg || 0) + "deg" };
}

// Count the caption's non-empty visual lines (point text -> a line per hard return). Drives both
// the multi-line test and the per-line height used to size the line-break gap in buildCaptionPill.
function _capLineCount(textFrame) {
    try {
        var s = String(textFrame.contents).split(/[\r\n]+/), n = 0, i;
        for (i = 0; i < s.length; i++) if (s[i].replace(/^\s+|\s+$/g, "").length > 0) n++;
        return n;
    } catch (e) { return 1; }
}
// Multi-line if the caption has >= 2 non-empty lines.
function _capIsMultiLine(textFrame) { return _capLineCount(textFrame) >= 2; }

// Caption note = "{style}|{lines}|a{pillAreaPt2}" (+ "|R" when the seat flagged review).
// pillArea is the SPEC pill area stamped at build. Step 8b recovers the artist's uniform
// nest-scale factor as sqrt(specArea / currentArea) — AREA is rotation-invariant, so the
// seat's tilt doesn't corrupt the reference the way a bounding-box height would. Tokens
// after [1] are order-independent.
function _capNoteFormat(styleCode, lines, pillArea, review) {
    return styleCode + "|" + lines + "|a" + Math.round(pillArea) + (review ? "|R" : "");
}

// Parses a caption note. Back-compatible with legacy "{style}|{lines}" and "{style}|{lines}|R".
function _capNoteParse(note) {
    var out = { styleCode: null, lines: 1, pillArea: null, review: false };
    if (!note) return out;
    var t = String(note).split("|"), i;
    out.styleCode = t[0];
    if (t.length > 1 && t[1].length) out.lines = parseInt(t[1], 10) || 1;
    for (i = 2; i < t.length; i++) {
        if (t[i] === "R") out.review = true;
        else if (t[i].charAt(0) === "a") {
            var a = parseFloat(t[i].substring(1));
            if (!isNaN(a)) out.pillArea = a;
        }
    }
    return out;
}

// Art-rotation stamp ("u<deg>") that Step 7B's rotation reconcile rides in the cutline note,
// beside the caption fields. parseNote / _capNoteParse ignore any "u…" field, so it is
// invisible to Steps 8b/9A. NOTE: _capNoteFormat rebuilds the note from scratch and does NOT
// preserve this field, so a full note rewrite (e.g. re-running buildCaption on a stamped
// group) drops the stamp — the one place the reconcile's persistence can be defeated.
function noteReadRotStamp(note) {
    if (!note) return null;
    var parts = String(note).split("|"), i;
    for (i = 0; i < parts.length; i++) {
        if (parts[i].charAt(0) === "u" && parts[i].length > 1) {
            var v = parseFloat(parts[i].substring(1));
            if (!isNaN(v)) return v;
        }
    }
    return null;
}

// Writes/replaces the "u<deg>" art-rotation stamp on a note, preserving every other field.
function noteWriteRotStamp(note, deg) {
    var parts = note ? String(note).split("|") : [], out = [], i;
    for (i = 0; i < parts.length; i++) {
        if (!(parts[i].charAt(0) === "u" && parts[i].length > 1)) out.push(parts[i]);
    }
    out.push("u" + Math.round(deg));
    return out.join("|");
}

// Elongates a GC-LM caption-plate ARTWORK group by scaling only its center piece (C); the L/R
// end caps keep their size; R slides to abut the stretched C. AI port of PS elongateCaptionPlate
// (horizontal only -> y-up vs y-down is irrelevant). Children must be named "L", "C", "R".
// Returns true on success; false (caller logs "use as-is") if L/C/R missing or degenerate.
function elongateCaptionPlateAI(plateGroup, targetWidthPt) {
    var L = null, C = null, R = null, i, ch;
    for (i = 0; i < plateGroup.pageItems.length; i++) {
        ch = plateGroup.pageItems[i];
        if (ch.name === "L") L = ch; else if (ch.name === "C") C = ch; else if (ch.name === "R") R = ch;
    }
    if (!L || !C || !R) return false;
    function w(it) { var b = it.geometricBounds; return b[2] - b[0]; }
    var lW = w(L), rW = w(R), cW = w(C);
    var cTarget = targetWidthPt - lW - rW;
    if (cTarget <= 0 || cW <= 0) return false;
    C.resize(cTarget / cW * 100, 100,            // horizontal only, anchored at the left edge
        true, true, true, true, 100, Transformation.LEFT);
    R.translate(C.geometricBounds[2] - R.geometricBounds[0], 0);
    return true;
}

// Full native-caption build for one element: pill around the (artist-shaped) text -> (GC plate
// raster) -> seat the rigid caption unit INTO the white-edge outline -> unite into the cut -> bundle
// -> half-cut. The PRINTED caption RIDES the cut group: the white pill stays VISIBLE (printed
// background), and the text (+ GC plate raster) become named, visible members. `outline` = the
// traced white-edged element path (the contour that becomes the cut). `doc` is needed for the
// half-cut layer. opts: { name, styleCode, strokePt, plateRasterFile, plateHeightMm, plateWidthPadMm }.
// Returns { ok, group, needsReview, moved, halfcut, reason }; ok:false leaves inputs untouched.
function buildCaption(doc, layer, textFrame, outline, opts) {
    opts = opts || {};
    var name      = opts.name || String(textFrame.contents || "(caption)");
    var styleCode = opts.styleCode || "WC";
    var built     = buildCaptionPill(layer, textFrame, opts);
    var pill      = built.pill;

    // Ride-along printed items move rigidly with the pill during the seat. The GC decorative
    // plate (a raster) is placed BEHIND the text and rides too.
    var plateRaster = null;
    if (opts.plateRasterFile) {
        plateRaster = _placeCaptionPlateRaster(layer, pill, opts.plateRasterFile,
            (opts.plateHeightMm != null ? opts.plateHeightMm : 4.0),
            (opts.plateWidthPadMm != null ? opts.plateWidthPadMm : 1.69));
    }

    var rideGroup = layer.groupItems.add();
    textFrame.move(rideGroup, ElementPlacement.PLACEATEND);
    if (plateRaster) plateRaster.move(rideGroup, ElementPlacement.PLACEATEND);
    var rideItem = rideGroup;

    // Seat into the white-edge outline (authoritative). The overlap IS the attachment.
    var _capOverlap = (CONFIG.captionSeatOverlapMm != null) ? CONFIG.captionSeatOverlapMm : 0;
    var seat = seatPlateToOutline(name, outline, pill, rideItem,
        { polyCache: {}, overlapPt: mmToPoints(_capOverlap) });
    if (!seat.ok) {
        // Un-nest the ride items so a failed seat leaves clean inputs.
        try { textFrame.move(layer, ElementPlacement.PLACEATEND); } catch (e1) {}
        try { if (plateRaster) plateRaster.move(layer, ElementPlacement.PLACEATEND); } catch (e2) {}
        try { rideGroup.remove(); } catch (e3) {}
        return { ok: false, needsReview: !!seat.needsReview, reason: seat.reason };
    }

    // Unite outline + pill into the fused cut (fuse-rescue a caption that won't join at zero embed).
    var moveItems = [pill, rideGroup];
    var fuse = fuseCaptionCutline(outline, pill, moveItems,
        (opts.strokePt != null ? opts.strokePt : 0.25), { name: name });
    if (!fuse.ok) {
        try { textFrame.move(layer, ElementPlacement.PLACEATEND); } catch (e1) {}
        try { if (plateRaster) plateRaster.move(layer, ElementPlacement.PLACEATEND); } catch (e2) {}
        try { rideGroup.remove(); } catch (e3) {}
        log("[fuse] " + name + " | " + fuse.reason);
        return { ok: false, needsReview: true, reason: fuse.reason };
    }
    var cut = fuse.cut;
    var group = assembleElementGroup(layer, name, outline, pill, cut);

    // PRINTED caption rides the cut group: pill stays VISIBLE (white background), and the text
    // (+ GC plate raster) become named, visible members. assembleElementGroup hid the plate
    // (cut-shaper convention) — re-show it for native captions.
    var plateM = findGroupMember(group, " plate");
    if (plateM) plateM.hidden = false;

    var i, kids = [];
    for (i = 0; i < rideGroup.pageItems.length; i++) kids.push(rideGroup.pageItems[i]);
    for (i = 0; i < kids.length; i++) kids[i].move(group, ElementPlacement.PLACEATBEGINNING);
    try { rideGroup.remove(); } catch (eR) {}
    textFrame.name = name + " caption text";
    if (plateRaster) plateRaster.name = name + " caption plate";

    var lines = _capIsMultiLine(textFrame) ? 2 : 1;
    var pillArea = 0;
    try { pillArea = Math.abs(pill.area); } catch (ePA) {}   // rotation-invariant scale reference
    group.note = _capNoteFormat(styleCode, lines, pillArea, !!seat.needsReview);

    // The half-cut is NOT built here. It is a nested-pose feature that Step 7B (import)
    // re-derives from scratch after Deepnest (AI_ImportNesting → syncHalfcut), and it never
    // reaches the Deepnest SVG export (Step 7A ignores the Halfcut layer) — so building it in
    // this pipeline is wasted work. Half-cut generation lives only in Step 7B + Step 8b.
    return { ok: true, group: group, needsReview: !!seat.needsReview, moved: seat.moved };
}

// Pipeline-2 build for a DEFAULT PEEL TAB (uncaptioned element). Mirrors buildCaption minus the
// pill/text build: the loose "{name} tab" group (placed in Pipeline 1, possibly repositioned by
// the artist) supplies a CUTLINE (the plate) and a FILL (a ride-along printed member). Seats the
// cutline into the traced outline, unites into the fused cut, and bundles the separable members.
// (The half-cut is NOT built here — Step 7B re-derives it after nesting; see buildCaption.) An
// unseated tab returns { ok:false } for the caller to surface as a hard error (no fallback).
function buildDefaultTab(doc, layer, tabGroup, outline, opts) {
    opts = opts || {};
    var name = opts.name || tabGroup.name.replace(/ tab$/, "");

    // Extract the two tab members by name (placeTabAsset named them).
    var cutline = null, fill = null, i;
    for (i = 0; i < tabGroup.pageItems.length; i++) {
        var it = tabGroup.pageItems[i];
        if (it.name === name + " tab cutline") cutline = it;
        else if (it.name === name + " tab fill") fill = it;
    }
    if (!cutline) return { ok: false, reason: "tab cutline member not found" };

    // Promote the tab members out of the loose wrapper onto the layer (seat/derive operate on
    // layer-level items, like the caption pill/text). Keep the fill as the ride-along.
    cutline.move(layer, ElementPlacement.PLACEATEND);
    if (fill) fill.move(layer, ElementPlacement.PLACEATEND);
    try { tabGroup.remove(); } catch (eT) {}

    // Seat the cutline (plate) into the outline; the fill rides rigidly. The tab supplies its own
    // attach-edge TIPS as the endpoints to kiss — the pill inner-edge finder would skip them as
    // caps, over-seating the tab (it kissed the cap BASES, burying the real tips ~1.5mm into the
    // art). With the tips, both endpoints land on the white-edge border.
    var seatSteps = CONFIG.seatSampleSteps || 24;
    var tipPoly = _largestPoly(samplePathToPolygons(cutline, seatSteps));
    var tips = tipPoly ? _tabAttachTips(tipPoly, _aiSeatGeometry(cutline, outline)) : null;
    var seatOpts = { polyCache: {} };
    if (tips) seatOpts.innerEndpoints = [tips.e0, tips.e1];
    var seat = seatPlateToOutline(name, outline, cutline, fill, seatOpts);
    if (!seat.ok) {
        // Restore a re-runnable loose "{name} tab" group (mirror buildCaption's input-restore on
        // failure) so the artist can reposition and re-run; members keep their tab-member names.
        var restore = layer.groupItems.add();
        restore.name = name + " tab";
        try { cutline.move(restore, ElementPlacement.PLACEATEND); } catch (eRc) {}
        try { if (fill) fill.move(restore, ElementPlacement.PLACEATEND); } catch (eRf) {}
        return { ok: false, needsReview: !!seat.needsReview, reason: seat.reason };
    }

    // Unite outline + tab cutline into the fused cut; bundle the separable members.
    var cut = deriveCutline(outline, cutline);
    strokeRecursive(cut, (opts.strokePt != null ? opts.strokePt : 0.25), blackRgb());
    var group = assembleElementGroup(layer, name, outline, cutline, cut);

    // The fill is a PRINTED ride-along member (never part of the cut). Move it into the group and
    // keep it visible; it is NOT named "{name} plate" so it never enters reuniteCutline/halfcut.
    if (fill) {
        fill.move(group, ElementPlacement.PLACEATBEGINNING);
        fill.name = name + " tab fill";
        fill.hidden = false;
    }

    // Note marks a default-tab group: styleCode "ST", lines 0 (tab, not text), + plate area.
    var plateArea = 0;
    try { plateArea = Math.abs(cutline.area); } catch (ePA) {}
    group.note = _capNoteFormat("ST", 0, plateArea, !!seat.needsReview);

    // Half-cut deferred to Step 7B (import) — see buildCaption. Not built in this pipeline.
    return { ok: true, group: group, needsReview: !!seat.needsReview };
}

// Places a GC decorative plate raster behind the caption, scaled to span the pill width (+ pad
// each side) at a fixed spec bar height. Width-driven; non-uniform, so the L/R caps may distort
// slightly — accepted as cosmetic + tunable (plateHeightMm / plateWidthPadMm). The plate is
// PRINTED-INK only; it does NOT enter deriveCutline (the cut stays outline+pill).
function _placeCaptionPlateRaster(layer, pill, plateFile, heightMm, widthPadMm) {
    var pb = pill.geometricBounds;                 // [l,t,r,b] y-up
    var targetW = (pb[2] - pb[0]) + mmToPoints(widthPadMm) * 2;
    var targetH = mmToPoints(heightMm);
    var placed = layer.placedItems.add();
    placed.file = plateFile;
    placed.resize((targetW / placed.width) * 100, (targetH / placed.height) * 100);
    // Centre on the pill.
    var pcx = (pb[0] + pb[2]) / 2, pcy = (pb[1] + pb[3]) / 2;
    placed.translate(pcx - (placed.position[0] + placed.width / 2),
                     pcy - (placed.position[1] - placed.height / 2));
    return placed;
}

// Rotation-invariant plate length: the farthest distance between the plate's OWN anchor points.
// bbox width is wrong once nesting rotates an element (a 90deg-rotated pill's bbox width is its
// height), which inflates the junction ratio and can let a weak junction pass. Anchors (not the
// dense sample) keep this cheap — a farthest-pair over the 48-step sample is O(n^2) and too slow.
function _plateDiameter(plate) {
    if (!plate) return 0;
    var pts = _anchorPointsOf(plate, []);
    if (pts.length >= 2) return _farthestPairDist(pts);
    // No anchors anywhere (degenerate plate). Do NOT fall back to bbox width: that is precisely the
    // rotation-dependent measure this function exists to replace (a 90deg-nested pill's bbox width
    // is its SHORT side, which inflates the contact ratio and lets a weak weld pass). Returning 0
    // makes the caller treat the ratio as 0 and rescue/hard-error, which is the safe direction.
    log("[fuse] WARN | plate has no usable anchors; contact ratio forced to 0 (cannot measure diameter).");
    return 0;
}

// All anchor points of a PathItem / CompoundPathItem / GroupItem, as [{x,y}]. Recurses, so a plate
// that came back from a Unite/expand as a compound or group still yields a real diameter instead of
// silently degrading to a bbox measure.
function _anchorPointsOf(item, acc) {
    var t, i, pp;
    try { t = item.typename; } catch (eT) { return acc; }
    if (t === "PathItem") {
        try { pp = item.pathPoints; } catch (eP) { pp = null; }
        if (pp) { for (i = 0; i < pp.length; i++) acc.push({ x: pp[i].anchor[0], y: pp[i].anchor[1] }); }
    } else if (t === "CompoundPathItem") {
        for (i = 0; i < item.pathItems.length; i++) _anchorPointsOf(item.pathItems[i], acc);
    } else if (t === "GroupItem") {
        for (i = 0; i < item.pageItems.length; i++) _anchorPointsOf(item.pageItems[i], acc);
    }
    return acc;
}

// Leaf metrics [{c,area}] of a fused-cut item (PathItem / CompoundPathItem / GroupItem).
function _fusedLeafMetrics(item) {
    var acc = [];
    (function walk(it) {
        var t = it.typename, i;
        if (t === "PathItem") acc.push(it);
        else if (t === "CompoundPathItem") { for (i = 0; i < it.pathItems.length; i++) acc.push(it.pathItems[i]); }
        else if (t === "GroupItem") { for (i = 0; i < it.pageItems.length; i++) walk(it.pageItems[i]); }
    })(item);
    var out = [], i, b;
    for (i = 0; i < acc.length; i++) {
        b = acc[i].geometricBounds;
        out.push({ c: boundsCenter(b), area: Math.abs((b[2] - b[0]) * (b[1] - b[3])) });
    }
    return out;
}

// {c,area} of a single item's bbox.
function _plateMetrics(plate) {
    var b = plate.geometricBounds;
    return { c: boundsCenter(b), area: Math.abs((b[2] - b[0]) * (b[1] - b[3])) };
}

// Sampling for the caption CONTACT measure. STEPS is per bezier segment (samplePathToPolygons'
// convention); MAX_EDGE_PT then densifies the plate to a uniform arc spacing so the measurement
// resolution does not depend on how many segments a caption happens to be built from.
var CONTACT_SAMPLE_STEPS = 48;
var CONTACT_MAX_EDGE_PT  = 0.5;   // ~0.18mm — well under the smallest weld we care about

// The caption's CONTACT with the art: total welded edge length / the plate's rotation-invariant
// diameter. 0 = tangent or detached. NOT bounded by 1 (contact is arc length, diameter a chord).
function _captionContactRatio(plate, outline, steps) {
    var s = steps || CONTACT_SAMPLE_STEPS;
    var pp = _largestPoly(samplePathToPolygons(plate, s));
    var artPolys = samplePathToPolygons(outline, s);
    if (!pp || pp.length < 3 || artPolys.length === 0) return 0;
    // Densify the PLATE only (the art is just the inside/outside reference): per-segment sampling
    // leaves a flat caption's one-segment inner edge ~40x coarser than a warped caption's, so a
    // short weld could fall entirely between two samples and read as 0.
    pp = _densifyPoly(pp, CONTACT_MAX_EDGE_PT);
    var diam = _plateDiameter(plate);
    return (diam > 0 ? _contactRunsTotal(pp, artPolys) / diam : 0);
}

// Phase 1 (cheap, no boolean): nudge every item in moveItems stepMm toward the art (direction
// from _aiSeatGeometry) until the caption's total CONTACT with the art (_captionContactRatio) is
// >= minRatio, or capMm is reached (hard error). Phase 2: unite outline+plate ONCE via
// deriveCutline, then RE-ASSERT on the ACTUAL boolean result — removeCaptionJunctionSlivers
// deliberately KEEPS a leaf matching the plate, so a wide-enough measured contact doesn't
// guarantee the union actually fused; if the result is still a detached plate leaf, keep nudging
// (re-uniting each time) until it fuses or capMm is reached. The seat is untouched; only a
// non-fusing caption moves. Returns { cut, embeddedMm, ok, reason, ratio }.
function fuseCaptionCutline(outline, plate, moveItems, strokePt, opts) {
    opts = opts || {};
    var name   = opts.name || "(caption)";
    var stepMm = (opts.stepMm != null) ? opts.stepMm
               : ((typeof CONFIG !== "undefined" && CONFIG.captionFuseStepMm != null) ? CONFIG.captionFuseStepMm : 0.01);
    var capMm  = (opts.capMm != null) ? opts.capMm
               : ((typeof CONFIG !== "undefined" && CONFIG.captionFuseCapMm != null) ? CONFIG.captionFuseCapMm : 0.3);
    var minRatio = (opts.minRatio != null) ? opts.minRatio
               : ((typeof CONFIG !== "undefined" && CONFIG.captionMinJunctionRatio != null) ? CONFIG.captionMinJunctionRatio : 0.15);
    if (stepMm <= 0) stepMm = 0.01;                      // never allow a non-advancing loop
    var geom = _aiSeatGeometry(plate, outline);
    var step = mmToPoints(stepMm);
    var embeddedMm = 0, tx, ty;
    // Hard iteration ceiling independent of the mm cap: tuning captionFuseStepMm down without
    // touching captionFuseCapMm would otherwise mean hundreds of live boolean unions per element.
    var iters = 0, MAX_ITERS = 64;

    function nudge() {
        tx = geom.travelIsX ? geom.sign * step : 0;
        ty = geom.travelIsX ? 0 : geom.sign * step;
        _translateItems(moveItems, tx, ty);
        embeddedMm += stepMm;
        iters++;
    }

    // Put the caption back where it was seated. A failed rescue must not leave the pill (and the
    // printed text/raster riding with it) drifted up to capMm from its seated pose with a stale
    // cutline beside it — the callers have no history snapshot to roll that back.
    function restore() {
        if (embeddedMm <= 0) return;
        var back = mmToPoints(embeddedMm);
        _translateItems(moveItems, geom.travelIsX ? -geom.sign * back : 0,
                                   geom.travelIsX ? 0 : -geom.sign * back);
        embeddedMm = 0;
    }

    // Phase 1 (cheap, no boolean): grow the weld until there is enough contact.
    var ratio = _captionContactRatio(plate, outline, CONTACT_SAMPLE_STEPS);
    while (ratio < minRatio) {
        if (embeddedMm + stepMm > capMm + 1e-9 || iters >= MAX_ITERS) {
            var failedMm1 = embeddedMm;
            restore();
            return { cut: null, embeddedMm: 0, ok: false, ratio: ratio,
                     reason: "caption '" + name + "' contact ratio " + ratio.toFixed(3)
                             + " < " + minRatio + " even after " + _r1(failedMm1) + "mm embed"
                             + " (caption restored to its seated position)" };
        }
        nudge();
        ratio = _captionContactRatio(plate, outline, CONTACT_SAMPLE_STEPS);
    }

    // Phase 2: unite, then RE-ASSERT on the result — the sliver remover keeps a plate-matching
    // leaf, so a detached pill would otherwise ship silently.
    var cut = deriveCutline(outline, plate);
    while (_captionLeafDetached(_fusedLeafMetrics(cut), _plateMetrics(plate))) {
        if (embeddedMm + stepMm > capMm + 1e-9 || iters >= MAX_ITERS) {
            try { cut.remove(); } catch (e0) {}
            var failedMm2 = embeddedMm;
            restore();
            return { cut: null, embeddedMm: 0, ok: false, ratio: ratio,
                     reason: "caption '" + name + "' still a separate leaf after " + _r1(failedMm2)
                             + "mm embed (caption restored to its seated position)" };
        }
        nudge();
        try { cut.remove(); } catch (e1) {}
        cut = deriveCutline(outline, plate);
        ratio = _captionContactRatio(plate, outline, CONTACT_SAMPLE_STEPS);
    }

    strokeRecursive(cut, strokePt, blackRgb());
    if (embeddedMm > 0) {
        log("[fuse] " + name + " | embedded " + (Math.round(embeddedMm * 1000) / 1000)
            + "mm -> contact ratio " + ratio.toFixed(3));
    }
    return { cut: cut, embeddedMm: embeddedMm, ok: true, reason: null, ratio: ratio };
}

// Derives the fused cutline = boolean union of element_outline and plate.
// Duplicates both inputs so the originals survive as separable components.
// Returns the resulting item (PathItem, CompoundPathItem, or wrapping GroupItem).
// If the junction doesn't match expectations, swap this body — callers only
// depend on the return value. See docs/caption-separability-architecture.md.
function deriveCutline(outline, plate) {
    var parent = outline.parent;

    var dupOutline = outline.duplicate();
    var dupPlate   = plate.duplicate();

    // Build the union group via the DOM so the operand set is deterministic
    // regardless of the global selection (the "group" menu command no-ops here).
    var unionGroup = parent.groupItems.add();
    dupOutline.move(unionGroup, ElementPlacement.PLACEATEND);
    dupPlate.move(unionGroup, ElementPlacement.PLACEATEND);

    // Clear the selection one item at a time via the DOM. The two other ways to
    // clear are both ruled out on the heavy working doc: `app.selection = null`
    // deadlocks on redraw once the doc accumulates items, and a cross-document
    // temp doc crashes Illustrator (stale live-object reference). `deselectall`
    // (menu) silently no-ops. Per-item `.selected = false` is the remaining
    // lightweight, in-place, crash-free option.
    var sel = app.selection;
    var snap = [];
    var k;
    for (k = 0; k < sel.length; k++) { snap.push(sel[k]); }
    for (k = 0; k < snap.length; k++) { try { snap[k].selected = false; } catch (e) {} }

    unionGroup.selected = true;

    // Live Pathfinder Add unites the selected group's children; expandStyle bakes
    // the live effect into concrete geometry. (No scriptable DOM equivalent.)
    var prevLevel = app.userInteractionLevel;
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    app.executeMenuCommand("Live Pathfinder Add");
    app.executeMenuCommand("expandStyle");
    app.userInteractionLevel = prevLevel;

    var fused = app.selection[0];
    var sw = removeCaptionJunctionSlivers(fused, outline, plate);
    if (sw.removed > 0) log("[cutline] junction slivers removed | " + sw.removed);
    return fused;
}

// Leaf PathItems of a fused cutline or an outline (PathItem / CompoundPathItem / GroupItem).
// deriveCutline's Unite result is usually a GroupItem wrapping several PathItems.
function _fusedCutLeaves(item, acc) {
    var t = item.typename, i;
    if (t === "PathItem") { acc.push(item); }
    else if (t === "CompoundPathItem") { for (i = 0; i < item.pathItems.length; i++) acc.push(item.pathItems[i]); }
    else if (t === "GroupItem") { for (i = 0; i < item.pageItems.length; i++) _fusedCutLeaves(item.pageItems[i], acc); }
    return acc;
}

// [{ c:{x,y}, area:Number }] for a list of leaf PathItems, from each leaf's geometricBounds.
function _leafMetrics(items) {
    var out = [], i, b;
    for (i = 0; i < items.length; i++) {
        b = items[i].geometricBounds;                          // [left, top, right, bottom]
        out.push({ c: boundsCenter(b), area: Math.abs((b[2] - b[0]) * (b[1] - b[3])) });
    }
    return out;
}

// Deletes caption-junction sliver subpaths from a freshly-Unite'd fused cutline: the boolean
// crumbs the plate∩art weld invents at the seam. Keeps the largest leaf (the real contour) and
// any leaf that echoes a KEEP-reference: a subpath of the art-alone `outline` (a genuine art
// hole, like Tram's) OR the caption `plate` itself. The plate reference matters when the caption
// is only shallowly seated — the Unite then leaves the pill as its OWN leaf instead of fusing it
// into the contour; without the plate reference that pill has no outline match and would be
// wrongly deleted as a sliver (it would strip the caption out of the cutline). Everything else
// non-largest is a true crumb. Idempotent (a cut with no unmatched leaves is a no-op).
// Returns { removed:N }.
function removeCaptionJunctionSlivers(cutline, outline, plate) {
    if (!cutline || !outline) return { removed: 0 };
    var fusedItems = _fusedCutLeaves(cutline, []);
    if (fusedItems.length < 2) return { removed: 0 };
    var keepRefs = _leafMetrics(_fusedCutLeaves(outline, []));
    if (plate) keepRefs = keepRefs.concat(_leafMetrics(_fusedCutLeaves(plate, [])));
    var fusedLeaves = _leafMetrics(fusedItems);
    var doomed = _junctionSliverLeaves(fusedLeaves, keepRefs);
    var removed = 0, i;
    for (i = doomed.length - 1; i >= 0; i--) {      // descending: removing a leaf can't stale a lower index
        try { fusedItems[doomed[i]].remove(); removed++; } catch (e) {}
    }
    return { removed: removed };
}

// Assembles the per-element bundle as a GroupItem so the components ride along
// with the cutline through nesting transforms. Members are named; outline and
// plate are hidden, cutline stays visible. Returns the GroupItem.
// TODO Step 7A follow-up: update to read cutline from each group rather than
// bare PathItems in the Cutlines layer.
function assembleElementGroup(layer, displayName, elementOutline, plate, cutline) {
    var grp = layer.groupItems.add();
    grp.name = displayName;

    elementOutline.name = displayName + " outline";
    plate.name          = displayName + " plate";
    cutline.name        = displayName;

    elementOutline.move(grp, ElementPlacement.PLACEATEND);
    plate.move(grp, ElementPlacement.PLACEATEND);
    cutline.move(grp, ElementPlacement.PLACEATBEGINNING);

    elementOutline.hidden = true;
    plate.hidden          = true;

    return grp;
}

// ─── SEPARABLE-GROUP MEMBER ACCESS ────────────────────────────────────────────
// The per-element bundle (see assembleElementGroup) names its members
// `{displayName}` (visible cutline), `{displayName} outline`, `{displayName} plate`.
// These finders let Steps 8a/8b reach a member without assuming child order.

// Returns the group member whose name is group.name + suffix ("" = cutline,
// " outline", " plate"), or null. Matches the first item with that exact name.
function findGroupMember(group, suffix) {
    var want = group.name + suffix;
    for (var i = 0; i < group.pageItems.length; i++) {
        if (group.pageItems[i].name === want) return group.pageItems[i];
    }
    return null;
}

// ─── RE-UNITE (shared by Steps 8a + 8b) ───────────────────────────────────────

// Re-derives the visible cutline as Unite(outline, plate) and swaps it into the
// group, keeping outline/plate as separable (hidden) components. Used after
// either input changes (8a simplifies outline; 8b resets plate). The boolean op
// needs visible operands, so outline/plate are un-hidden for the op then restored.
// Returns the new cutline item (PathItem/CompoundPathItem/GroupItem).
function reuniteCutline(group, outline, plate, strokePt) {
    var outlineHidden = outline.hidden;
    var plateHidden   = plate.hidden;
    outline.hidden = false;
    plate.hidden   = false;

    var oldCutline = findGroupMember(group, "");

    var moveItems = [plate];
    var capText   = findGroupMember(group, " caption text");
    var capRaster = findGroupMember(group, " caption plate");
    if (capText)   moveItems.push(capText);
    if (capRaster) moveItems.push(capRaster);
    var fuse = fuseCaptionCutline(outline, plate, moveItems, strokePt, { name: group.name });
    if (!fuse.ok) {
        outline.hidden = outlineHidden;
        plate.hidden   = plateHidden;
        throw new Error(fuse.reason);   // surfaced by the pipeline's per-phase try/catch
    }
    var newCutline = fuse.cut;

    if (oldCutline) oldCutline.remove();
    newCutline.name = group.name;
    newCutline.move(group, ElementPlacement.PLACEATBEGINNING);

    outline.hidden = outlineHidden;
    plate.hidden   = plateHidden;
    return newCutline;
}

// ─── CAPTION VECTOR SEAT (Step 6 birth + Step 8b resize) ──────────────────────
// Seats the caption plate (and, when it is placed, its caption PNG) onto the element
// art by measuring against the TRACED VECTOR OUTLINE — the same contour that becomes
// the cut — instead of the Photoshop raster. This is the Illustrator-side twin of
// Step3B_CaptionWhite.jsx's seatCaptionConform: the SAME geometry (inner-edge endpoints
// -> rotate to the border chord, pinned on E0 -> kiss to a submerged depth, with an
// overhang / convex-bulge balanced shrink), but the edge probe reads the outline
// polygon, not loadLayerTransparency.
//
// WHY (see docs/caption-seating-redesign.md): the PS seat aimed for a few px of overlap
// against the raster 50% edge, but Image Trace cuts the cutline ~1-3px INSIDE that edge,
// so on a flat / shallow seat the overlap netted to ~0 in the cut -> detached caption.
// Seating against the cut's OWN geometry makes the overlap it sets exactly the overlap
// that survives into the Unite: attachment is guaranteed, and the depth can stay small
// (no convex over-submersion bulge).
//
// Called AFTER the plate is built and BEFORE deriveCutline / reuniteCutline, at the two
// sites where the caption's relation to the outline actually changes: Step 6 (birth,
// captionItem = null because the PNG isn't placed until Step 7B) and Step 8b (after the
// spec rescale, captionItem = the placed caption). Steps 7B/9A move the whole
// {cut, art, caption} unit RIGIDLY, which preserves the seat, so they don't re-seat
// (syncHalfcut alone re-derives the tab there).
//
// Convergence: E0/E1 are re-derived from the current plate each call and the kiss drives a
// FIXED depth, so a seated caption re-kisses with ~0 move. The rotation reaches an exact
// fixed point only for straight / near-flat seats (the chord angle is probe-position
// independent there); a CURVED seat may settle over ~1-2 applications because the
// axis-parallel probes shift along the curve as the plate rotates. This is bounded in the
// pipeline (the seat runs at most twice — Step 6 birth + the first Step 8b reset; an at-spec
// Step 8b re-run short-circuits before re-seating), and a residual tilt on a strongly arced
// caption is caught by the captionMidProtrudeFrac needsReview flag. A robust live-span chord
// fit (the deferred profile-settle) would make the rotation a true fixed point too.
//
// Returns { ok, moved, rotDeg, needsReview, reason }. ok:false means the caption could
// not be seated (no outline edge under the inner edge even after the shrink) — the caller
// leaves the plate as-is and logs; the export-time half-cut still hard-errors on a
// genuinely unseated caption, so nothing ships with a broken peel tab.
function seatPlateToOutline(name, outline, plate, captionItem, opts) {
    opts = opts || {};
    name = name || "(caption)";
    var steps    = (opts.sampleSteps != null) ? opts.sampleSteps : (CONFIG.seatSampleSteps || 12);
    var depth    = (opts.overlapPt   != null) ? opts.overlapPt   : mmToPoints(CONFIG.seatOverlapMm);
    var epsPt    = (CONFIG.seatBaselineEpsPt != null) ? CONFIG.seatBaselineEpsPt : mmToPoints(0.2);
    var rotSign  = (CONFIG.seatRotationSign  != null) ? CONFIG.seatRotationSign  : 1;
    var maxRot   = (CONFIG.maxSeatRotationDeg!= null) ? CONFIG.maxSeatRotationDeg : 75;
    var cache    = opts.polyCache || null;

    // Outline through the per-pass cache (it is never mutated here, so syncHalfcut can reuse this
    // exact sample when its step count matches). The plate is sampled fresh below and deliberately
    // NOT cached — the kiss/rotate at the end of this function moves it, so a later reader must
    // re-sample the seated pose. See _sampleCached.
    var artPolys = _sampleCached(cache, "outline", outline, steps);
    if (!artPolys || artPolys.length === 0) {
        log("[seat] " + name + " | SKIP — no outline geometry.");
        return { ok: false, reason: "no outline geometry" };
    }

    var geom = _aiSeatGeometry(plate, outline);
    var pp = _largestPoly(samplePathToPolygons(plate, steps));
    if (!pp || pp.length < 4) {
        log("[seat] " + name + " | SKIP — degenerate plate polygon.");
        return { ok: false, reason: "degenerate plate" };
    }
    var needsReview = false, shrunk = false;
    var items = [plate];
    if (captionItem) items.push(captionItem);

    var E0, E1, B0, B1, r, kissOnly = false, travelDir = null;

    if (opts.innerEndpoints) {
        // ── TAB path: derive the travel DIRECTION and the attach-edge TIPS from the tab's OWN
        // geometry (PCA short axis toward the art). This seats correctly wherever the artist has
        // dragged or ROTATED the tab, and fixes the wide/thin-element bottom-tab miss that the
        // center-offset axis guess produced. The passed innerEndpoints only signal "this is a tab".
        travelDir = _tabTravelDir(pp, artPolys);
        var tips = _tabTipsDir(pp, travelDir);
        if (!tips) {
            log("[seat] " + name + " | WARN — tab attach edge indeterminate; not seated.");
            return { ok: false, needsReview: true, reason: "tab attach edge indeterminate" };
        }
        E0 = tips.e0; E1 = tips.e1;
        r = Math.sqrt((E1.x - E0.x) * (E1.x - E0.x) + (E1.y - E0.y) * (E1.y - E0.y)) / 2;
        B0 = _probeOutlineDir(artPolys, E0, travelDir);
        B1 = _probeOutlineDir(artPolys, E1, travelDir);
        if (!B0 || !B1) {
            log("[seat] " + name + " | WARN — tab tip has no art in front of it; not seated.");
            return { ok: false, needsReview: true, reason: "tab tip off the art" };
        }
    } else {
        // ── CAPTION path (pill): derive the REAL inner-edge vertices (the art-facing long edge),
        // preserving the actual curve — NOT a straight PCA-chord reconstruction (that floats off an
        // arced caption and under-seats it: the Šúľance gap). See _innerEdgeVerts. Then overhang +
        // convex-bulge shrink. ──
        var ie = _innerEdgeVerts(pp, geom);
        if (!ie || ie.verts.length === 0) {
            log("[seat] " + name + " | SKIP — could not resolve plate inner edge.");
            return { ok: false, reason: "degenerate plate" };
        }
        kissOnly = ie.kissOnly;
        var verts = ie.verts, n = verts.length; r = ie.radius;
        var shrinkF = (CONFIG.seatShrinkFrac != null) ? CONFIG.seatShrinkFrac : 0.15;

        // The two ends of the inner edge, taken from the actual sampled plate outline. Look from
        // each toward the art and grab the edge in front of it.
        var iLo = 0, iHi = n - 1;
        E0 = verts[iLo]; E1 = verts[iHi];
        B0 = _probeOutline(artPolys, geom, E0);
        B1 = _probeOutline(artPolys, geom, E1);

        // OVERHANG: an endpoint with no art in front of it → one 15% balanced shrink along the real
        // edge (this also trims a rising corner off the ends). Still none → caption wider than its
        // art; flag + don't seat.
        if (!B0 || !B1) {
            var oa = Math.floor(shrinkF * (n - 1)), ob = Math.floor((1 - shrinkF) * (n - 1));
            var oB0 = (ob > oa) ? _probeOutline(artPolys, geom, verts[oa]) : null;
            var oB1 = (ob > oa) ? _probeOutline(artPolys, geom, verts[ob]) : null;
            if (oB0 && oB1) {
                iLo = oa; iHi = ob; E0 = verts[oa]; E1 = verts[ob]; B0 = oB0; B1 = oB1; shrunk = true;
                log("[seat] " + name + " | overhang rescued by " + Math.round(shrinkF * 100) + "% shrink.");
            } else {
                log("[seat] " + name + " | WARN — caption wider than its art (no edge under the inner "
                    + "edge even after shrink); not seated.");
                return { ok: false, needsReview: true, reason: "caption wider than art" };
            }
        }

        // ── CONVEX-BULGE guard (the ORIGINAL r/2 rule): if the art bulges INTO the pill at the
        // inner-edge MIDPOINT by more than captionMidProtrudeFrac*2r (default r/2), a straight pill
        // would bury that bulge into the caption text. Relieve with one 15% shrink — it re-anchors
        // the seat to a deeper interior point, backing the pill out — then flag if still over. One
        // shrink budget, shared with overhang. ──
        if (CONFIG.captionMidProtrudeFrac > 0) {
            var limit = CONFIG.captionMidProtrudeFrac * 2 * r;
            var Bm = _probeOutline(artPolys, geom, verts[Math.floor((iLo + iHi) / 2)]);
            var p  = _aiMidProtrusion(B0, B1, Bm, geom, depth);
            if (p !== null && p > limit && !shrunk) {
                var ba = Math.floor(shrinkF * (n - 1)), bb = Math.floor((1 - shrinkF) * (n - 1));
                var bB0 = (bb > ba) ? _probeOutline(artPolys, geom, verts[ba]) : null;
                var bB1 = (bb > ba) ? _probeOutline(artPolys, geom, verts[bb]) : null;
                if (bB0 && bB1) {
                    iLo = ba; iHi = bb; E0 = verts[ba]; E1 = verts[bb]; B0 = bB0; B1 = bB1; shrunk = true;
                    var Bm2 = _probeOutline(artPolys, geom, verts[Math.floor((iLo + iHi) / 2)]);
                    p = _aiMidProtrusion(B0, B1, Bm2, geom, depth);
                    log("[seat] " + name + " | midpoint bulge relieved by " + Math.round(shrinkF * 100) + "% shrink.");
                }
            }
            if (p !== null && p > limit) {
                needsReview = true;
                log("[seat] " + name + " | midpoint bulge " + _r1(p) + "pt > limit " + _r1(limit)
                    + "pt after shrink — flagged.");
            }
        }
    }

    var rotDeg = 0;

    if (travelDir) {
        // ── TAB (unchanged): rotate the inner edge parallel to the art chord (pivot E0), then
        // kiss E0 onto B0 along the tab's travel direction, submerged by depth. ──
        if (CONFIG.seatConform && !kissOnly) {
            var baseLen = Math.sqrt((E1.x - E0.x) * (E1.x - E0.x) + (E1.y - E0.y) * (E1.y - E0.y));
            if (baseLen >= epsPt) {
                var phi = _aiNormalizeDeg(_aiChordAngleDeg(B0, B1) - _aiChordAngleDeg(E0, E1));
                if (Math.abs(phi) <= maxRot) {
                    _rotateItemsAbout(items, E0, rotSign * phi);
                    rotDeg = phi;
                    log("[seat] " + name + " | rotated " + phi.toFixed(1) + "deg to endpoint chord.");
                } else {
                    needsReview = true;
                    log("[seat] " + name + " | chord tilt " + phi.toFixed(1)
                        + "deg exceeds maxSeatRotationDeg — rotation skipped, flagged.");
                }
            }
        }
        var kt = _aiKissVectorDir(E0, B0, travelDir, depth);
        _translateItems(items, kt.tx, kt.ty);
        log("[seat] " + name + " | seated (tab) rot=" + _r1(rotDeg) + "deg move="
            + _r1(Math.sqrt(kt.tx * kt.tx + kt.ty * kt.ty)) + "pt depth=" + _r1(depth) + "pt"
            + (needsReview ? " (needsReview)" : ""));
        return { ok: true, moved: Math.sqrt(kt.tx * kt.tx + kt.ty * kt.ty),
                 rotDeg: rotDeg, needsReview: needsReview };
    }

    // ── CAPTION (two-point contact): translate the NEARER inner-edge endpoint onto the border
    // (depth 0), then ROTATE about it until the FAR endpoint also lands on the border (exact
    // circle∩border solve). Both endpoints end exactly on the traced border — no stale-probe
    // float, no over-burial. See docs/superpowers/specs/2026-07-21-caption-seat-two-point-contact-design.md. ──
    var pick = _seatNearEndpoint(E0, B0, E1, B1, geom);

    // Step A — near endpoint onto its border point (depth 0).
    var kA = _aiKissVector(pick.P, pick.Bp, geom, 0);
    _translateItems(items, kA.tx, kA.ty);
    var Pm = { x: pick.P.x + kA.tx, y: pick.P.y + kA.ty };
    var Qm = { x: pick.Q.x + kA.tx, y: pick.Q.y + kA.ty };

    // Step B — rotate about the seated near endpoint until the far endpoint touches the border.
    if (CONFIG.seatConform && !kissOnly) {
        var rot = _seatContactRotation(Pm, Qm, artPolys, maxRot);
        if (!rot.ok) {
            needsReview = true;
            log("[seat] " + name + " | far endpoint can't reach the border (" + rot.reason
                + ") — contact rotation skipped, flagged.");
        } else if (rot.clamped) {
            needsReview = true;
            log("[seat] " + name + " | contact rotation exceeds maxSeatRotationDeg — skipped, flagged.");
        } else if (Math.abs(rot.deg) >= 0.01) {
            _rotateItemsAbout(items, Pm, rot.deg);
            rotDeg = rot.deg;
            log("[seat] " + name + " | rotated " + rot.deg.toFixed(1) + "deg to two-point contact.");
        }
    }

    // Step C — optional embed past contact (depth 0 by default → pure tangent contact).
    if (depth > 1e-6) {
        var eC = geom.travelIsX ? { tx: geom.sign * depth, ty: 0 }
                                : { tx: 0, ty: geom.sign * depth };
        _translateItems(items, eC.tx, eC.ty);
    }

    if (CONFIG.seatDebug) {
        log("[seatdbg] " + name + " | axisX=" + geom.travelIsX + " sign=" + geom.sign
            + " depth=" + _r1(depth) + " r=" + _r1(r) + " kissOnly=" + kissOnly
            + " shrunk=" + shrunk + " rot=" + _r1(rotDeg)
            + " P=(" + _r1(Pm.x) + "," + _r1(Pm.y) + ")");
    }
    log("[seat] " + name + " | seated (contact) rot=" + _r1(rotDeg) + "deg move="
        + _r1(Math.sqrt(kA.tx * kA.tx + kA.ty * kA.ty)) + "pt depth=" + _r1(depth) + "pt"
        + (needsReview ? " (needsReview)" : ""));
    return { ok: true, moved: Math.sqrt(kA.tx * kA.tx + kA.ty * kA.ty),
             rotDeg: rotDeg, needsReview: needsReview };
}

// REAL inner-edge vertices of the plate polygon (the art-facing long edge), ordered along the
// long axis — preserves the actual curve, so an arced caption seats on its true edge rather
// than a floating straight chord. PCA gives the long axis (to classify caps vs long edges and
// pick the inner side toward geom.sign); the near-circular guard switches to a deterministic
// basis and flags kissOnly. Returns { verts:[{x,y,t}...], radius, kissOnly } or null. Pure geometry.
function _innerEdgeVerts(pp, geom, opts) {
    opts = opts || {};
    var includeCaps = !!opts.includeCaps;   // true = keep the caps too (the half-cut seam spans
                                            // cap-to-cap); false (seat) = long-edge ends only.
    var n = pp.length, i, dx, dy;
    if (n < 4) return null;
    var cx = 0, cy = 0;
    for (i = 0; i < n; i++) { cx += pp[i].x; cy += pp[i].y; }
    cx /= n; cy /= n;
    var sxx = 0, syy = 0, sxy = 0;
    for (i = 0; i < n; i++) { dx = pp[i].x - cx; dy = pp[i].y - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    var theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    var ux = Math.cos(theta), uy = Math.sin(theta), vx = -uy, vy = ux;
    var ext = _projectExtents(pp, cx, cy, ux, uy, vx, vy);
    var r = (ext.smax - ext.smin) / 2;
    if (r <= 1e-6) return null;
    var kissOnly = false;
    if ((ext.tmax - ext.tmin) < 2.0 * 2 * r) {           // near-circular/short → axis unreliable
        kissOnly = true;
        if (geom.travelIsX) { vx = 1; vy = 0; ux = 0; uy = 1; }
        else                { vx = 0; vy = 1; ux = 1; uy = 0; }
        ext = _projectExtents(pp, cx, cy, ux, uy, vx, vy);
        r = (ext.smax - ext.smin) / 2;
        if (r <= 1e-6) return null;
    }
    var vTravel = geom.travelIsX ? vx : vy;
    var sInner = (vTravel * geom.sign >= 0) ? 1 : -1;
    var verts = [], tt, ss;
    for (i = 0; i < n; i++) {
        dx = pp[i].x - cx; dy = pp[i].y - cy;
        tt = dx * ux + dy * uy; ss = dx * vx + dy * vy;
        if (!includeCaps && (tt <= ext.tmin + r || tt >= ext.tmax - r)) continue;   // skip caps
        if (ss * sInner <= 0) continue;                           // skip the outer long edge
        verts.push({ x: pp[i].x, y: pp[i].y, t: tt });
    }
    if (verts.length < 2) {                                       // degenerate → one inner point
        return { verts: [ { x: cx + vx * (sInner * r), y: cy + vy * (sInner * r), t: 0 } ],
                 radius: r, kissOnly: true };
    }
    verts.sort(function (a, b) { return a.t - b.t; });
    return { verts: verts, radius: r, kissOnly: kissOnly };
}

// A TAB's attach-edge endpoints — the two "pointy tips" that must land on the element border. For
// a pill, the caps are rounded ends to SKIP (see _innerEdgeVerts line "skip caps"); a tab's tips
// ARE the endpoints, so we KEEP the extremes of the long axis. Returns the two vertices extreme
// along the plate's long axis, restricted to the ART-FACING side (so a tab that is wider on its
// OUTER edge still picks the attach edge). geom = { travelIsX, sign } points plate → art.
// Returns { e0, e1 } (e0 = min long-axis, e1 = max) or null. Pure geometry.
function _tabAttachTips(pp, geom) {
    var n = pp.length; if (n < 3) return null;
    var cx = 0, cy = 0, i, dx, dy;
    for (i = 0; i < n; i++) { cx += pp[i].x; cy += pp[i].y; }
    cx /= n; cy /= n;
    var sxx = 0, syy = 0, sxy = 0;
    for (i = 0; i < n; i++) { dx = pp[i].x - cx; dy = pp[i].y - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    var theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    var ux = Math.cos(theta), uy = Math.sin(theta), vx = -uy, vy = ux;
    var vTravel = geom.travelIsX ? vx : vy;
    var sInner = (vTravel * geom.sign >= 0) ? 1 : -1;   // +ss is the art-facing side
    var loT = 1e15, hiT = -1e15, lo = null, hi = null;
    for (i = 0; i < n; i++) {
        dx = pp[i].x - cx; dy = pp[i].y - cy;
        var ss = dx * vx + dy * vy;
        if (ss * sInner < 0) continue;                  // art-facing half only
        var tt = dx * ux + dy * uy;
        if (tt < loT) { loT = tt; lo = pp[i]; }
        if (tt > hiT) { hiT = tt; hi = pp[i]; }
    }
    if (!lo || !hi || lo === hi) return null;
    return { e0: { x: lo.x, y: lo.y }, e1: { x: hi.x, y: hi.y } };
}

// Travel axis (plate centre -> art centre) and its sign (+1 toward the larger coordinate).
// AI geometricBounds are [left, top, right, bottom] in y-up points. Twin of Step3B's
// _seatGeometry. Pure DOM read; no mutation.
function _aiSeatGeometry(plate, outline) {
    var pb = plate.geometricBounds, ob = outline.geometricBounds;
    var dx = (ob[0] + ob[2]) / 2 - (pb[0] + pb[2]) / 2;
    var dy = (ob[1] + ob[3]) / 2 - (pb[1] + pb[3]) / 2;
    var travelIsX = Math.abs(dx) > Math.abs(dy);
    var sign = travelIsX ? (dx >= 0 ? 1 : -1) : (dy >= 0 ? 1 : -1);
    return { travelIsX: travelIsX, sign: sign };
}

// Projects polygon vertices onto axes u and v about centroid (cx, cy); returns the min/max
// along each. Pure geometry.
function _projectExtents(pp, cx, cy, ux, uy, vx, vy) {
    var tmin = 1e15, tmax = -1e15, smin = 1e15, smax = -1e15, i, dx, dy, tt, ss;
    for (i = 0; i < pp.length; i++) {
        dx = pp[i].x - cx; dy = pp[i].y - cy;
        tt = dx * ux + dy * uy; ss = dx * vx + dy * vy;
        if (tt < tmin) tmin = tt;
        if (tt > tmax) tmax = tt;
        if (ss < smin) smin = ss;
        if (ss > smax) smax = ss;
    }
    return { tmin: tmin, tmax: tmax, smin: smin, smax: smax };
}

// Casts a probe line through E parallel to the travel axis and returns the outline edge it
// crosses NEAREST the pill (the facing edge), as {x,y}, or null when the line misses the
// outline (overhang). Vector twin of Step3B's _probeBorder (which read a 1px raster strip).
// Pure geometry over the sampled outline polygons.
function _probeOutline(artPolys, geom, E) {
    var best = null, bestC = 0, ai, A, i, j, p1, p2, c;
    for (ai = 0; ai < artPolys.length; ai++) {
        A = artPolys[ai];
        for (i = 0, j = A.length - 1; i < A.length; j = i++) {
            p1 = A[j]; p2 = A[i];
            if (geom.travelIsX) {
                if ((p1.y > E.y) === (p2.y > E.y)) continue;            // edge doesn't span E.y
                c = p1.x + (p2.x - p1.x) * (E.y - p1.y) / (p2.y - p1.y);
                if (best === null || (geom.sign > 0 ? c < bestC : c > bestC)) {
                    best = { x: c, y: E.y }; bestC = c;
                }
            } else {
                if ((p1.x > E.x) === (p2.x > E.x)) continue;            // edge doesn't span E.x
                c = p1.y + (p2.y - p1.y) * (E.x - p1.x) / (p2.x - p1.x);
                if (best === null || (geom.sign > 0 ? c < bestC : c > bestC)) {
                    best = { x: E.x, y: c }; bestC = c;
                }
            }
        }
    }
    return best;
}

// Translation (along the travel axis only) that lands E0 on B0 and submerges the pill into
// the art by depth d. Bidirectional (signed). Twin of Step3B's _kissVector. Pure geometry.
function _aiKissVector(E0, B0, geom, depth) {
    var dT = (geom.travelIsX ? (B0.x - E0.x) : (B0.y - E0.y)) + geom.sign * depth;
    return geom.travelIsX ? { tx: dT, ty: 0 } : { tx: 0, ty: dT };
}

// Drops near-coincident points (a shared polygon vertex is hit from both adjacent segments).
// Pure geometry.
function _dedupePoints(pts, tol) {
    if (tol === undefined) tol = 1e-4;
    var out = [], i, jj, dup;
    for (i = 0; i < pts.length; i++) {
        dup = false;
        for (jj = 0; jj < out.length; jj++) {
            if (Math.abs(pts[i].x - out[jj].x) <= tol && Math.abs(pts[i].y - out[jj].y) <= tol) {
                dup = true; break;
            }
        }
        if (!dup) out.push(pts[i]);
    }
    return out;
}

// Every point where the circle of radius L centered at P crosses a segment of the sampled border
// polygons. Solves |p1 + t*(p2-p1) - P|^2 = L^2 per segment, keeping roots with t in [0,1].
// Returns a deduped array of {x,y}; empty when the circle never reaches the border. Pure geometry.
function _circlePolyIntersections(P, L, polys) {
    var out = [], ai, A, i, j, p1, p2, k;
    var L2 = L * L, eps = 1e-9;
    for (ai = 0; ai < polys.length; ai++) {
        A = polys[ai];
        for (i = 0, j = A.length - 1; i < A.length; j = i++) {
            p1 = A[j]; p2 = A[i];
            var dx = p2.x - p1.x, dy = p2.y - p1.y;
            var fx = p1.x - P.x, fy = p1.y - P.y;
            var a = dx * dx + dy * dy;
            if (a < eps) continue;                                   // degenerate segment
            var b = 2 * (fx * dx + fy * dy);
            var c = fx * fx + fy * fy - L2;
            var disc = b * b - 4 * a * c;
            if (disc < -eps) continue;                               // no real intersection
            if (disc < 0) disc = 0;
            var sq = Math.sqrt(disc);
            var roots = [(-b - sq) / (2 * a), (-b + sq) / (2 * a)];
            for (k = 0; k < 2; k++) {
                var t = roots[k];
                if (t < -1e-6 || t > 1 + 1e-6) continue;             // outside the segment
                out.push({ x: p1.x + t * dx, y: p1.y + t * dy });
            }
        }
    }
    return _dedupePoints(out, 1e-4);
}

// Of the two inner-edge endpoints, the one that reaches its border point with the LEAST forward
// travel toward the art (smallest signed gap). That one is translated onto the border first; the
// other is then rotated down onto the border. geom = { travelIsX, sign } (plate -> art). Both
// border points are non-null here (overhang is handled upstream). Pure geometry.
function _seatNearEndpoint(E0, B0, E1, B1, geom) {
    function gap(E, B) {
        return geom.sign * (geom.travelIsX ? (B.x - E.x) : (B.y - E.y));
    }
    if (gap(E0, B0) <= gap(E1, B1)) return { P: E0, Bp: B0, Q: E1, Bq: B1 };
    return { P: E1, Bp: B1, Q: E0, Bq: B0 };
}

// The smallest-magnitude rotation about the (already on-border) near endpoint P that lands the far
// endpoint Q on the border. Q is rigidly at distance L=|P-Q| from P, so its target is where the
// circle of radius L about P meets the border. deg is CCW-positive in AI's y-up space (feeds
// _rotateItemsAbout directly). Pure geometry.
function _seatContactRotation(P, Q, polys, maxRot) {
    var L = Math.sqrt((Q.x - P.x) * (Q.x - P.x) + (Q.y - P.y) * (Q.y - P.y));
    if (L < 1e-6) return { ok: false, reason: "degenerate chord" };
    var hits = _circlePolyIntersections(P, L, polys);
    if (!hits.length) return { ok: false, reason: "far endpoint cannot reach border" };
    var qAng = _aiChordAngleDeg(P, Q);
    var best = 0, bestAbs = 1e18, i, d;
    for (i = 0; i < hits.length; i++) {
        d = _aiNormalizeDeg(_aiChordAngleDeg(P, hits[i]) - qAng);
        if (Math.abs(d) < bestAbs) { bestAbs = Math.abs(d); best = d; }
    }
    if (bestAbs > maxRot) return { ok: true, deg: 0, needsReview: true, clamped: true };
    return { ok: true, deg: best, needsReview: false, clamped: false };
}

// How far the outline at the inner-edge midpoint protrudes INTO the pill along the travel
// axis: p = sagitta + depth (sagitta = Bm's deviation from the B0->B1 chord toward the pill,
// signed by geom.sign). Twin of Step3B's _midProtrusion. null when any probe is missing.
function _aiMidProtrusion(B0, B1, Bm, geom, depth) {
    if (!B0 || !B1 || !Bm) return null;
    var b0 = geom.travelIsX ? B0.x : B0.y;
    var b1 = geom.travelIsX ? B1.x : B1.y;
    var bm = geom.travelIsX ? Bm.x : Bm.y;
    var chordMid = (b0 + b1) / 2;
    return (-geom.sign * (bm - chordMid)) + depth;
}

// ── DIRECTION-VECTOR tab seating (rotation-robust) ────────────────────────────
// The tab travel direction from the tab polygon's OWN orientation (PCA short axis), pointed toward
// the outline. Reads the tab's ACTUAL current shape, so seating is correct wherever the artist has
// dragged or ROTATED it — unlike the shape-level center-offset axis guess (_aiSeatGeometry), which
// mis-seats a wide/thin element's bottom tab (probes sideways, misses the art). Returns
// { dx, dy (unit, into the art), ux, uy (attach-edge axis), cx, cy (tab centroid) }.
function _tabTravelDir(tabPoly, artPolys) {
    var n = tabPoly.length, cx = 0, cy = 0, i, dx, dy;
    for (i = 0; i < n; i++) { cx += tabPoly[i].x; cy += tabPoly[i].y; }
    cx /= n; cy /= n;
    var sxx = 0, syy = 0, sxy = 0;
    for (i = 0; i < n; i++) { dx = tabPoly[i].x - cx; dy = tabPoly[i].y - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    var th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    var ux = Math.cos(th), uy = Math.sin(th), vx = -uy, vy = ux;   // u = long axis (attach edge), v = short (depth)
    var oc = _polyCentroid(_largestPoly(artPolys));
    var dot = vx * (oc.x - cx) + vy * (oc.y - cy);                 // orient v TOWARD the art
    if (dot < 0) { vx = -vx; vy = -vy; }
    return { dx: vx, dy: vy, ux: ux, uy: uy, cx: cx, cy: cy };
}

// The tab's two attach-edge TIPS: the extremes along the attach-edge axis (u), on the art-facing
// half (+travel side). Derived from the tab's current geometry, so they track a rotated tab.
function _tabTipsDir(tabPoly, dir) {
    var loT = 1e15, hiT = -1e15, lo = null, hi = null, i;
    for (i = 0; i < tabPoly.length; i++) {
        var ddx = tabPoly[i].x - dir.cx, ddy = tabPoly[i].y - dir.cy;
        if (ddx * dir.dx + ddy * dir.dy < 0) continue;            // art-facing half only
        var tt = ddx * dir.ux + ddy * dir.uy;
        if (tt < loT) { loT = tt; lo = tabPoly[i]; }
        if (tt > hiT) { hiT = tt; hi = tabPoly[i]; }
    }
    return (lo && hi && lo !== hi) ? { e0: { x: lo.x, y: lo.y }, e1: { x: hi.x, y: hi.y } } : null;
}

// Direction-vector twin of _probeOutline: cast a ray from E along (dir.dx, dir.dy) and return the
// NEAREST FORWARD crossing with the outline, or null (no art ahead → the tab genuinely can't seat
// at that tip in that direction, e.g. rotated too far on a thin element — a real hard error).
function _probeOutlineDir(artPolys, E, dir) {
    var best = null, bestT = 1e18, ai, A, i, j, p1, p2;
    for (ai = 0; ai < artPolys.length; ai++) {
        A = artPolys[ai];
        for (i = 0, j = A.length - 1; i < A.length; j = i++) {
            p1 = A[j]; p2 = A[i];
            var sx = p2.x - p1.x, sy = p2.y - p1.y;
            var det = sx * dir.dy - dir.dx * sy;
            if (Math.abs(det) < 1e-9) continue;                   // ray parallel to this edge
            var t = (-(p1.x - E.x) * sy + sx * (p1.y - E.y)) / det;   // ray param (>0 forward)
            var u = (dir.dx * (p1.y - E.y) - dir.dy * (p1.x - E.x)) / det; // edge param [0,1]
            if (t > 1e-6 && u >= 0 && u <= 1 && t < bestT) { bestT = t; best = { x: E.x + t * dir.dx, y: E.y + t * dir.dy }; }
        }
    }
    return best;
}

// Direction-vector kiss: B0 lies along the probe ray from E0, so (B0-E0) is parallel to dir. Land
// E0 on B0 and submerge by depth further along the travel direction (into the art).
function _aiKissVectorDir(E0, B0, dir, depth) {
    return { tx: (B0.x - E0.x) + dir.dx * depth, ty: (B0.y - E0.y) + dir.dy * depth };
}

// Signed angle (deg) of the chord p->q. Twin of Step3B's _chordAngleDeg.
function _aiChordAngleDeg(p, q) { return Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI; }

// Normalises an angle to (-180, 180]. Twin of Step3B's _normalizeDeg.
function _aiNormalizeDeg(d) {
    while (d <= -180) d += 360;
    while (d >   180) d -= 360;
    return d;
}

// Rotates each item rigidly by phiDeg about the shared pivot, via an explicit about-pivot
// matrix applied with DOCUMENTORIGIN (same construction as Step8b's _scaleAboutPoint, so a
// PathItem plate and a PlacedItem caption transform identically). app.getRotationMatrix gives
// a CCW rotation for +deg in AI's y-up space; the tx/ty re-anchor keeps `pivot` fixed.
function _rotateItemsAbout(items, pivot, phiDeg) {
    if (Math.abs(phiDeg) < 0.01) return;
    var m = app.getRotationMatrix(phiDeg);
    m.mValueTX = pivot.x * (1 - m.mValueA) - m.mValueC * pivot.y;
    m.mValueTY = pivot.y * (1 - m.mValueD) - m.mValueB * pivot.x;
    var i;
    for (i = 0; i < items.length; i++) {
        if (items[i]) {
            items[i].transform(m, true, true, true, true, 1, Transformation.DOCUMENTORIGIN);
        }
    }
}

// Translates each item rigidly by (tx, ty). No-op below sub-point. Twin of Step3B's
// _translateLayers (plate is a PathItem, caption a PlacedItem; both expose translate).
function _translateItems(items, tx, ty) {
    if (Math.abs(tx) < 1e-9 && Math.abs(ty) < 1e-9) return;
    var i;
    for (i = 0; i < items.length; i++) {
        if (items[i]) items[i].translate(tx, ty);
    }
}

// ─── PATH SIMPLIFICATION (Step 8a) ────────────────────────────────────────────
// Curve-aware path simplify (the artist's Object>Path>Simplify, which isn't scriptable with
// parameters). Corner-split -> dense bezier sample -> RDP on the sampling -> clamped-tangent
// refit, so smooth curves stay smooth (not faceted) and genuine corners stay sharp (not
// chamfered/looped). tolerance/cornerAngle/stepsPerSeg are supplied by the caller (CONFIG).
// See _simplifyOnePath for the algorithm; rdpSimplify/_rdpClosed below are the RDP core.

// Perpendicular distance from point p to the line through a–b (all {x,y}).
function _perpDistance(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len2 = dx * dx + dy * dy;
    if (len2 === 0) {
        var ex = p.x - a.x, ey = p.y - a.y;
        return Math.sqrt(ex * ex + ey * ey);
    }
    var num = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x);
    return num / Math.sqrt(len2);
}

// Turn angle (deviation from straight, degrees 0..180) at cur between prev and next.
function _turnAngle(prev, cur, next) {
    var v1x = cur.x - prev.x, v1y = cur.y - prev.y;
    var v2x = next.x - cur.x, v2y = next.y - cur.y;
    var m1 = Math.sqrt(v1x * v1x + v1y * v1y);
    var m2 = Math.sqrt(v2x * v2x + v2y * v2y);
    if (m1 === 0 || m2 === 0) return 0;
    var cos = (v1x * v2x + v1y * v2y) / (m1 * m2);
    if (cos > 1) cos = 1; else if (cos < -1) cos = -1;
    return Math.acos(cos) * 180 / Math.PI;
}

// Classic recursive RDP on an open polyline of {x,y}. Returns the kept points.
function rdpSimplify(points, epsilon) {
    if (points.length < 3) return points.slice(0);
    var end = points.length - 1;
    var dmax = 0, index = 0, i;
    for (i = 1; i < end; i++) {
        var d = _perpDistance(points[i], points[0], points[end]);
        if (d > dmax) { dmax = d; index = i; }
    }
    if (dmax > epsilon) {
        var r1 = rdpSimplify(points.slice(0, index + 1), epsilon);
        var r2 = rdpSimplify(points.slice(index), epsilon);
        return r1.slice(0, r1.length - 1).concat(r2);
    }
    return [points[0], points[end]];
}

// RDP for a closed polyline: split at the anchor farthest from anchors[0], RDP
// each arc, recombine without repeating the shared endpoints.
function _rdpClosed(anchors, epsilon) {
    var n = anchors.length;
    if (n < 4) return anchors.slice(0);
    var far = 0, dmax = -1, i;
    for (i = 1; i < n; i++) {
        var dx = anchors[i].x - anchors[0].x;
        var dy = anchors[i].y - anchors[0].y;
        var d = dx * dx + dy * dy;
        if (d > dmax) { dmax = d; far = i; }
    }
    var firstHalf  = anchors.slice(0, far + 1);
    var secondHalf = anchors.slice(far).concat([anchors[0]]);
    var k1 = rdpSimplify(firstHalf, epsilon);
    var k2 = rdpSimplify(secondHalf, epsilon);
    return k1.slice(0, k1.length - 1).concat(k2.slice(0, k2.length - 1));
}

// Angle (degrees, 0..180) between two direction vectors.
function _vecAngleDeg(ax, ay, bx, by) {
    var m1 = Math.sqrt(ax * ax + ay * ay);
    var m2 = Math.sqrt(bx * bx + by * by);
    if (m1 === 0 || m2 === 0) return 0;
    var c = (ax * bx + ay * by) / (m1 * m2);
    if (c > 1) c = 1; else if (c < -1) c = -1;
    return Math.acos(c) * 180 / Math.PI;
}

// Writes a reduced node list back onto a PathItem. Each node = {x, y, corner}. Corners get
// zero-length handles (hard); smooth nodes get tangent handles CLAMPED to a fraction of the
// adjacent chord — tangent keeps the curve smooth, the clamp (< 0.5) kills the Catmull-Rom
// overshoot that curled tight corners in the old anchor-only refit.
function _writeSmoothNodes(path, nodes) {
    var closed = path.closed;
    var n = nodes.length, i;
    var frac = 0.33;
    var coords = [];
    for (i = 0; i < n; i++) coords.push([nodes[i].x, nodes[i].y]);
    path.setEntirePath(coords);
    path.closed = closed;                       // setEntirePath can drop the closed flag

    var pp = path.pathPoints;
    for (i = 0; i < n; i++) {
        var cur = nodes[i], p = pp[i];
        var isEnd = (!closed && (i === 0 || i === n - 1));
        if (cur.corner || isEnd) {
            p.leftDirection  = [cur.x, cur.y];
            p.rightDirection = [cur.x, cur.y];
            p.pointType = PointType.CORNER;
            continue;
        }
        var prev = nodes[(i - 1 + n) % n], next = nodes[(i + 1) % n];
        var tx = next.x - prev.x, ty = next.y - prev.y;
        var tm = Math.sqrt(tx * tx + ty * ty);
        if (tm < 1e-9) {
            p.leftDirection  = [cur.x, cur.y];
            p.rightDirection = [cur.x, cur.y];
            p.pointType = PointType.CORNER;
            continue;
        }
        tx /= tm; ty /= tm;
        var dPrev = Math.sqrt((cur.x - prev.x) * (cur.x - prev.x) + (cur.y - prev.y) * (cur.y - prev.y));
        var dNext = Math.sqrt((next.x - cur.x) * (next.x - cur.x) + (next.y - cur.y) * (next.y - cur.y));
        p.leftDirection  = [cur.x - tx * frac * dPrev, cur.y - ty * frac * dPrev];
        p.rightDirection = [cur.x + tx * frac * dNext, cur.y + ty * frac * dNext];
        p.pointType = PointType.SMOOTH;
    }
}

// Curve-aware simplify of ONE PathItem in place. A raw RDP on the sparse anchors chord-
// approximates the bezier curves, so it facets/overshoots them (the flower collapsed to a
// polygon, rounded corners chamfered). This instead:
//   1. classifies each ORIGINAL anchor as a genuine CORNER (tangents break by >= cornerAngle)
//      vs SMOOTH — real corners are protected, rounded ones are NOT mistaken for corners;
//   2. densely SAMPLES the true bezier of each smooth run between corners;
//   3. RDPs that dense sampling, so it follows the real curve rather than a chord guess;
//   4. rebuilds with CLAMPED tangent handles (smooth, no overshoot). Corners stay hard.
// Returns true if the anchor count dropped.
function _simplifyOnePath(path, tolerancePt, cornerAngleDeg, stepsPerSeg) {
    var pts = path.pathPoints;
    var n = pts.length;
    if (n < 4) return false;
    var closed = path.closed;

    var A = [], L = [], R = [], k;
    for (k = 0; k < n; k++) { A[k] = pts[k].anchor; L[k] = pts[k].leftDirection; R[k] = pts[k].rightDirection; }

    // 1. corner classification from tangent discontinuity (handles, with anchor-chord fallback).
    var corner = [], C = [];
    for (k = 0; k < n; k++) {
        if (!closed && (k === 0 || k === n - 1)) { corner[k] = true; C.push(k); continue; }
        var a = A[k], pv = A[(k - 1 + n) % n], nx = A[(k + 1) % n];
        var inx = a[0] - L[k][0], iny = a[1] - L[k][1];
        if (inx * inx + iny * iny < 1e-6) { inx = a[0] - pv[0]; iny = a[1] - pv[1]; }
        var outx = R[k][0] - a[0], outy = R[k][1] - a[1];
        if (outx * outx + outy * outy < 1e-6) { outx = nx[0] - a[0]; outy = nx[1] - a[1]; }
        corner[k] = (_vecAngleDeg(inx, iny, outx, outy) >= cornerAngleDeg);
        if (corner[k]) C.push(k);
    }

    // dense-sample the bezier from anchor i0 forward to anchor i1 (wraps if i1 < i0), inclusive.
    function denseRun(i0, i1) {
        var poly = [{ x: A[i0][0], y: A[i0][1] }], i = i0;
        while (i !== i1) {
            var nn = (i + 1) % n, p0 = A[i], p1 = R[i], p2 = L[nn], p3 = A[nn], j, t;
            for (j = 1; j <= stepsPerSeg; j++) { t = j / stepsPerSeg; poly.push(_bezierPoint(p0, p1, p2, p3, t)); }
            i = nn;
        }
        return poly;
    }

    var nodes = [], m;

    if (!closed || C.length >= 2) {
        // Split into smooth runs between consecutive corners; RDP each, keep corners hard.
        var lim = closed ? C.length : C.length - 1;
        for (m = 0; m < lim; m++) {
            var c0 = C[m], c1 = C[(m + 1) % C.length];
            var run  = denseRun(c0, c1);
            var kept = rdpSimplify(run, tolerancePt);          // open RDP; keeps both ends
            nodes.push({ x: A[c0][0], y: A[c0][1], corner: true });
            var q;
            for (q = 1; q < kept.length - 1; q++) nodes.push({ x: kept[q].x, y: kept[q].y, corner: false });
        }
        if (!closed) nodes.push({ x: A[n - 1][0], y: A[n - 1][1], corner: true });
    } else {
        // Fully smooth closed loop (0 or 1 corner): sample the whole loop, RDP it closed, all smooth.
        var full = [];
        for (k = 0; k < n; k++) {
            var nk = (k + 1) % n, b0 = A[k], b1 = R[k], b2 = L[nk], b3 = A[nk], jj, tt;
            for (jj = 0; jj < stepsPerSeg; jj++) { tt = jj / stepsPerSeg; full.push(_bezierPoint(b0, b1, b2, b3, tt)); }
        }
        var keptC = _rdpClosed(full, tolerancePt);
        for (k = 0; k < keptC.length; k++) nodes.push({ x: keptC[k].x, y: keptC[k].y, corner: false });
    }

    // A re-fit that removes NO nodes is still a win: the artist's Object>Path>Simplify routinely
    // keeps the node COUNT and only re-types corners into smooth points (Bratislava(text): 36 -> 36,
    // every corner smoothed). Gating on count reduction handed 9/23 elements back untouched, fully
    // faceted — the kinks are the defect, not the node count. Outward drift is policed by the caller
    // (_simplifyWithinBudget re-simplifies from the original and restores when it exceeds budget),
    // so that is the real safety net; refuse only a collapse or a genuine densification.
    if (nodes.length < (closed ? 3 : 2)) return false;          // would collapse — bail
    // Refuse ANY densification. This started as `> n * 1.2` (allow up to +20%), which let
    // National Flower go 70 -> 77 on a live Pipeline 1 run — the "simplify" ADDING 7 anchors.
    // That is not a tuning miss, it is the algorithm meeting its limit: an already-well-fitted
    // curve (National Flower was 71 pts, 48 of them already smooth) cannot be re-described by
    // RDP-of-a-sampling + Catmull-Rom handles in FEWER points than the original beziers used.
    // So when our re-fit needs more anchors than what is already there, our re-fit is simply
    // worse than the input and the right move is to decline and leave the path alone.
    // `== n` is still allowed — that is the artist's usual case (re-type corners to smooth at
    // the same count, e.g. Bratislava(text) 36 -> 36).
    if (nodes.length > n) return false;                         // our re-fit is worse than the input

    _writeSmoothNodes(path, nodes);
    return true;
}

// Simplifies a PathItem (or each sub-path of a CompoundPathItem) in place. tolerancePt is the
// RDP epsilon (points); cornerAngleDeg is the tangent-break angle above which an anchor stays a
// hard corner; stepsPerSeg is the bezier sampling density (default 16). Returns the number of
// sub-paths actually CHANGED — re-typed (corner -> smooth) and/or reduced. A sub-path can change
// with no drop in node count; that is the artist's usual case, not a no-op.
function simplifyPathItem(path, tolerancePt, cornerAngleDeg, stepsPerSeg) {
    if (stepsPerSeg == null) stepsPerSeg = 16;
    if (path.typename === "CompoundPathItem") {
        var reduced = 0, i;
        for (i = 0; i < path.pathItems.length; i++) {
            reduced += simplifyPathItem(path.pathItems[i], tolerancePt, cornerAngleDeg, stepsPerSeg);
        }
        return reduced;
    }
    if (path.typename !== "PathItem") return 0;
    return _simplifyOnePath(path, tolerancePt, cornerAngleDeg, stepsPerSeg) ? 1 : 0;
}

// ─── STEP 9 SHARED HELPERS ────────────────────────────────────────────────────

// Parses group.note "GC|2" (or "GC|2|R") → { styleCode, capLines, needsReview }.
// Returns null for empty/missing. The optional 3rd field "R" marks a caption seat that
// Step 3B's conform flagged for review (surfaced by AI Layout QA). Used by Step 9A /
// syncHalfcut (filter GC/WC) and Step 8c/AI_LayoutQA (the review marker).
function parseNote(note) {
    if (!note || note === "") return null;
    var parts = note.split("|");
    // "R" (needs-review) can be in ANY trailing slot — the note gained an area field ("a<pt²>")
    // between lines and R ("WC|1|a720|R" / "ST|0|a90|R"), so a fixed parts[2] check misses it.
    var review = false, i;
    for (i = 2; i < parts.length; i++) { if (parts[i] === "R") review = true; }
    return {
        styleCode:   parts[0],
        capLines:    parts.length > 1 ? parseInt(parts[1], 10) : 1,
        needsReview: review
    };
}

// Display names of every Cutlines-group element whose note carries the seat-review flag
// ("|R"). Consumed by the seating pipelines' completion dialogs (the seat-review badge was
// removed from the QA overlay). Returns [] when none.
function collectSeatReviewNames(doc) {
    var out = [], layer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!layer) return out;
    var i, g, note;
    for (i = 0; i < layer.pageItems.length; i++) {
        g = layer.pageItems[i];
        if (g.parent !== layer || g.typename !== "GroupItem") continue;
        note = parseNote(g.note);
        if (note && note.needsReview) out.push(g.name);
    }
    return out;
}

// Read-only case-insensitive lookup of the halfcut layer (CONFIG.halfcutLayerName); null if
// absent. Used by the verify/QA path (validateHalfcut) so an advisory pass never creates a layer.
function _findHalfcutLayer(doc) {
    var name = CONFIG.halfcutLayerName, i;
    for (i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i].name.toLowerCase() === name.toLowerCase()) return doc.layers[i];
    }
    return null;
}

// Read-only lookup of a named PathItem directly on a layer; null if absent.
function _findHalfcutPathItem(hcLayer, name) {
    var i;
    for (i = 0; i < hcLayer.pathItems.length; i++) {
        if (hcLayer.pathItems[i].name === name) return hcLayer.pathItems[i];
    }
    return null;
}

// Returns the halfcut layer (case-insensitive match on CONFIG.halfcutLayerName).
// Creates it above the Cutlines layer if absent.
function getOrCreateHalfcutLayer(doc) {
    var existing = _findHalfcutLayer(doc);
    if (existing) return existing;
    var newLayer = doc.layers.add();
    newLayer.name = CONFIG.halfcutLayerName;
    var cutLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (cutLayer) {
        newLayer.move(cutLayer, ElementPlacement.PLACEBEFORE);
    }
    log("[step9] created halfcut layer: " + CONFIG.halfcutLayerName);
    return newLayer;
}

// Draws an open multi-point PathItem (the half-cut seam polyline) on layer, named
// "{baseName} halfcut" so syncHalfcut can find + clear it on the next run. pts =
// [{x,y}, …]. Stroke = CONFIG.halfcutStrokePt, black, no fill.
function drawHalfcutPath(layer, pts, baseName) {
    pts = _decimateSeam(pts, 400);   // cap point count — setEntirePath rejects very dense paths
    var coords = [], i;
    for (i = 0; i < pts.length; i++) coords.push([pts[i].x, pts[i].y]);
    var line = layer.pathItems.add();
    try {
        line.setEntirePath(coords);   // throws "Illegal Argument" on a degenerate seam
    } catch (e) {
        try { line.remove(); } catch (e2) {}
        log("[halfcut] WARN | setEntirePath rejected a " + coords.length + "-pt seam for "
            + (baseName || "?") + " (" + e.message + ") — no tab drawn.");
        return null;
    }
    line.closed = false;
    if (baseName) line.name = baseName + " halfcut";
    setStrokeStyle(line, CONFIG.halfcutStrokePt, blackRgb());
    return line;
}

// Removes any existing half-cut path(s) for one element (named "{baseName} halfcut")
// from the halfcut layer, so syncHalfcut is idempotent under the re-run loops (Step 7B
// clears art on entry, Step 8b runs repeatedly). Snapshots refs first — the live
// pathItems collection re-indexes on remove. Returns the number removed.
function _removeHalfcutFor(layer, baseName) {
    var want = baseName + " halfcut";
    var doomed = [], i;
    for (i = 0; i < layer.pathItems.length; i++) {
        if (layer.pathItems[i].name === want) doomed.push(layer.pathItems[i]);
    }
    for (i = 0; i < doomed.length; i++) { try { doomed[i].remove(); } catch (e) {} }
    return doomed.length;
}

// Re-derives and draws ONE element's half-cut from its CURRENT caption seam, so the
// half-cut tracks the caption after any step that creates/moves/rescales it (Step 6
// birth, Step 7B nest-import, Step 8b normalise, Step 9A export). Idempotent: clears
// this element's prior "{name} halfcut" first. GC/WC only (gated on the cutline note);
// stamps / uncaptioned skip. The seam is the arc of the plate's outline submerged in
// the art — straight rigid seat → a near-straight cut, arc/tilted seat → a curved cut
// (the half-cut is derived from real geometry, never assumed flat). There is NO fallback:
// an unseated caption (not connected to the art, or completely inside it) returns
// { ok:false, reason } so the caller can surface it as a hard error. Returns
// { ok, reason, curved }.
//   opts: { extendMm } (default from CONFIG.halfcutExtendMm)
function syncHalfcut(doc, group, opts) {
    opts = opts || {};
    var extendMm   = (opts.extendMm   != null) ? opts.extendMm   : CONFIG.halfcutExtendMm;

    if (!group || group.typename !== "GroupItem") {
        return { ok: false, reason: "stamp / non-group (no caption seam)" };
    }
    var note = parseNote(group.note);
    if (!note || (note.styleCode !== "GC" && note.styleCode !== "WC" && note.styleCode !== "ST")) {
        return { ok: false, reason: "not GC/WC/tab" };
    }

    var plate   = findGroupMember(group, " plate");
    var outline = findGroupMember(group, " outline");
    var cutline = findGroupMember(group, "");
    if (!plate)   return { ok: false, reason: "plate subpath not found in group" };
    if (!cutline) return { ok: false, reason: "cutline not found in group" };
    if (!outline) return { ok: false, reason: "outline subpath not found in group" };

    var hcLayer = getOrCreateHalfcutLayer(doc);
    _removeHalfcutFor(hcLayer, group.name);

    var ext = mmToPoints(extendMm);

    // Trace the real seam (the plate's submerged arc — inner edge + caps) with RAW ends, then
    // extend each end onto the actual cut line with a 1mm tail that
    // RUNS ALONG the cut line — so the half-cut meets the contour even where the junction
    // fillet has pulled it off the plate∩art crossing, and the overshoot superimposes on the
    // cut line (invisible against it) instead of straying off into the art. See the HALF-CUT
    // ENDPOINT EXTENSION section.
    //
    // NO fallback: a null seam means the caption is not seated into the art (not connected, or
    // fully inside it) — a hard error for the artist to fix, not a flat-cut guess.
    //
    // Sample the plate ONCE for this pass and thread it through BOTH the seam trace and the
    // endpoint extension — the plate is not mutated between them, so the second sample was pure
    // waste. The outline goes through the per-pass cache (so it can reuse the seat's sample when
    // the step counts match). Both samples are at halfcutSeamSteps, matching the prior behaviour
    // exactly. See _sampleCached.
    var cache = opts.polyCache || null;
    var steps = CONFIG.halfcutSeamSteps || 16;   // same effective default plateSeamPath applied
    var platePolys = samplePathToPolygons(plate, steps);
    var artPolys   = _sampleCached(cache, "outline", outline, steps);

    var seam = plateSeamPath(plate, outline, steps, platePolys, artPolys);
    if (!seam || seam.length < 2) {
        return { ok: false, reason: "caption not seated into the art (not connected, or completely inside it)" };
    }
    var curved = _seamCurved(seam, mmToPoints(0.12));
    seam = _extendHalfcutEndsToCutline(seam, cutline, plate, ext, steps, platePolys, artPolys);
    if (!_seamFinite(seam)) {   // never hand setEntirePath a <2-point / non-finite / zero-extent seam
        return { ok: false, reason: "degenerate seam (too few/coincident points after extension)" };
    }
    if (!drawHalfcutPath(hcLayer, seam, group.name)) {
        return { ok: false, reason: "half-cut path rejected by setEntirePath" };
    }
    var e0 = seam[0], eN = seam[seam.length - 1];
    log("[halfcut] " + group.name + " | pts=" + seam.length
        + " end0=(" + _r1(e0.x) + "," + _r1(e0.y) + ")"
        + " endN=(" + _r1(eN.x) + "," + _r1(eN.y) + ")"
        + (curved ? " curved" : " straight"));
    return { ok: true, curved: curved };
}

// ─── HALF-CUT VALIDATION (export gate + Layout QA; no re-derivation) ───────────
// Nearest point ON segment a-b to p (clamped projection; all {x,y}); pure.
function _nearestPointOnSegment(p, a, b) {
    var vx = b.x - a.x, vy = b.y - a.y;
    var len2 = vx * vx + vy * vy;
    var t = len2 > 0 ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2 : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return { x: a.x + t * vx, y: a.y + t * vy };
}

// Distance from point p to segment a-b (all {x,y}); pure.
function _distPointToSegment(p, a, b) {
    var q = _nearestPointOnSegment(p, a, b);
    var dx = p.x - q.x, dy = p.y - q.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// Nearest point ON the polygon's edges (closed ring) to p; pure. (The connector target for
// an undershoot flag — the true nearest cut-contour point, not just the nearest vertex.)
function _nearestPointOnPolygon(p, poly) {
    var best = poly[0], bd = 1e15, i, j, q, dx, dy, d;
    for (i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        q = _nearestPointOnSegment(p, poly[j], poly[i]);
        dx = q.x - p.x; dy = q.y - p.y; d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = q; }
    }
    return best;
}

// Min distance from p to the polygon's edges (closed ring); pure.
function _distPointToPolygon(p, poly) {
    var best = 1e15, i, j, d;
    for (i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        d = _distPointToSegment(p, poly[j], poly[i]);
        if (d < best) best = d;
    }
    return best;
}

// True if a half-cut endpoint fails to reach the cut contour: non-finite, or inside the
// contour by >= minGap. The single undershoot definition shared by the export gate
// (validateHalfcut) and the Layout QA overlay (_qaHalfcutUndershoot).
function _isEndpointShort(p, cutPoly, minGap) {
    if (!p || !isFinite(p.x) || !isFinite(p.y)) return true;
    return pointInPolygon(p, cutPoly) && _distPointToPolygon(p, cutPoly) >= minGap;
}

// Do BOTH endpoints of a half-cut reach the element's cut contour? endPts = the two
// end anchors [{x,y},{x,y}]; cutPoly = the largest sampled polygon of the cut contour;
// minGapPt = max tolerated shortfall (mmToPoints(1)). An end CONNECTS when it is on/outside
// the contour OR inside it by < minGapPt. An end inside by >= minGapPt is a short end
// (undershoot). < 2 finite endpoints → undershoot. Pure — unit-tested with plain arrays.
function _halfcutEndsReachCut(endPts, cutPoly, minGapPt) {
    if (!endPts || endPts.length < 2 || !cutPoly || cutPoly.length < 3) {
        return { ok: false, reason: "undershoot" };
    }
    var i;
    for (i = 0; i < endPts.length; i++) {
        if (_isEndpointShort(endPts[i], cutPoly, minGapPt)) return { ok: false, reason: "undershoot" };
    }
    return { ok: true, reason: null };
}

// Largest sampled polygon of a Cutlines group's cut contour (the member named group.name).
// samplePathToPolygons already recurses a Pathfinder-Unite wrapper GroupItem, so no manual
// drill is needed. null if the cut member is missing or samples empty.
function _halfcutCutPolyForGroup(group, steps) {
    var cut = findGroupMember(group, "");
    if (!cut) return null;
    return _largestPoly(samplePathToPolygons(cut, steps));
}

// Verify (never derive) one element's half-cut. Returns { ok, reason, hc, cutPoly }:
//   reason "missing"    — no "{group.name} halfcut" path on the Halfcut layer.
//   reason "undershoot" — an endpoint falls short of the element's cut line by >= 1mm.
//   reason null         — a valid half-cut exists and both ends reach the cut line.
// hc/cutPoly are the resolved half-cut path + sampled cut polygon (either may be null); the
// Layout QA drawer reuses them so it never re-fetches. The layer lookup is READ-ONLY (never
// creates a layer), so calling this from the advisory Layout QA pass mutates nothing.
function validateHalfcut(doc, group) {
    var steps = CONFIG.halfcutSeamSteps || 16;
    var hcLayer = _findHalfcutLayer(doc);
    var hc = hcLayer ? _findHalfcutPathItem(hcLayer, group.name + " halfcut") : null;
    if (!hc) return { ok: false, reason: "missing", hc: null, cutPoly: null };

    var cutPoly = _halfcutCutPolyForGroup(group, steps);
    if (!cutPoly) {
        // Fail OPEN (don't false-block a valid element) but leave a breadcrumb — a genuinely
        // broken cut member would otherwise pass the hard gate with no trace.
        log("[halfcut] WARN | " + group.name + " | cut contour unsampleable — half-cut not verified");
        return { ok: true, reason: null, hc: hc, cutPoly: null };
    }

    var pts = hc.pathPoints, ends = [];
    if (pts && pts.length >= 2) {
        ends.push({ x: pts[0].anchor[0], y: pts[0].anchor[1] });
        ends.push({ x: pts[pts.length - 1].anchor[0], y: pts[pts.length - 1].anchor[1] });
    }
    var r = _halfcutEndsReachCut(ends, cutPoly, mmToPoints(1));
    return { ok: r.ok, reason: r.reason, hc: hc, cutPoly: cutPoly };
}

// Returns all top-level GroupItems in the Cutlines layer whose note identifies
// them as GC or WC (the elements that have a caption plate seam). Shared by
// Step9A_Halfcut's runHalfcut (export gate) and StepQA_Halfcut (Layout QA).
function _collectHalfcutItems(cutlinesLayer) {
    var out = [], i, item, note;
    for (i = 0; i < cutlinesLayer.pageItems.length; i++) {
        item = cutlinesLayer.pageItems[i];
        if (item.parent !== cutlinesLayer) continue;
        if (item.typename !== "GroupItem") continue;
        note = parseNote(item.note);
        var isCapStyle = note && (note.styleCode === "GC" || note.styleCode === "WC");
        var isTab = note && note.styleCode === "ST" && findGroupMember(item, " plate") !== null;
        if (isCapStyle || isTab) {
            out.push({ name: item.name, group: item });
        }
    }
    return out;
}

// ─── SPACING BUFFER (live 2mm keep-out halo; Step 7B birth + Step 8b refresh) ─────
// A drag-time visual aid for the 2mm minimum-spacing rule. Each GC/WC/stamp cutline gets a
// translucent "keep-out" halo offset OUTWARD by HALF the min spacing — so two pieces'
// halos meeting == exactly the min gap, and OVERLAPPING halos == under spec.
//
// WHERE THEY LIVE: all halos sit in ONE dedicated TOP-LEVEL layer, "Spacing Buffer" (see
// spacingBufferLayerName), positioned directly ABOVE the Cutlines layer (→ between Cutlines and
// Halfcut in the working stack) — NOT as children of the cutline groups, and NOT a sublayer of
// Cutlines. This gives the artist a single Layers-panel eyeball to hide/show every halo at once
// while hand-nesting (the original ask). A top-level layer (vs a Cutlines sublayer) also keeps the
// halos naturally OUT of the QA collectors, which scope into the Cutlines layer only — so Step 8c /
// StepQA never see a halo and need no skip guard. The layer is kept UNLOCKED + visible so a
// marquee/shift-click over a piece still grabs
// its halo — Illustrator selection is CROSS-LAYER, so the halo rides the artist's manual
// drag/scale exactly like the art (in the Sticker layer) does, even though it is not a group
// child. Locking the layer would drop the halos from that selection, so it stays unlocked; the
// artist toggles VISIBILITY only.
//
// Drawn with a MULTIPLY blend so two overlapping halos visibly DARKEN in the danger band —
// Illustrator has no live collision test, so the darkening IS the signal. The authoritative
// spacing pass stays Step 8c / AI_LayoutQA (the red flags); this is only an early warning.
//
// WHY a LIVE Offset Path effect (not a baked outline): the +half-spacing is an EFFECT
// parameter, so with "Scale Strokes & Effects" OFF the halo stays a true 1mm even after the
// artist resizes the piece (the 2mm rule is absolute, not relative to piece size). A baked
// ring would scale with the art and drift off-spec. syncSpacingBuffer sets that preference
// off defensively on every call.
//
// Idempotent: clears this element's prior "{name} buffer" from the layer first (re-run loops:
// Step 7B on re-import, Step 8b repeatedly). GC/WC captioned groups AND bare stamp cutlines (a
// traced PathItem/CompoundPathItem directly on Cutlines) get a halo; uncaptioned PlacedItem
// stamps and other types skip. removeAllSpacingBuffers drops the whole layer before export
// (AI_ExportFinal + Step 10 + Step 11).

// The name of the dedicated top-level layer that holds every spacing-buffer halo.
// Single source of truth. Overridable via CONFIG.spacingBufferLayerName; defaults to
// "Spacing Buffer".
function spacingBufferLayerName() {
    return (CONFIG.spacingBufferLayerName != null) ? CONFIG.spacingBufferLayerName : "Spacing Buffer";
}

// Find (create optional) the top-level "Spacing Buffer" layer. On creation it is positioned
// directly ABOVE the Cutlines layer (→ between Cutlines and Halfcut in the working stack), so the
// translucent band renders under the halfcut lines + the Margin overlay rather than on top of
// everything. Always returns it UNLOCKED (so we can add/remove halos and the artist's marquee can
// grab them); visibility + position are set only when the layer is CREATED — so a same-doc re-run
// that finds the existing layer (Step 8b / AI_LayoutQA) preserves the artist's manual hide/reorder.
// (A full Step 7B re-import first calls removeAllSpacingBuffers, which deletes the layer, so that
// path does rebuild it fresh — visible and back above Cutlines.) Returns null only when
// create=false and the layer is absent; when create=true it always returns the layer it adds.
function _getSpacingBufferLayer(doc, create) {
    var want = spacingBufferLayerName(), i, ly;
    for (i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i].name === want) {
            ly = doc.layers[i];
            try { ly.locked = false; } catch (eLk) {}   // ensure writable; artist toggles visibility only
            return ly;
        }
    }
    if (!create) return null;
    ly = doc.layers.add();               // new layer lands at the top of the stack…
    ly.name = want;
    // …then move it directly above Cutlines (PLACEBEFORE = higher in the stack). Cutlines always
    // exists by the time a halo is built; if it somehow doesn't, leave the layer at the top.
    var cutLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (cutLayer) { try { ly.move(cutLayer, ElementPlacement.PLACEBEFORE); } catch (eMv) {} }
    try { ly.locked = false; } catch (eLk2) {}
    try { ly.visible = true; } catch (eVis) {}
    return ly;
}

// Removes any "{name} buffer" halo(s) from the given buffer layer. Snapshots refs first —
// the live pageItems collection re-indexes on remove. Returns count. No-op on a null layer.
function _removeNamedBuffer(bufLayer, name) {
    if (!bufLayer) return 0;
    var want = name + " buffer";
    var doomed = [], i;
    for (i = 0; i < bufLayer.pageItems.length; i++) {
        if (bufLayer.pageItems[i].name === want) doomed.push(bufLayer.pageItems[i]);
    }
    for (i = 0; i < doomed.length; i++) { try { doomed[i].remove(); } catch (e) {} }
    return doomed.length;
}

// Half of the SPACING-BUFFER BASIS, in mm (the per-piece share of the drag-time keep-out band).
// Reads CONFIG.spacingBufferBasisMm — DELIBERATELY SEPARATE from the QA hard-error gate
// (CONFIG.spacingThresholdMm): the artist wants the visual band to keep aiming at the aspirational
// 2mm target while the export gate tolerates down to 1.9mm. So two pieces' bands meeting still
// reads as "2mm", but a gap between 1.9 and 2.0 (bands slightly overlapping/darkening) no longer
// hard-fails. Defaults to 2mm / 2.
function _spacingBufferOffsetMm() {
    var basisMm = (CONFIG.spacingBufferBasisMm != null) ? CONFIG.spacingBufferBasisMm : 2;
    return basisMm / 2;
}

// The halo fill colour — a vivid magenta/violet, the COMPLEMENT of the green Color Block
// background so it reads strongly there (a cyan/teal just muddies into the green under
// Multiply). The slight cyan component pushes it toward violet so it's clearly NOT the pure
// red of the spacing flags / amber of the margin overhang on the Layout QA layer.
function _spacingBufferRgb() {
    var c = new RGBColor();
    c.red = 179; c.green = 26; c.blue = 255;   // violet-magenta; was CMYK 30/90/0/0
    return c;
}

// (Re)builds ONE element's spacing-buffer band from its CURRENT cutline, into the shared top-level
// "Spacing Buffer" layer. Idempotent. Accepts EITHER a captioned GroupItem (GC/WC/ST note;
// cutline resolved via findGroupMember) OR a bare stamp cutline directly on the Cutlines layer
// (a traced PathItem/CompoundPathItem — the item IS its own cutline). Other types (e.g. a
// PlacedItem stamp) skip. Returns { ok, reason }.
function syncSpacingBuffer(doc, item, opts) {
    opts = opts || {};
    if (!item) return { ok: false, reason: "no item" };

    var cutline, name;
    if (item.typename === "GroupItem") {
        var note = parseNote(item.note);
        if (!note || (note.styleCode !== "GC" && note.styleCode !== "WC" && note.styleCode !== "ST")) {
            return { ok: false, reason: "not GC/WC/ST" };
        }
        cutline = findGroupMember(item, "");
        if (!cutline) return { ok: false, reason: "cutline not found in group" };
        name = item.name;
    } else if (item.typename === "PathItem" || item.typename === "CompoundPathItem") {
        // Bare stamp cutline sitting directly on the Cutlines layer (no group, no plate).
        if (!item.name) return { ok: false, reason: "unnamed bare path (no buffer)" };
        cutline = item;
        name = item.name;
    } else {
        return { ok: false, reason: "unsupported type " + item.typename + " (no buffer)" };
    }

    // _getSpacingBufferLayer(create=true) always returns the layer it creates — never null.
    var bufLayer = _getSpacingBufferLayer(doc, true);
    _removeNamedBuffer(bufLayer, name);

    // Keep the halo a true fixed offset under manual resize: the +offset is a live-effect
    // parameter, so it only stays constant when effects are NOT scaled with the art.
    try { app.preferences.setBooleanPreference("scaleLineWidth", false); } catch (ePref) {}

    // Duplicate the cutline INTO the buffer layer at its absolute position.
    var dup = cutline.duplicate(bufLayer, ElementPlacement.PLACEATBEGINNING);
    dup.name = name + " buffer";
    try { dup.note = ""; } catch (eNote) {}   // never let a QA collector treat the halo as a cutline

    // Render the keep-out as a thin BAND just outside the cut, NOT a filled shape — a fill tinted
    // the whole sticker (the art showed through pink). H = the per-piece keep-out (half the min
    // spacing). Offsetting the path +H/2 and stroking it H wide (centred, fill cleared) lays a band
    // from the cut line out to +H: the art INTERIOR is never covered, so its true colours show, and
    // two pieces' bands still meet at the 2mm gap + overlap-darken when closer. scaleLineWidth off
    // (set above) keeps BOTH the offset and the stroke a true physical size under resize.
    var H = _spacingBufferOffsetMm();
    strokeRecursive(dup, mmToPoints(H), _spacingBufferRgb());   // stroked band; clears fill

    var ofstPt = mmToPoints(H / 2);
    var xml = '<LiveEffect name="Adobe Offset Path"><Dict data="R mlim 4 R ofst '
        + ofstPt + ' I jntp 1 "/></LiveEffect>';
    try {
        dup.applyEffect(xml);
    } catch (eFx) {
        try { dup.remove(); } catch (e2) {}
        return { ok: false, reason: "Offset Path effect rejected (" + eFx.message + ")" };
    }

    try { dup.blendingMode = BlendModes.MULTIPLY; } catch (eBm) {}
    var op = (CONFIG.spacingBufferOpacity != null) ? CONFIG.spacingBufferOpacity : 60;
    try { dup.opacity = op; } catch (eOp) {}

    log("[buffer] " + name + " | band 0..+" + H + "mm");
    return { ok: true };
}

// Strips every spacing-buffer halo before export (Step 10 clips/exports, Step 11 ships —
// neither may see the working-phase halo). LOCATION-AGNOSTIC by contract ("no halo ever reaches
// print"): (a) removes the whole top-level "Spacing Buffer" layer (the current home), AND (b)
// sweeps any stray "{name} buffer" child still sitting inside a cutline group — a doc authored
// before the 2026-07-15 move (an artist's in-flight working file) keeps its halos as group
// children, and those must be stripped too. Idempotent. Returns the total number of halos removed.
function removeAllSpacingBuffers(doc) {
    var removed = 0, i;

    // (a) Current structure — the dedicated top-level layer.
    var bufLayer = _getSpacingBufferLayer(doc, false);
    if (bufLayer) {
        removed += bufLayer.pageItems.length;
        try { bufLayer.locked = false; } catch (eLk) {}
        try {
            bufLayer.remove();
        } catch (eRm) {
            // Fallback: if the layer can't be removed, empty it (snapshot refs — live re-index).
            var items = [];
            try {
                for (i = 0; i < bufLayer.pageItems.length; i++) items.push(bufLayer.pageItems[i]);
                for (i = 0; i < items.length; i++) { try { items[i].remove(); } catch (e2) {} }
            } catch (e3) {}
        }
    }

    // (b) Legacy / belt-and-suspenders — a "{group.name} buffer" child left inside a cutline group.
    var cutLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (cutLayer) {
        var gi, g, j, want, doomed;
        for (gi = 0; gi < cutLayer.groupItems.length; gi++) {
            g = cutLayer.groupItems[gi];
            if (g.parent !== cutLayer) continue;
            want = g.name + " buffer";
            doomed = [];
            for (j = 0; j < g.pageItems.length; j++) {
                if (g.pageItems[j].name === want) doomed.push(g.pageItems[j]);
            }
            for (j = 0; j < doomed.length; j++) { try { doomed[j].remove(); removed++; } catch (eD) {} }
        }
    }

    if (removed > 0) log("[buffer] stripped " + removed + " spacing buffer(s) before export.");
    return removed;
}

// Rounds to 0.1 for compact log coordinates.
function _r1(x) { return Math.round(x * 10) / 10; }

// True if the polyline bows off the chord between its endpoints by more than tol (points) —
// a flat seat traces a near-straight run, an arc/tilted seat or a cap wrap bows away. Used
// only for the log label (straight vs curved); not load-bearing.
function _seamCurved(pts, tol) {
    var n = pts.length;
    if (n < 3) return false;
    var ax = pts[0].x, ay = pts[0].y;
    var dx = pts[n - 1].x - ax, dy = pts[n - 1].y - ay;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) return false;
    var ux = dx / len, uy = dy / len, i, px, py, perp;
    for (i = 1; i < n - 1; i++) {
        px = pts[i].x - ax; py = pts[i].y - ay;
        perp = px * (-uy) + py * ux;
        if (perp < 0) perp = -perp;
        if (perp > tol) return true;
    }
    return false;
}

// Builds the half-cut seam polyline = the caption plate's INNER (art-facing) EDGE, cap to cap —
// the boundary between the caption and the art. It is DEPTH-INDEPENDENT: derived from the plate
// GEOMETRY (`_innerEdgeVerts(pp, geom, {includeCaps:true})` — PCA long axis + the plate→art
// direction), NOT from how deeply the caption is submerged, so it yields a full caption-width seam
// at any embed depth including 0 (two-point contact: the top edge sits on the art border with
// nothing strictly submerged). The two-point-contact seat guarantees the inner-edge endpoints land
// on the border, so the seam terminates at the two junctions; syncHalfcut's
// _extendHalfcutEndsToCutline ties each end onto the cut contour. Straight for a flat/tilted seat;
// curved only if the plate's spine is genuinely curved. The near-square (kissOnly) case still gets
// a valid geom-based seam — the inner SIDE comes from geom, so only the (noisy) long-axis ordering
// is affected, not correctness.
//
// The unseated-caption hard error now lives solely at the seat (seatPlateToOutline → ok:false, so
// the caption is never built); this seam no longer re-checks submersion on the main path.
//
// Degenerate plate (inner edge unresolvable, < 2 verts) → a straight chord between the two
// farthest plate∩art crossings (submersion computed only for this fallback), or NULL if the plate
// is genuinely not against the art. The caller treats null as a hard error — no flat-cut fallback.
function plateSeamPath(plate, outline, steps, platePolys, artPolys) {
    var s = steps || 16;
    // Pre-sampled polys may be threaded in (syncHalfcut samples the plate once per pass and the
    // outline through the per-pass cache); fall back to sampling here for any direct caller.
    if (!platePolys) platePolys = samplePathToPolygons(plate, s);
    if (!artPolys)   artPolys   = samplePathToPolygons(outline, s);
    if (platePolys.length === 0 || artPolys.length === 0) return null;
    var pp = _largestPoly(platePolys);
    if (!pp) return null;
    var n = pp.length;
    if (n < 4) return null;

    var geom = _aiSeatGeometry(plate, outline);

    // The half-cut runs along the caption's INNER (art-facing) LONG edge — the boundary between the
    // caption and the art. It is derived from the plate GEOMETRY (PCA long axis + the plate→art
    // direction), NOT from how deeply the caption is submerged, so it yields a seam at ANY embed
    // depth including 0 (two-point contact: the top edge sits on the art border with nothing
    // strictly submerged; the OLD submersion-gated seam collapsed to zero there).
    //
    // The seam deliberately EXCLUDES the rounded cap arcs (default `_innerEdgeVerts`, no
    // includeCaps): it must end near the two junctions so syncHalfcut's overshoot anchors THERE and
    // runs the 1mm tail along the ART cut line. A seam that ran down the cap arcs would end deep on
    // the caption, so the overshoot anchors on the caption's own edge and the tail runs the wrong
    // way (every element then hits _pickTailDir's near-tie). The seat lands the inner-edge endpoints
    // on the border just inside the junctions, so the overshoot's nearest-point projection reaches
    // the junction cleanly. The upstream seat is the hard-error gate for a genuinely unseated
    // caption (seatPlateToOutline → ok:false; the caption is never built), so no submersion re-check.
    var ie = _innerEdgeVerts(pp, geom);
    var seam = (ie && !ie.kissOnly) ? _innerEdgeSeam(ie) : null;
    if (seam) return seam;

    // Near-square / very-short caption: the PCA long axis is noise (kissOnly) and the cap band can
    // swallow the whole trimmed inner edge. Retry KEEPING the caps so a legit 1-2 char caption still
    // yields a (short) art-facing seam instead of nulling out → export hard-error (review #1).
    seam = _innerEdgeSeam(_innerEdgeVerts(pp, geom, { includeCaps: true }));
    if (seam) return seam;

    // Truly degenerate plate (inner edge unresolvable) → straight chord between the two farthest
    // plate∩art crossings, if the plate is genuinely seated. Submersion computed only for this fallback.
    var inside = [], k, countIn = 0;
    for (k = 0; k < n; k++) { inside[k] = _pointInPolysEO(pp[k], artPolys); if (inside[k]) countIn++; }
    if (countIn === 0 || countIn === n) return null;
    return _chordFallback(pp, inside, artPolys);
}

// The inner-edge verts from _innerEdgeVerts → a seam polyline [{x,y}, …], or null if < 2 verts.
// (The caller decides whether to accept a kissOnly result.) Pure.
function _innerEdgeSeam(ie) {
    if (!ie || !ie.verts || ie.verts.length < 2) return null;
    var seam = [], i;
    for (i = 0; i < ie.verts.length; i++) seam.push({ x: ie.verts[i].x, y: ie.verts[i].y });
    return seam;
}

// Shape-degeneracy fallback: a straight chord between the two farthest plate∩art crossings.
// Used only when the geometry seam is unresolvable (< 2 inner-edge verts). Returns [P,Q] or null (<2).
function _chordFallback(pp, inside, artPolys) {
    var n = pp.length, crossings = [], i, j, a, b;
    for (i = 0; i < n; i++) {
        j = (i + 1) % n;
        if (inside[i] !== inside[j]) {
            a = inside[i] ? pp[j] : pp[i];
            b = inside[i] ? pp[i] : pp[j];
            crossings.push({ pt: _segCrossArt(a, b, artPolys) });
        }
    }
    if (crossings.length < 2) return null;
    var e = _farthestCrossingPair(crossings);
    return [crossings[e.i].pt, crossings[e.j].pt];
}

// Indices {i,j} of the two crossings that are farthest apart (the seat ends).
function _farthestCrossingPair(crossings) {
    var m = crossings.length, bi = 0, bj = (m > 1 ? 1 : 0), best = -1, i, j, dx, dy, d;
    for (i = 0; i < m; i++) {
        for (j = i + 1; j < m; j++) {
            dx = crossings[i].pt.x - crossings[j].pt.x;
            dy = crossings[i].pt.y - crossings[j].pt.y;
            d = dx * dx + dy * dy;
            if (d > best) { best = d; bi = i; bj = j; }
        }
    }
    return { i: bi, j: bj };
}

// Even-odd point-in-polygons test across a sampled path's subpaths (holes subtract).
function _pointInPolysEO(pt, polys) {
    var inside = false, i;
    for (i = 0; i < polys.length; i++) {
        if (pointInPolygon(pt, polys[i])) inside = !inside;
    }
    return inside;
}

// Largest-bbox-area polygon of a set (the plate capsule is a single sub-poly, but a
// Unite/group can wrap extras — take the dominant one).
function _largestPoly(polys) {
    var best = null, bestA = -1, i, bb, a;
    for (i = 0; i < polys.length; i++) {
        bb = _polyBbox(polys[i]);
        a = (bb.x1 - bb.x0) * (bb.y1 - bb.y0);
        if (a > bestA) { bestA = a; best = polys[i]; }
    }
    return best;
}

// Given a OUTSIDE the art and b INSIDE the art, bisects to the boundary crossing {x,y}.
function _segCrossArt(a, b, artPolys) {
    var lo = a, hi = b, mid, k;
    for (k = 0; k < 24; k++) {
        mid = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2 };
        if (_pointInPolysEO(mid, artPolys)) hi = mid; else lo = mid;
    }
    return { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2 };
}

// Returns `from` moved AWAY from `toward` by dist (extends the seam outward past `from`).
function _extendPoint(from, toward, dist) {
    var dx = from.x - toward.x, dy = from.y - toward.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) return { x: from.x, y: from.y };
    return { x: from.x + dx / len * dist, y: from.y + dy / len * dist };
}

// ─── HALF-CUT ENDPOINT EXTENSION (cut-line-aligned overshoot) ──────────────────
// SELF-CONTAINED unit, called only by syncHalfcut. The half-cut traces the caption seam
// (the plate's inner edge submerged in the art); each end must reach the outer cut line so
// the peel tab separates cleanly. The seam is derived from the plate∩art geometry, which can
// sit slightly off the fused cut line, so we re-project each seam end onto the CURRENT cut
// line and run a 1mm tail ALONG the cut-line contour (not the art
// operand's tangent — that strays off the fused line into the art). The tail therefore
// superimposes on the cut line: invisible unless the cut-line layer is hidden. Keep this
// section together; nothing else depends on these helpers.

// Rebuilds a raw seam polyline so each end lands on the cut line with a 1mm tail running
// along the contour, away from the caption plate. Returns a NEW seam (never mutates the input).
// Falls back to a fixed outward extension when the cut line / plate can't be sampled or the
// rebuilt tail degenerates.
function _extendHalfcutEndsToCutline(seam, cutline, plate, overshootPt, steps, platePolys, artPolys) {
    var L = seam.length;
    if (L < 2) return seam;
    // Straight outward overshoot of both ends, on a COPY (the shared fallback for every path
    // that can't track the contour — keeps this function non-mutating).
    function straightOvershoot() {
        var lg = seam.slice(0);
        lg[0]     = _extendPoint(lg[0],     lg[1],     overshootPt);
        lg[L - 1] = _extendPoint(lg[L - 1], lg[L - 2], overshootPt);
        return lg;
    }
    var cutPoly = cutline ? _largestPoly(samplePathToPolygons(cutline, steps)) : null;
    if (!cutPoly) return straightOvershoot();               // can't sample cut line → legacy
    // Plate outline (legacy tie-breaker) + ART outline (primary discriminator): the tail runs down
    // the cut-line branch that stays ON the art outline; the caption branch peels onto the plate.
    var platePoly = platePolys ? _largestPoly(platePolys)
                  : (plate ? _largestPoly(samplePathToPolygons(plate, steps)) : null);
    if (!platePoly) return straightOvershoot();             // can't sample plate → legacy
    var artPoly = artPolys ? _largestPoly(artPolys) : null;

    var tail0 = _cutlineOvershootTail(seam[0],     seam[1],     cutPoly, platePoly, artPoly, overshootPt); // [P0..end0]
    var tailN = _cutlineOvershootTail(seam[L - 1], seam[L - 2], cutPoly, platePoly, artPoly, overshootPt); // [PN..endN]

    // end0 … P0  +  interior seam  +  PN … endN. The raw ends seam[0]/seam[L-1] are dropped;
    // their on-contour crossings P0/PN take their place (tail*[0]).
    var out = [], i;
    for (i = tail0.length - 1; i >= 0; i--) out.push(tail0[i]);
    for (i = 1; i < L - 1; i++) out.push(seam[i]);
    for (i = 0; i < tailN.length; i++) out.push(tailN[i]);
    if (!_seamFinite(out)) return straightOvershoot();      // cut-line tail degenerated → legacy
    return out;
}

// Caps a polyline to <= maxPts by even stride, always keeping the FIRST and LAST point (the
// peel-tab ends that must meet the cut line). A half-cut needs far fewer points than a dense
// sampling produces, and setEntirePath throws "Illegal Argument" on a very large point count
// (the food-bowl seams at high halfcutSeamSteps hit 1300-1700 pts and were rejected).
function _decimateSeam(pts, maxPts) {
    if (!pts || pts.length <= maxPts) return pts;
    var out = [pts[0]], i, stride = Math.ceil((pts.length - 1) / (maxPts - 1));
    for (i = stride; i < pts.length - 1; i += stride) out.push(pts[i]);
    out.push(pts[pts.length - 1]);
    return out;
}

// True if seam is a usable polyline: >= 2 points, all finite, and with real extent. Guards
// setEntirePath, which throws "Illegal Argument" on < 2 points, a NaN coordinate, OR a
// zero-length (all-coincident) path — the last is what a very shallow seat can collapse the
// submerged span to.
function _seamFinite(seam) {
    if (!seam || seam.length < 2) return false;
    var i, p, minx = 1e15, maxx = -1e15, miny = 1e15, maxy = -1e15;
    for (i = 0; i < seam.length; i++) {
        p = seam[i];
        if (!p || !isFinite(p.x) || !isFinite(p.y)) return false;
        if (p.x < minx) minx = p.x;
        if (p.x > maxx) maxx = p.x;
        if (p.y < miny) miny = p.y;
        if (p.y > maxy) maxy = p.y;
    }
    return (maxx - minx) > 1e-3 || (maxy - miny) > 1e-3;   // reject a zero-extent (coincident) seam
}

// Which way to run the peel-tab tail along the cut contour from junction P (on edge edgeIdx):
// +1 (toward edgeIdx+1) or −1. The junction is the art∩caption crossing; the cut line leaves it
// two ways — along the ART edge (which LIES ON the art outline) or along the caption's exposed
// edge (which peels onto the PLATE outline, away from the art). The tail must run down the ART
// path, so probe `probe` arc length each way and take the branch that stays CLOSER TO THE ART
// OUTLINE, summed over the whole walk.
//
// Why art-distance and not "farther from the plate": near a seated junction the art edge runs
// right alongside the caption, so BOTH branches sit ≈0 from the plate for the first ~1mm — the
// plate metric can't separate them and mis-picks (the caption tail on a small/tilted element,
// e.g. Tram's right end: fwd art=0/plate=0 vs back art=1.3/plate=0 — only art tells them apart).
// The art branch is definitionally ON the art outline (≈0) regardless of element size or tilt, so
// this is robust with no near-tie fallback. Falls back to the legacy plate discriminator only when
// the art outline is unavailable. Pure geometry.
function _pickTailDir(cutPoly, P, edgeIdx, platePoly, artPoly, probe) {
    var fEnd = _walkCutPolyArc(cutPoly, P, edgeIdx,  1, probe);
    var bEnd = _walkCutPolyArc(cutPoly, P, edgeIdx, -1, probe);
    if (artPoly && artPoly.length >= 3) {
        var aF = _sumDist2ToPoly(fEnd, artPoly), aB = _sumDist2ToPoly(bEnd, artPoly);
        return (aF <= aB) ? 1 : -1;                          // stay on the art outline
    }
    // Legacy fallback (no art outline): farther-from-plate, then integrated-distance tie-break.
    var fp = fEnd[fEnd.length - 1], bp = bEnd[bEnd.length - 1];
    var dF = _minDist2ToPolyEdges(fp, platePoly), dB = _minDist2ToPolyEdges(bp, platePoly);
    if (Math.abs(Math.sqrt(dF) - Math.sqrt(dB)) >= mmToPoints(0.5)) return (dF >= dB) ? 1 : -1;
    var sF = _sumDist2ToPoly(fEnd, platePoly), sB = _sumDist2ToPoly(bEnd, platePoly);
    return (sF >= sB) ? 1 : -1;
}

// One seam end → an ordered list of points [P, …, tailEnd] that all lie ON the cut line: P is
// the nearest point on the contour to the seam end (= the art∩caption crossing), then a walk of
// overshootPt arc length along the cut-line polygon down the ART path (the branch that stays on
// the art outline), chosen by _pickTailDir. So the tail tracks the art cut line rather than the
// caption's exposed edge or a straight tangent.
function _cutlineOvershootTail(endPt, innerPt, cutPoly, platePoly, artPoly, overshootPt) {
    // Anchor the tail at the junction by projecting the seam end to the NEAREST point on the cut
    // line — NOT by shooting a ray along the seam tangent. The seam runs along the pill edge, so
    // its tangent is nearly parallel to the cut line at the junction; a ray SKIMS and lands the
    // anchor far away. Nearest-point keeps the anchor at the crossing.
    var Pn = _nearestPointOnPoly(endPt, cutPoly);
    if (!Pn) return [_extendPoint(endPt, innerPt, overshootPt)];       // no contour → fixed
    var P = { x: Pn.x, y: Pn.y };
    var probe = Math.max(overshootPt, mmToPoints(2));
    var dir = _pickTailDir(cutPoly, P, Pn.edge, platePoly, artPoly, probe);
    return _walkCutPolyArc(cutPoly, P, Pn.edge, dir, overshootPt);
}

// Nearest point on a polygon's OUTLINE to pt: { x, y, edge } (edge = index i of segment i..i+1).
function _nearestPointOnPoly(pt, poly) {
    if (!poly || poly.length < 2) return null;
    var bd = 1e15, bx = 0, by = 0, bi = 0, i, n = poly.length, c;
    for (i = 0; i < n; i++) {
        c = _ptSegClosestSq(pt, poly[i], poly[(i + 1) % n]);
        if (c.dist2 < bd) { bd = c.dist2; bx = c.qx; by = c.qy; bi = i; }
    }
    return { x: bx, y: by, edge: bi };
}

// Minimum squared distance from a point to a polygon's OUTLINE (its edges, not its interior).
function _minDist2ToPolyEdges(pt, poly) {
    if (!poly || poly.length < 2) return 0;
    var best = 1e15, i, n = poly.length, c;
    for (i = 0; i < n; i++) {
        c = _ptSegClosestSq(pt, poly[i], poly[(i + 1) % n]);
        if (c.dist2 < best) best = c.dist2;
    }
    return best;
}

// Sum of squared distances from each point of a walk to a polygon's OUTLINE. The tie-break signal
// for the overshoot direction (_pickTailDir): a contour walk that hugs the plate edge sums ~0; one
// that peels into the body sums large. Pure geometry.
function _sumDist2ToPoly(pts, poly) {
    var s = 0, i;
    for (i = 0; i < pts.length; i++) s += _minDist2ToPolyEdges(pts[i], poly);
    return s;
}

// Walks the cut-line polygon from P (on edge edgeIdx) by `dist` arc length in stepDir
// (+1 toward edgeIdx+1, −1 toward edgeIdx). Returns [P, intermediate verts…, finalPt],
// all on the contour, with the final point interpolated to land exactly `dist` away.
function _walkCutPolyArc(cutPoly, P, edgeIdx, stepDir, dist) {
    var n = cutPoly.length, out = [{ x: P.x, y: P.y }], acc = 0;
    var cur = { x: P.x, y: P.y };
    var idx = (stepDir > 0) ? (edgeIdx + 1) % n : edgeIdx;
    var guard = 0, v, sx, sy, slen, f;
    while (acc < dist && guard < n + 1) {
        v = cutPoly[idx];
        sx = v.x - cur.x; sy = v.y - cur.y; slen = Math.sqrt(sx * sx + sy * sy);
        if (slen < 1e-9) { idx = (stepDir > 0) ? (idx + 1) % n : (idx - 1 + n) % n; guard++; continue; }
        if (acc + slen >= dist) {
            f = (dist - acc) / slen;
            out.push({ x: cur.x + sx * f, y: cur.y + sy * f });
            return out;
        }
        out.push({ x: v.x, y: v.y });
        acc += slen; cur = { x: v.x, y: v.y };
        idx = (stepDir > 0) ? (idx + 1) % n : (idx - 1 + n) % n; guard++;
    }
    // Degenerate (ran the whole ring without reaching dist) → straight-extend the last edge.
    if (acc < dist && out.length >= 2) {
        var a = out[out.length - 2], bpt = out[out.length - 1];
        var ex = bpt.x - a.x, ey = bpt.y - a.y, el = Math.sqrt(ex * ex + ey * ey);
        if (el > 1e-9) { var r = dist - acc; out.push({ x: bpt.x + ex / el * r, y: bpt.y + ey / el * r }); }
    }
    return out;
}

// ─── PURE GEOMETRY (Step 8c QA) ───────────────────────────────────────────────
// Point-space helpers (document points, AI y-up). NOTE: StepQA_NestingQuality.jsx
// keeps its own private _qa_ sampling helpers in sheet-relative mm for the
// occupancy grid; these are general point-space versions, kept separate to avoid
// refactoring that working step. Deterministic and unit-testable.

// Cubic bezier point at parameter t. p0..p3 are [x, y] anchor/handle arrays.
function _bezierPoint(p0, p1, p2, p3, t) {
    var mt  = 1 - t;
    var q0x = mt * p0[0] + t * p1[0], q0y = mt * p0[1] + t * p1[1];
    var q1x = mt * p1[0] + t * p2[0], q1y = mt * p1[1] + t * p2[1];
    var q2x = mt * p2[0] + t * p3[0], q2y = mt * p2[1] + t * p3[1];
    var r0x = mt * q0x   + t * q1x,   r0y = mt * q0y   + t * q1y;
    var r1x = mt * q1x   + t * q2x,   r1y = mt * q1y   + t * q2y;
    return { x: mt * r0x + t * r1x, y: mt * r0y + t * r1y };
}

// Samples one PathItem's bezier segments into a closed polyline of {x, y}.
function _sampleSubPath(subPath, stepsPerSeg) {
    var pts = subPath.pathPoints;
    if (!pts || pts.length < 2) return [];

    var n = pts.length;

    // Snapshot the DOM PathPoints ONCE. Each .anchor/.leftDirection/.rightDirection
    // read crosses the ExtendScript↔host bridge — the dominant cost here — and the
    // old loop read pts[i] both as the current point and (next iteration) as the
    // previous point's neighbour, doubling the crossings. Reading each point once
    // into plain JS arrays yields identical sample coordinates, just faster.
    var A = [], L = [], R = [];
    var k, pp;
    for (k = 0; k < n; k++) {
        pp = pts[k];
        A[k] = pp.anchor;
        L[k] = pp.leftDirection;
        R[k] = pp.rightDirection;
    }

    var poly = [];
    var limit = subPath.closed ? n : n - 1;
    var i, j, t, next;

    for (i = 0; i < limit; i++) {
        next = (i + 1) % n;
        var p0 = A[i];
        var p1 = R[i];
        var p2 = L[next];
        var p3 = A[next];
        for (j = 0; j < stepsPerSeg; j++) {
            t = j / stepsPerSeg;
            poly.push(_bezierPoint(p0, p1, p2, p3, t));
        }
    }
    return poly;
}

// Selects the fused-cut leaf indices that are caption-junction slivers to delete. A fused leaf is
// REAL (keep) when it echoes a KEEP-reference — a subpath of the art-alone `outline` (a genuine
// art hole, left untouched by the plate Unite: same centroid, same area) OR the caption `plate`
// (the pill, which a shallow seat can leave as its own leaf). A non-largest fused leaf that
// echoes NEITHER was invented by the union at the pill∩art seam = a crumb (delete). The largest
// fused leaf (the real sticker contour) is never a candidate.
// fusedLeaves / keepRefs = [{ c:{x,y}, area:Number }, ...]. Pure; node-testable.
function _junctionSliverLeaves(fusedLeaves, keepRefs) {
    var doomed = [];
    if (!fusedLeaves || fusedLeaves.length < 2) return doomed;
    var maxI = 0, i;
    for (i = 1; i < fusedLeaves.length; i++) {
        if (fusedLeaves[i].area > fusedLeaves[maxI].area) maxI = i;
    }
    for (i = 0; i < fusedLeaves.length; i++) {
        if (i === maxI) continue;                               // never the real contour
        if (!_matchesAKeepRef(fusedLeaves[i], keepRefs)) doomed.push(i);
    }
    return doomed;
}

// True when fused leaf f echoes some keep-reference (an outline subpath or the caption plate):
// centroids within 10pt AND areas within +/-25%. Wide margins by design — real echoes coincide
// (dist~0, ratio~1.0) while crumbs miss (dist>=20pt, ratio<=0.007) on the live SKU, so nothing
// lands between the two clusters.
// Uses the SHARED _bboxEcho predicate — see the PLATE-ECHO note above. This must stay the exact
// complement of _captionLeafDetached: what this KEEPS is what phase 2 FLAGS.
function _matchesAKeepRef(f, keepRefs) {
    if (!keepRefs) return false;
    var i;
    for (i = 0; i < keepRefs.length; i++) {
        if (_bboxEcho(f, keepRefs[i])) return true;
    }
    return false;
}

// Samples a PathItem/CompoundPathItem/GroupItem into an array of closed polygons
// (each [{x, y}, …] in document points). stepsPerSeg controls precision.
function samplePathToPolygons(item, stepsPerSeg) {
    var polys = [];
    var i, sub;

    if (item.typename === "PathItem") {
        sub = _sampleSubPath(item, stepsPerSeg);
        if (sub.length >= 3) polys.push(sub);

    } else if (item.typename === "CompoundPathItem") {
        for (i = 0; i < item.pathItems.length; i++) {
            sub = _sampleSubPath(item.pathItems[i], stepsPerSeg);
            if (sub.length >= 3) polys.push(sub);
        }

    } else if (item.typename === "GroupItem") {
        // Pathfinder/offset results are sometimes wrapped in a group.
        for (i = 0; i < item.pathItems.length; i++) {
            sub = _sampleSubPath(item.pathItems[i], stepsPerSeg);
            if (sub.length >= 3) polys.push(sub);
        }
        for (i = 0; i < item.compoundPathItems.length; i++) {
            var cp = samplePathToPolygons(item.compoundPathItems[i], stepsPerSeg);
            for (var k = 0; k < cp.length; k++) polys.push(cp[k]);
        }
        for (i = 0; i < item.groupItems.length; i++) {
            var gp = samplePathToPolygons(item.groupItems[i], stepsPerSeg);
            for (var m = 0; m < gp.length; m++) polys.push(gp[m]);
        }
    }
    return polys;
}

// Per-pass polygon cache around samplePathToPolygons — the dominant DOM cost in ExtendScript
// (it walks every bezier segment stepsPerSeg times). Within ONE per-element pipeline pass the
// seat and the half-cut sample the same traced paths repeatedly; threading a small cache object
// (created by the caller, e.g. Step 6 / Step 8b) lets each (path, step-count) be sampled once.
//
// Keyed by slot AND step count, so the seat's denser sample (CONFIG.seatSampleSteps) and the
// half-cut's coarser one (CONFIG.halfcutSeamSteps) never alias: a cached result is reused ONLY
// when the requested density matches, so it is always geometrically identical to a fresh sample
// (the optimisation can never change output). With the default config the counts differ, so the
// outline is still sampled once per density; if they are ever unified the reuse kicks in for free.
//
// cache may be null/undefined (then this is a plain sample). The returned polys are treated as
// read-only by every consumer, so sharing the reference is safe. CAUTION: never cache a path the
// same pass then MUTATES under a step count a later reader will request — the seat sidesteps this
// by caching only the never-mutated outline (it re-rotates/translates the plate, which is why the
// plate is sampled fresh after seating rather than served from this cache).
function _sampleCached(cache, slot, item, steps) {
    if (!cache) return samplePathToPolygons(item, steps);
    var key = slot + "|" + steps;
    if (cache[key]) return cache[key];
    var polys = samplePathToPolygons(item, steps);
    cache[key] = polys;
    return polys;
}

// Points → millimetres (inverse of mmToPoints). 1pt = 25.4/72 mm.
function pointsToMm(pt) { return pt * (25.4 / 72); }

// Smallest angle between two directions treated as UNORIENTED lines (a straight edge may be
// sampled in either direction). Returns 0..π/2.
function _angDiff180(a, b) {
    var d = Math.abs(a - b) % Math.PI;       // 0..π
    if (d > Math.PI / 2) d = Math.PI - d;     // fold to 0..π/2
    return d;
}

// Simple vertex-average centroid (good enough to decide which side is "outward").
function _polyCentroid(poly) {
    var sx = 0, sy = 0, i;
    for (i = 0; i < poly.length; i++) { sx += poly[i].x; sy += poly[i].y; }
    return { x: sx / poly.length, y: sy / poly.length };
}

// Cosine of the angle between an edge's outward normal (unit ux,uy) and the radial line from the
// polygon centroid (cx,cy) through the edge midpoint (mx,my). 1 = the edge is perpendicular to that
// radial line, so the tab points straight AWAY from the piece; ~0 = the edge faces sideways (it
// runs roughly radially, e.g. a petal). Returns a value in [-1,1] (outward is chosen away from the
// centroid, so it is ≥0 in practice). Pure geometry.
function _edgeRadialAlign(mx, my, ux, uy, cx, cy) {
    var rx = mx - cx, ry = my - cy;
    var rl = Math.sqrt(rx * rx + ry * ry);
    if (rl === 0) return 1;
    return (ux * rx + uy * ry) / rl;
}

// Chooses the longest near-straight run of the outline perimeter and returns the tab seat:
//   { ok, midX, midY, dirAngle, outwardAngle, lengthMm }
// dirAngle  = direction of the chord (radians, y-up).
// outwardAngle = perpendicular to dirAngle pointing AWAY from the polygon centroid (the tab body
//   points this way).
// lengthMm = straight chord length of the run (what must clear the PEEL HERE tab width).
// A "run" accumulates consecutive perimeter edges whose direction stays within
// straightToleranceDeg of the run's anchor direction (unoriented), so diagonal/vertical edges
// qualify — generalises the old horizontal-only _findLongestHorizontalSeg.
function pickTabEdge(outline, opts) {
    opts = opts || {};
    var steps = (opts.steps != null) ? opts.steps : (CONFIG.peelTabEdgeSampleSteps || 12);
    var tolRad = ((opts.straightToleranceDeg != null) ? opts.straightToleranceDeg
                 : (CONFIG.peelTabEdgeStraightToleranceDeg != null ? CONFIG.peelTabEdgeStraightToleranceDeg : 8))
                 * Math.PI / 180;

    var poly = _largestPoly(samplePathToPolygons(outline, steps));
    if (!poly || poly.length < 3) return { ok: false, reason: "degenerate outline polygon" };

    var n = poly.length;
    var c = _polyCentroid(poly);
    var best = null;   // highest score = the longest run that also faces radially OUTWARD
    var i, j;

    // Try each vertex as a run start; extend while edges stay within tolerance of the anchor dir.
    // Score each run by length × radial alignment, so the chosen edge is long AND roughly
    // perpendicular to the centroid→edge line — the tab then points straight "away" from the piece
    // (a long edge that faces sideways, e.g. a petal pointing radially outward, is down-weighted).
    for (i = 0; i < n; i++) {
        var ax = poly[i].x, ay = poly[i].y;
        var bx = poly[(i + 1) % n].x, by = poly[(i + 1) % n].y;
        var anchor = Math.atan2(by - ay, bx - ax);
        var endIdx = (i + 1) % n;
        for (j = i + 1; j < i + n; j++) {
            var c0 = poly[j % n], c1 = poly[(j + 1) % n];
            var ed = Math.atan2(c1.y - c0.y, c1.x - c0.x);
            if (_angDiff180(ed, anchor) > tolRad) break;
            endIdx = (j + 1) % n;
        }
        var ex = poly[endIdx].x, ey = poly[endIdx].y;
        var dx = ex - ax, dy = ey - ay;
        var lenPt = Math.sqrt(dx * dx + dy * dy);   // straight chord span of the run
        if (lenPt <= 0) continue;

        var mX = (ax + ex) / 2, mY = (ay + ey) / 2;
        var dir = Math.atan2(ey - ay, ex - ax);
        // outward normal = perpendicular to the chord, pointing away from the centroid.
        var cand1 = dir + Math.PI / 2, cand2 = dir - Math.PI / 2;
        var u1x = Math.cos(cand1), u1y = Math.sin(cand1);
        var outA = ((u1x * (mX - c.x) + u1y * (mY - c.y)) >= 0) ? cand1 : cand2;
        var align = _edgeRadialAlign(mX, mY, Math.cos(outA), Math.sin(outA), c.x, c.y);
        var score = lenPt * (align > 0 ? align : 0);
        if (!best || score > best.score) {
            best = { lenPt: lenPt, midX: mX, midY: mY, dirAngle: dir, outwardAngle: outA, score: score };
        }
    }
    if (!best) return { ok: false, reason: "no straight edge found" };

    return { ok: true, midX: best.midX, midY: best.midY, dirAngle: best.dirAngle,
             outwardAngle: best.outwardAngle, lengthMm: pointsToMm(best.lenPt) };
}

// Classifies an asset's two paths: the CUTLINE is stroked & unfilled, the FILL is filled &
// (typically) unstroked. Returns { cutline, fill } or null when it cannot tell them apart
// (caller treats null as a hard error naming the element — no silent guess).
function _tabAssetItems(items) {
    if (!items || items.length !== 2) return null;
    // The cutline is a stroked, unfilled PATH (PathItem/CompoundPathItem). The fill is simply the
    // OTHER item — in the real assets a GroupItem named "Sign" (a coloured fill, plus the "PEEL
    // HERE" lettering for tab B), which only rides along and never enters the cut. Require exactly
    // one cutline so two paths / two groups stay ambiguous (a hard error naming the asset).
    function isCut(it) {
        return (it.typename === "PathItem" || it.typename === "CompoundPathItem") && it.stroked && !it.filled;
    }
    var a = items[0], b = items[1];
    var ca = isCut(a), cb = isCut(b);
    if (ca && !cb) return { cutline: a, fill: b };
    if (cb && !ca) return { cutline: b, fill: a };
    return null;
}

// Opens the asset file (reusing it if already open), copies its two paths into `layer` as a
// group named "{displayName} tab", then rotates the group to edge.dirAngle and translates it so
// the group's inner edge sits on the chosen art edge midpoint with the body pointing outward.
// Returns { ok, group, cutline, fill } or { ok:false, reason }.
function placeTabAsset(doc, layer, assetFile, edge, displayName) {
    if (!assetFile || !assetFile.exists) return { ok: false, reason: "tab asset not found: " + (assetFile ? assetFile.fsName : "(null)") };

    var assetDoc = null, i;
    for (i = 0; i < app.documents.length; i++) {
        try { if (app.documents[i].fullName.fsName === assetFile.fsName) { assetDoc = app.documents[i]; break; } }
        catch (e2) {}
    }
    if (!assetDoc) assetDoc = app.open(assetFile);

    // Collect the asset's two top-level items (single "Layer 1"): the stroked cutline PATH and the
    // "Sign" GROUP fill. Include GroupItem — the fill is authored as a group, not a bare path.
    var assetItems = [];
    var al = assetDoc.layers[0];
    for (i = 0; i < al.pageItems.length; i++) {
        var t = al.pageItems[i].typename;
        if (t === "PathItem" || t === "CompoundPathItem" || t === "GroupItem") assetItems.push(al.pageItems[i]);
    }
    var cls = _tabAssetItems(assetItems);
    if (!cls) { try { app.activeDocument = doc; } catch (eA) {} return { ok: false, reason: "tab asset has ambiguous cutline/fill: " + assetFile.name }; }

    // Copy both into the working doc inside a fresh group (DOM duplicate across docs is unreliable
    // for live styles; copy/paste preserves appearance).
    app.activeDocument = assetDoc;
    app.selection = null;
    cls.cutline.selected = true; cls.fill.selected = true;
    app.executeMenuCommand("copy");
    app.activeDocument = doc;
    app.executeMenuCommand("paste");
    var pasted = app.selection;

    // Helper to drop pasted items on error paths (prevent float leak).
    function _dropPasted(arr) { var z; for (z = 0; arr && z < arr.length; z++) { try { arr[z].remove(); } catch (eD) {} } }

    if (!pasted || pasted.length !== 2) { _dropPasted(pasted); return { ok: false, reason: "tab paste returned " + (pasted ? pasted.length : 0) + " items" }; }

    var group = layer.groupItems.add();
    group.name = displayName + " tab";
    var pCls = _tabAssetItems([pasted[0], pasted[1]]);
    if (!pCls) { _dropPasted(pasted); try { group.remove(); } catch (eG) {} return { ok: false, reason: "pasted tab ambiguous cutline/fill" }; }
    pCls.fill.move(group, ElementPlacement.PLACEATEND);
    pCls.cutline.move(group, ElementPlacement.PLACEATEND);
    pCls.cutline.name = displayName + " tab cutline";
    pCls.fill.name    = displayName + " tab fill";

    // Orient: the asset is authored with its FLAT (attach) edge on top and the body/dome pointing
    // DOWN (-π/2). The flat edge is what connects to the art; the dome bulges OUTWARD (the grab).
    // Rotate by the delta between the desired outward direction and the authored body direction so
    // the dome ends up pointing along edge.outwardAngle and the flat edge faces the art. The
    // authored flat-to-dome depth = the group height BEFORE rotation (flat edge on top, dome below);
    // after rotation this is the tab's extent along the outward normal.
    var authoredOutward = -Math.PI / 2;
    var gbA = group.geometricBounds;                 // [l,t,r,b] y-up, pre-rotation
    var depthPt = gbA[1] - gbA[3];
    var rotDeg = (edge.outwardAngle - authoredOutward) * 180 / Math.PI;
    try { group.rotate(rotDeg); } catch (eR) {}

    // Place the tab fully OUTSIDE the element: push the group out along the outward normal by half
    // its depth + a small gap, so the flat (attach) edge sits just BEYOND the art edge and the body
    // points away — no intersection. Pipeline 2's seat then pulls it in to the overlap depth.
    var gapPt = mmToPoints((CONFIG.peelTabPlacementGapMm != null) ? CONFIG.peelTabPlacementGapMm : 0.5);
    var pushPt = depthPt / 2 + gapPt;
    var gb = group.geometricBounds;                  // [l,t,r,b] y-up, post-rotation
    var gcx = (gb[0] + gb[2]) / 2, gcy = (gb[1] + gb[3]) / 2;
    var ux = Math.cos(edge.outwardAngle), uy = Math.sin(edge.outwardAngle);
    group.translate((edge.midX + pushPt * ux) - gcx, (edge.midY + pushPt * uy) - gcy);

    log("[step6] tab placed | " + group.name + " | edge " + _r1(edge.lengthMm)
        + "mm dir " + _r1(edge.dirAngle * 180 / Math.PI) + "deg outward "
        + _r1(edge.outwardAngle * 180 / Math.PI) + "deg push " + _r1(pointsToMm(pushPt)) + "mm");
    return { ok: true, group: group, cutline: pCls.cutline, fill: pCls.fill };
}

// True if point pt {x, y} is inside polygon poly ([{x, y}, …]) — ray casting.
function pointInPolygon(pt, poly) {
    var inside = false;
    var n = poly.length;
    var i, j;
    for (i = 0, j = n - 1; i < n; j = i++) {
        var yi = poly[i].y, yj = poly[j].y;
        if ((yi > pt.y) !== (yj > pt.y)) {
            var xint = (poly[j].x - poly[i].x) * (pt.y - yi) / (yj - yi) + poly[i].x;
            if (pt.x < xint) inside = !inside;
        }
    }
    return inside;
}

// True if segment a-b intersects segment c-d (all {x, y}). Uses orientation signs.
function segmentsIntersect(a, b, c, d) {
    function cross(o, p, q) {
        return (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
    }
    var d1 = cross(c, d, a);
    var d2 = cross(c, d, b);
    var d3 = cross(a, b, c);
    var d4 = cross(a, b, d);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    return false;
}

// True if two polygon sets overlap: any edge crossing, or either contains a
// vertex of the other (handles full containment with no edge crossing).
function polygonsOverlap(polysA, polysB) {
    var ai, bi, i, j;
    for (ai = 0; ai < polysA.length; ai++) {
        var A = polysA[ai];
        for (bi = 0; bi < polysB.length; bi++) {
            var B = polysB[bi];
            // Edge-edge crossings.
            for (i = 0; i < A.length; i++) {
                var a1 = A[i], a2 = A[(i + 1) % A.length];
                for (j = 0; j < B.length; j++) {
                    var b1 = B[j], b2 = B[(j + 1) % B.length];
                    if (segmentsIntersect(a1, a2, b1, b2)) return true;
                }
            }
            // Containment (no crossing): one vertex inside the other.
            if (pointInPolygon(A[0], B)) return true;
            if (pointInPolygon(B[0], A)) return true;
        }
    }
    return false;
}

// True if inner geometricBounds [left, top, right, bottom] (AI y-up) lies entirely
// within outer geometricBounds. tolPt allows a small slack (sub-point rounding).
function boundsWithin(inner, outer, tolPt) {
    var t = tolPt || 0;
    return inner[0] >= outer[0] - t &&   // left
           inner[1] <= outer[1] + t &&   // top  (y-up: smaller is lower)
           inner[2] <= outer[2] + t &&   // right
           inner[3] >= outer[3] - t;     // bottom
}

// Closest point ON segment a–b to point p, plus the SQUARED distance. Returns
// { dist2, qx, qy } — qx/qy is the witness point on the segment (all {x, y}).
// minPolygonSetDistanceEx compares squared distances in its hot loop and takes a
// single sqrt at the very end, so the per-pair sqrt (millions of calls) is avoided;
// monotonicity of sqrt makes every comparison identical to a sqrt-based one. (If a
// caller ever needs the actual distance, Math.sqrt(dist2) at the call site.)
function _ptSegClosestSq(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len2 = dx * dx + dy * dy;
    var qx, qy;
    if (len2 === 0) {
        qx = a.x; qy = a.y;
    } else {
        var tv = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
        if (tv < 0) tv = 0; else if (tv > 1) tv = 1;
        qx = a.x + tv * dx; qy = a.y + tv * dy;
    }
    var fx = p.x - qx, fy = p.y - qy;
    return { dist2: fx * fx + fy * fy, qx: qx, qy: qy };
}

// Axis-aligned bounding box of a polygon ([{x,y}, …]) as {x0, x1, y0, y1}.
function _polyBbox(poly) {
    var x0 = poly[0].x, x1 = poly[0].x, y0 = poly[0].y, y1 = poly[0].y;
    var i, p;
    for (i = 1; i < poly.length; i++) {
        p = poly[i];
        if (p.x < x0) x0 = p.x; else if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y; else if (p.y > y1) y1 = p.y;
    }
    return { x0: x0, x1: x1, y0: y0, y1: y1 };
}

// Squared distance from point p {x,y} to AABB bb {x0,x1,y0,y1}; 0 if inside.
// This is a LOWER BOUND on p's distance to any point of a polygon contained in bb,
// so if it already exceeds the running minimum the whole polygon can be skipped for
// this vertex without affecting the exact result.
function _ptBboxDist2(p, bb) {
    var dx = (p.x < bb.x0) ? (bb.x0 - p.x) : (p.x > bb.x1 ? p.x - bb.x1 : 0);
    var dy = (p.y < bb.y0) ? (bb.y0 - p.y) : (p.y > bb.y1 ? p.y - bb.y1 : 0);
    return dx * dx + dy * dy;
}

// Minimum distance (points) between two sets of sampled polygons. Returns 0
// immediately if either polygon set contains a vertex of the other (full
// containment). Otherwise the exact minimum is the smallest point-to-edge
// distance across all polygon pairs (both directions). Relies on the sample
// density being fine enough relative to the spacing threshold — at 12 steps/
// segment and typical sticker scales, samples are ~0.4 mm apart, well inside
// the 2 mm QA threshold.
function minPolygonSetDistance(polysA, polysB) {
    return minPolygonSetDistanceEx(polysA, polysB).dist;
}

// Optional third arg `maxDist` (points): a caller that only cares whether the sets are
// closer than a threshold (spacing QA) passes it to SEED the running minimum at maxDist²
// instead of Infinity. Because the per-vertex bbox distance is a strict LOWER BOUND, any
// vertex that could yield a distance < maxDist is still NEVER pruned, so the result — the
// distance AND the witness pair — is byte-identical for every pair whose true distance is
// < maxDist (the only pairs a threshold caller acts on). Pairs that are actually ≥ maxDist
// short-circuit almost entirely (every vertex prunes immediately) and report dist == maxDist
// with a meaningless witness, which the caller discards. Omit maxDist for the exact minimum.

// Same minimum-distance computation as minPolygonSetDistance, but also returns
// the witness pair — the two closest points, one on each polygon set — so QA can
// draw a connector spanning the actual gap. Returns
//   { dist, ax, ay, bx, by }
// where (ax,ay) lies on polysA and (bx,by) on polysB. On full containment
// (dist 0) the witness collapses to the contained vertex (connector degenerates
// to a dot, which still marks the spot). Points are in the polygons' own
// coordinate space (document points, as produced by samplePathToPolygons).
function minPolygonSetDistanceEx(polysA, polysB, maxDist) {
    // Work in SQUARED distance throughout (no per-pair sqrt) and prune each vertex
    // against the other polygon's bounding box. Both are exact: sqrt is monotonic so
    // every comparison is unchanged, and a vertex whose distance to B's bbox already
    // exceeds the running min cannot beat it (bbox distance is a lower bound), so
    // skipping it leaves the minimum AND the witness pair byte-identical to brute
    // force. This is the heavy inner loop of spacing QA — formerly ~13s of the run.
    // Seeding minD2 at maxDist² (when given) makes the bbox prune effective from the
    // FIRST vertex instead of only after a close pair is found — see the wrapper note.
    var minD2 = (maxDist === undefined || maxDist === null)
        ? Infinity
        : maxDist * maxDist;
    var wax = 0, way = 0, wbx = 0, wby = 0;
    var ai, bi, pi, qi, c;

    // Precompute each B polygon's bbox ONCE — it doesn't depend on ai, so computing
    // it inside the ai-loop would rescan every B once per A polygon (only bites
    // multi-poly compound-path sets, but it's free to hoist).
    var bbBs = [];
    for (bi = 0; bi < polysB.length; bi++) bbBs[bi] = _polyBbox(polysB[bi]);

    for (ai = 0; ai < polysA.length; ai++) {
        var A = polysA[ai];
        var nA = A.length;
        var bbA = _polyBbox(A);
        for (bi = 0; bi < polysB.length; bi++) {
            var B = polysB[bi];
            var nB = B.length;
            if (pointInPolygon(A[0], B)) {
                return { dist: 0, ax: A[0].x, ay: A[0].y, bx: A[0].x, by: A[0].y };
            }
            if (pointInPolygon(B[0], A)) {
                return { dist: 0, ax: B[0].x, ay: B[0].y, bx: B[0].x, by: B[0].y };
            }
            var bbB = bbBs[bi];
            // A vertices vs B edges — witness on A is the vertex, on B the projection.
            for (pi = 0; pi < nA; pi++) {
                var ap = A[pi];
                if (_ptBboxDist2(ap, bbB) >= minD2) continue;  // exact prune
                for (qi = 0; qi < nB; qi++) {
                    c = _ptSegClosestSq(ap, B[qi], B[(qi + 1) % nB]);
                    if (c.dist2 < minD2) {
                        minD2 = c.dist2;
                        wax = ap.x; way = ap.y; wbx = c.qx; wby = c.qy;
                    }
                }
            }
            // B vertices vs A edges — witness on B is the vertex, on A the projection.
            for (pi = 0; pi < nB; pi++) {
                var bp = B[pi];
                if (_ptBboxDist2(bp, bbA) >= minD2) continue;  // exact prune
                for (qi = 0; qi < nA; qi++) {
                    c = _ptSegClosestSq(bp, A[qi], A[(qi + 1) % nA]);
                    if (c.dist2 < minD2) {
                        minD2 = c.dist2;
                        wbx = bp.x; wby = bp.y; wax = c.qx; way = c.qy;
                    }
                }
            }
        }
    }
    return { dist: Math.sqrt(minD2), ax: wax, ay: way, bx: wbx, by: wby };
}


// ─── QA VISUAL OVERLAY ──────────────────────────────────────────────────────────
// One throwaway layer holds EVERY QA visual — spacing/margin flag markers (Step 8c)
// and NQI pocket fills (StepQA) — so the artist toggles a single layer to show/hide
// all of it, and the real cutlines stay pristine 0.25pt black (no in-place recolor).
// Step 11 strips this layer by name, so it never reaches the final print file.

// Returns the shared QA layer, creating it if absent. With reset=true, any existing
// QA layer is removed and rebuilt empty (clears stale markers from a prior run) —
// the FIRST phase of a run passes reset=true; later phases pass reset=false to
// append. Brought to front and unlocked so its contents draw over the artwork.
function getOrCreateQALayer(doc, name, reset) {
    var existing = findLayer(doc, name);
    if (existing) {
        if (!reset) {
            existing.locked  = false;
            existing.visible = true;
            return existing;
        }
        existing.locked  = false;
        existing.visible = true;   // a hidden layer can't be removed
        existing.remove();
    }
    var layer = doc.layers.add();
    layer.name = name;
    layer.zOrder(ZOrderMethod.BRINGTOFRONT);
    return layer;
}

// Draws a filled dot centred at (cxPt, cyPt). Illustrator y is up, and ellipse()
// takes the TOP edge, so top = cy + radius. Stroke off; semi-transparent fill.
function qaDrawDot(layer, cxPt, cyPt, radiusPt, colorObj, opacity) {
    var dot = layer.pathItems.ellipse(
        cyPt + radiusPt, cxPt - radiusPt, radiusPt * 2, radiusPt * 2);
    dot.stroked   = false;
    dot.filled    = true;
    dot.fillColor = colorObj;
    dot.opacity   = (opacity === undefined) ? 100 : opacity;
    return dot;
}

// Draws an open 2-point line between (x1,y1) and (x2,y2) — the gap connector.
function qaDrawSegment(layer, x1, y1, x2, y2, colorObj, widthPt, opacity) {
    var seg = layer.pathItems.add();
    seg.setEntirePath([[x1, y1], [x2, y2]]);
    seg.closed      = false;
    seg.stroked     = true;
    seg.filled      = false;
    seg.strokeWidth = widthPt;
    seg.strokeColor = colorObj;
    seg.opacity     = (opacity === undefined) ? 100 : opacity;
    return seg;
}

// Duplicates a cutline outline onto the QA layer and FILLS it (no stroke) with a
// translucent colour — the element "halo" that glows over the whole sticker so a
// flagged element is spottable at full-sheet zoom regardless of how small the
// actual violation is. Same-document duplicate. Returns the duplicate, or null if
// the item can't be filled (e.g. a PlacedItem stamp — halo its bbox instead).
function qaHaloElement(layer, item, colorObj, opacity) {
    var tn = item.typename;
    if (tn !== "PathItem" && tn !== "CompoundPathItem" && tn !== "GroupItem") {
        return null;
    }
    var dup = item.duplicate(layer, ElementPlacement.PLACEATEND);
    _qaFillRecursive(dup, colorObj);
    dup.opacity = (opacity === undefined) ? 100 : opacity;
    return dup;
}

// Fills every leaf path of item (clearing stroke) — the fill counterpart of
// strokeRecursive, used by qaHaloElement. Shares the applyToPathTree walker.
function _qaFillRecursive(item, colorObj) {
    applyToPathTree(item, function (p) {
        p.filled = true; p.fillColor = colorObj; p.stroked = false;
    });
}

// Draws a filled triangular arrow (badge) centred at (cx,cy), pointing along the
// unit direction (dirX,dirY), with overall length sizePt. Used for the amber
// margin badge sitting in the gutter and pointing inward (which way to pull it in).
function qaDrawArrow(layer, cx, cy, dirX, dirY, sizePt, colorObj, opacity) {
    var hx = dirX * sizePt / 2, hy = dirY * sizePt / 2;   // half-vector along dir
    var px = -dirY, py = dirX;                            // perpendicular unit
    var bw = sizePt * 0.5;                                // half base width
    var t = layer.pathItems.add();
    t.setEntirePath([
        [cx + hx,            cy + hy],            // tip
        [cx - hx + px * bw,  cy - hy + py * bw],  // base corner 1
        [cx - hx - px * bw,  cy - hy - py * bw]   // base corner 2
    ]);
    t.closed    = true;
    t.stroked   = false;
    t.filled    = true;
    t.fillColor = colorObj;
    t.opacity   = (opacity === undefined) ? 100 : opacity;
    return t;
}

// Draws a filled (unstroked) polygon on the layer from an array of {x,y} points —
// used for the amber margin-overhang sliver. setEntirePath throws "Illegal Argument" on
// a <3-point, non-finite, zero-extent, OR VERY DENSE path — and a real overhang sliver
// (the overhang of a densely-traced silhouette like a castle, sampled at 12 steps/segment)
// easily exceeds the point limit. So guard finiteness/extent, decimate to a safe cap, and
// wrap the call: this is an ADVISORY overlay, so an undrawable sliver must WARN + skip, not
// abort the whole QA pass (the margin violation is already logged and marked by the halo +
// inward arrow). Same guards the half-cut seam uses (_decimateSeam / _seamFinite).
function qaFillPolygon(layer, poly, colorObj, opacity) {
    if (!poly || poly.length < 3 || !_seamFinite(poly)) return null;
    var capped = _decimateSeam(poly, 400);
    var pts = [], i;
    for (i = 0; i < capped.length; i++) pts.push([capped[i].x, capped[i].y]);
    var p = layer.pathItems.add();
    try {
        p.setEntirePath(pts);
    } catch (e) {
        try { p.remove(); } catch (e2) {}
        log("[step8c] WARN | margin sliver not drawn (" + pts.length + " pts): " + e.message);
        return null;
    }
    p.closed    = true;
    p.stroked   = false;
    p.filled    = true;
    p.fillColor = colorObj;
    p.opacity   = (opacity === undefined) ? 100 : opacity;
    return p;
}

// Sutherland–Hodgman clip of a polygon ({x,y}[]) to one axis-aligned half-plane.
// axis "x" or "y"; keeps the portion on the value side selected by keepGreater
// (true → coord >= value, false → coord <= value). Returns the clipped polygon
// (possibly empty). Clipping a closed outline to the OUTSIDE half-plane of a margin
// edge yields exactly the overhang sliver beyond that edge — no boolean ops needed.
function clipPolygonToHalfPlane(poly, axis, value, keepGreater) {
    var out = [], n = poly.length, i;
    function coord(p) { return (axis === "x") ? p.x : p.y; }
    function inside(p) { return keepGreater ? (coord(p) >= value) : (coord(p) <= value); }
    function isect(a, b) {
        var ca = coord(a), cb = coord(b);
        var t = (cb === ca) ? 0 : (value - ca) / (cb - ca);
        return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    }
    for (i = 0; i < n; i++) {
        var cur  = poly[i];
        var prev = poly[(i + n - 1) % n];
        var curIn = inside(cur), prevIn = inside(prev);
        if (curIn) {
            if (!prevIn) out.push(isect(prev, cur));
            out.push(cur);
        } else if (prevIn) {
            out.push(isect(prev, cur));
        }
    }
    return out;
}

// ── Version status (reads update-status.txt written by installer/update.sh) ──
// rootPath = pipeline _root (the scripts folder). SUPPORT_DIR = its parent.
function readVersionStatus(rootPath) {
    var res = { installedSha: "", checkedEpoch: 0, ok: false, state: "unknown" };
    try {
        var f = new File(new File(rootPath).parent.fsName + "/update-status.txt");
        if (!f.exists) { return res; }
        f.open("r"); var txt = f.read(); f.close();
        var lines = txt.split(/\r\n|\r|\n/);
        for (var i = 0; i < lines.length; i++) {
            var eq = lines[i].indexOf("=");
            if (eq < 0) { continue; }
            var k = lines[i].substring(0, eq);
            var v = lines[i].substring(eq + 1);
            if (k === "installed") { res.installedSha = v; }
            else if (k === "checked") { res.checkedEpoch = parseInt(v, 10) || 0; }
            else if (k === "ok") { res.ok = (v === "1"); }
        }
        if (!res.installedSha) { res.state = "unknown"; return res; }
        var nowEpoch = Math.floor((new Date()).getTime() / 1000);
        var age = nowEpoch - res.checkedEpoch;
        // Pure auto-sync: update.sh always converges installed==latest on ok=1, so the only
        // meaningful states are current vs. updater-not-working. ok=0 (offline / failed sync)
        // or an old check => stale; otherwise up to date.
        if (!res.ok || res.checkedEpoch === 0 || age > 10800) { res.state = "stale"; }
        else { res.state = "upToDate"; }
    } catch (e) { res.state = "unknown"; }
    return res;
}

// Formats the one-line signal for a completion alert. "" when unknown.
function formatVersionStatus(status) {
    if (!status || status.state === "unknown" || !status.installedSha) { return ""; }
    var v = "version " + status.installedSha.substring(0, 7);
    if (status.state === "stale") {
        return "⚠ " + v + " — updates aren't reaching this Mac";
    }
    return "✓ " + v;
}
