// aiUtils.jsx — Shared Illustrator utilities
// #included by pipeline scripts. Not run directly.
// All functions assume CONFIG is defined in the including pipeline script.

// ─── REGEX ────────────────────────────────────────────────────────────────────

// Same naming convention as Photoshop — element names are consistent across apps.
// Matches "Horseshoe Bend [WC-LM]"  → captures (Horseshoe Bend)(WC)(LM)(undefined)
// Matches "Eiffel Tower [WC-LM+]"   → captures (Eiffel Tower)(WC)(LM)(+)
// Matches "Small Snack [WC-FD-]"    → captures (Small Snack)(WC)(FD)(-)
// Matches "Orlando Stamp [ST]"      → captures (Orlando Stamp)(ST)(undefined)(undefined)
var NAME_REGEX = /^(.+)\s\[([A-Z]+)(?:-([A-Z]+)([+-])?)?\]$/;

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

    var doc = app.documents.add(
        DocumentColorSpace.CMYK,
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

    log("[aiutils] built working document | A4 CMYK | Margin > Stickers > Grid > Color Block");
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
        rects[ri].fillColor  = blackCmyk();
        rects[ri].stroked    = false;
    }

    // "Make Compound Path" on the two rects — the inner becomes a hole.
    app.selection = null;
    outer.selected = true;
    inner.selected = true;
    app.executeMenuCommand("compoundPath");
    app.selection = null;

    var cp = margin.compoundPathItems[0];
    cp.evenodd = true;   // inner rect reads as a hole
    cp.opacity = 30;     // 30% black band — container opacity (applies to the whole compound)

    margin.zOrder(ZOrderMethod.BRINGTOFRONT);
    margin.locked = true;
    return margin;
}

// CMYK(55,0,100,0) — the template's Color Block green (Step 10 green preview).
function _bwdGreen() {
    var c = new CMYKColor();
    c.cyan = 55; c.magenta = 0; c.yellow = 100; c.black = 0;
    return c;
}

// Light grey for the reference grid — subtle, non-printing visual aid.
function _bwdGridColor() {
    var c = new CMYKColor();
    c.cyan = 0; c.magenta = 0; c.yellow = 0; c.black = 20;
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

// Returns a CMYKColor set to 100% black.
function blackCmyk() {
    var c = new CMYKColor();
    c.cyan = 0; c.magenta = 0; c.yellow = 0; c.black = 100;
    return c;
}

// Returns a CMYKColor set to 0% ink (white).
function whiteCmyk() {
    var c = new CMYKColor();
    c.cyan = 0; c.magenta = 0; c.yellow = 0; c.black = 0;
    return c;
}

// Returns a CMYKColor set to 100% red (used for QA stroke).
function redCmyk() {
    var c = new CMYKColor();
    c.cyan = 0; c.magenta = 100; c.yellow = 100; c.black = 0;
    return c;
}

// Warm amber/orange — the QA colour for MARGIN overflow, distinct at a glance from
// the red used for spacing pinches. Reads clearly over the grey margin band where
// the overhang fill sits.
function amberCmyk() {
    var c = new CMYKColor();
    c.cyan = 0; c.magenta = 55; c.yellow = 100; c.black = 0;
    return c;
}

// Cool blue — the NEUTRAL "this element needs attention" halo colour. Deliberately
// not red/amber so an element with BOTH a spacing and a margin issue isn't forced
// into one type-colour: the halo just says "look here" (visible at full-sheet zoom
// as a tint over the sticker), while the red/amber badges carry the problem type.
function haloCmyk() {
    var c = new CMYKColor();
    c.cyan = 70; c.magenta = 30; c.yellow = 0; c.black = 0;
    return c;
}

// Strong blue — the CAPTION-SEAT review badge (Step 3B's conform flagged an uneven
// seat via the note "…|R"). Distinct from the warm red/amber problem badges; says
// "eyeball this caption". Advisory only — it does NOT gate export.
function seatReviewCmyk() {
    var c = new CMYKColor();
    c.cyan = 90; c.magenta = 60; c.yellow = 0; c.black = 0;
    return c;
}

// ─── PATH STYLE HELPERS ───────────────────────────────────────────────────────

// Applies stroke style to a PathItem or CompoundPathItem.
// colorObj must be a CMYKColor (or RGBColor) instance.
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
// {x,y} in AI points (y-up); radius in points. This is the AI-side twin of
// Step 3B's _capsulePolygon (Photoshop) — same offset-spine-plus-end-caps math —
// so the cutline's caption portion matches the real White pill. Returns a filled,
// unstroked PathItem ready for deriveCutline's boolean union.
function buildCapsuleFromSpine(layer, spinePts, radius) {
    var poly = _capsulePolygon(spinePts, radius);
    var p = layer.pathItems.add();
    p.setEntirePath(poly);
    p.closed  = true;   // setEntirePath can drop the closed flag
    p.filled  = true;
    p.stroked = false;
    return p;
}

// Offsets a spine polyline by ±radius into a closed capsule polygon (rounded ends).
// Returns an array of [x,y] for setEntirePath. Ported from Step3B_CaptionWhite.jsx.
function _capsulePolygon(spine, r) {
    var n = spine.length, i;
    var top = [], bot = [];

    for (i = 0; i < n; i++) {
        // Local tangent from neighbours (forward/backward diff at the ends).
        var p0 = spine[i > 0 ? i - 1 : i];
        var p1 = spine[i < n - 1 ? i + 1 : i];
        var tx = p1.x - p0.x, ty = p1.y - p0.y;
        var len = Math.sqrt(tx * tx + ty * ty) || 1;
        var nx = -ty / len, ny = tx / len;   // unit normal
        top.push([spine[i].x + r * nx, spine[i].y + r * ny]);
        bot.push([spine[i].x - r * nx, spine[i].y - r * ny]);
    }

    var endT   = _capUnit(spine[n - 1].x - spine[n - 2 >= 0 ? n - 2 : 0].x,
                          spine[n - 1].y - spine[n - 2 >= 0 ? n - 2 : 0].y);
    var startT = _capUnit(spine[0].x - spine[1 < n ? 1 : 0].x,
                          spine[0].y - spine[1 < n ? 1 : 0].y);

    var poly = [], k;
    for (k = 0; k < top.length; k++) poly.push(top[k]);                // one edge
    _appendCap(poly, spine[n - 1], r, top[n - 1], bot[n - 1], endT);   // end cap
    for (k = bot.length - 1; k >= 0; k--) poly.push(bot[k]);           // other edge
    _appendCap(poly, spine[0], r, bot[0], top[0], startT);             // start cap
    return poly;
}

// Appends a semicircular arc of points around centre C (radius r), from fromPt to
// toPt, sweeping through the outward direction `through`.
function _appendCap(poly, C, r, fromPt, toPt, through) {
    var steps = 10;
    var a0 = Math.atan2(fromPt[1] - C.y, fromPt[0] - C.x);
    var a1 = Math.atan2(toPt[1]   - C.y, toPt[0]   - C.x);
    var sweep = a1 - a0;
    while (sweep <= -Math.PI) sweep += 2 * Math.PI;
    while (sweep > Math.PI)  sweep -= 2 * Math.PI;
    var midAng = a0 + sweep / 2;
    if (Math.cos(midAng) * through[0] + Math.sin(midAng) * through[1] < 0) {
        sweep += (sweep > 0 ? -2 * Math.PI : 2 * Math.PI);
    }
    var s;
    for (s = 1; s < steps; s++) {
        var ang = a0 + sweep * (s / steps);
        poly.push([C.x + r * Math.cos(ang), C.y + r * Math.sin(ang)]);
    }
}

function _capUnit(x, y) {
    var len = Math.sqrt(x * x + y * y) || 1;
    return [x / len, y / len];
}

// ─── CAPTION SPINE FIT (ported from PS Step3B — pure geometry, node-testable) ───
// Least-squares quadratic through sampled centre points; snaps to a straight 2-point spine
// when the fit stays within snapTolPt of flat. Returns { spine:[{x,y}…], straight:Bool }.
// Coordinate-agnostic (fits y as a function of x), so it is identical in PS y-down and AI y-up.
function _capQuadFitSpine(pts, x0, x1, snapTolPt) {
    var n = pts.length, i;
    var xm = 0, ym = 0;
    for (i = 0; i < n; i++) { xm += pts[i].x; ym += pts[i].y; }
    xm /= n; ym /= n;
    var S0 = n, S1 = 0, S2 = 0, S3 = 0, S4 = 0, Ty = 0, Txy = 0, Tx2y = 0;
    for (i = 0; i < n; i++) {
        var dx = pts[i].x - xm, y = pts[i].y, dx2 = dx * dx;
        S1 += dx; S2 += dx2; S3 += dx2 * dx; S4 += dx2 * dx2;
        Ty += y; Txy += dx * y; Tx2y += dx2 * y;
    }
    var a = 0, b = 0, c = ym;
    var sol = _capSolve3(S4, S3, S2, S3, S2, S1, S2, S1, S0, Tx2y, Txy, Ty);
    if (sol) { a = sol[0]; b = sol[1]; c = sol[2]; }
    function yAt(px) { var d = px - xm; return a * d * d + b * d + c; }
    var flat = ym, maxDev = 0, probes = 16, p;
    for (p = 0; p <= probes; p++) {
        var px = x0 + (x1 - x0) * (p / probes);
        var dev = Math.abs(yAt(px) - flat);
        if (dev > maxDev) maxDev = dev;
    }
    if (maxDev <= snapTolPt) return { spine: _capStraightSpine(x0, x1, flat), straight: true };
    var out = [], M = 40;
    for (p = 0; p <= M; p++) { var sx = x0 + (x1 - x0) * (p / M); out.push({ x: sx, y: yAt(sx) }); }
    return { spine: out, straight: false };
}

// Two-point horizontal spine at height y over [x0, x1].
function _capStraightSpine(x0, x1, y) { return [{ x: x0, y: y }, { x: x1, y: y }]; }

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

    return app.selection[0];
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

    var newCutline = deriveCutline(outline, plate);
    strokeRecursive(newCutline, strokePt, blackCmyk());

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
    // REAL inner-edge vertices (the art-facing long edge of the plate), preserving the actual
    // curve. NOT a straight PCA-chord reconstruction — that floats off an arced caption and
    // under-seats it (the Šúľance gap: the kiss sank a phantom chord while the real plate
    // stayed out). See _innerEdgeVerts.
    var ie = _innerEdgeVerts(pp, geom);
    if (!ie || ie.verts.length === 0) {
        log("[seat] " + name + " | SKIP — could not resolve plate inner edge.");
        return { ok: false, reason: "degenerate plate" };
    }

    var needsReview = false, shrunk = false;
    var items = [plate];
    if (captionItem) items.push(captionItem);

    var verts = ie.verts, n = verts.length, r = ie.radius;
    var shrinkF = (CONFIG.seatShrinkFrac != null) ? CONFIG.seatShrinkFrac : 0.15;

    // ── ENDPOINTS + probe (the REAL plate boundary, curved or straight — no chord float) ──
    // The two ends of the inner edge, taken from the actual sampled plate outline. Look from
    // each toward the art and grab the edge in front of it.
    var iLo = 0, iHi = n - 1;
    var E0 = verts[iLo], E1 = verts[iHi];
    var B0 = _probeOutline(artPolys, geom, E0);
    var B1 = _probeOutline(artPolys, geom, E1);

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
    // the seat to a deeper interior point, backing the pill out — then flag if still over. This
    // is the branch Šúľance hits; its bug was the OLD straight-chord reconstruction floating off
    // the arc, so the measurement now uses the REAL boundary verts. One shrink budget, shared
    // with overhang. ──
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

    // ── ROTATE: align the inner edge parallel to the art chord B0->B1, pivot E0. Two real
    // endpoints decide the tilt, so a wiggle in the middle can't swing it. ──
    var rotDeg = 0;
    if (CONFIG.seatConform && !ie.kissOnly) {
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

    // ── KISS (original): slide E0 onto B0 along the travel axis, submerged by depth d. E0 is the
    // rotation pivot (fixed) and B0 is on the stationary art, so both hold after rotation. E0 is
    // a REAL boundary point, so the real plate edge lands at depth d — no phantom float. ──
    var k = _aiKissVector(E0, B0, geom, depth);
    _translateItems(items, k.tx, k.ty);
    if (CONFIG.seatDebug) {
        var _e0p = { x: E0.x + k.tx, y: E0.y + k.ty };
        log("[seatdbg] " + name + " | axisX=" + geom.travelIsX + " sign=" + geom.sign
            + " depth=" + _r1(depth) + " r=" + _r1(r) + " kissOnly=" + ie.kissOnly
            + " shrunk=" + shrunk + " rot=" + _r1(rotDeg) + " k=(" + _r1(k.tx) + "," + _r1(k.ty) + ")");
        log("[seatdbg] " + name + "   E0=(" + _r1(E0.x) + "," + _r1(E0.y) + ") B0=(" + _r1(B0.x)
            + "," + _r1(B0.y) + ") E0post=(" + _r1(_e0p.x) + "," + _r1(_e0p.y) + ") inArt="
            + _pointInPolysEO(_e0p, artPolys));
    }
    log("[seat] " + name + " | seated rot=" + _r1(rotDeg) + "deg move="
        + _r1(geom.travelIsX ? k.tx : k.ty) + "pt depth=" + _r1(depth) + "pt"
        + (needsReview ? " (needsReview)" : ""));
    return { ok: true, moved: Math.sqrt(k.tx * k.tx + k.ty * k.ty),
             rotDeg: rotDeg, needsReview: needsReview };
}

// REAL inner-edge vertices of the plate polygon (the art-facing long edge), ordered along the
// long axis — preserves the actual curve, so an arced caption seats on its true edge rather
// than a floating straight chord. PCA gives the long axis (to classify caps vs long edges and
// pick the inner side toward geom.sign); the near-circular guard switches to a deterministic
// basis and flags kissOnly. Returns { verts:[{x,y,t}...], radius, kissOnly } or null. Pure geometry.
function _innerEdgeVerts(pp, geom) {
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
        if (tt <= ext.tmin + r || tt >= ext.tmax - r) continue;   // skip caps
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
// Native Ramer–Douglas–Peucker anchor reduction + Catmull-Rom bezier refit with
// corner preservation. Illustrator's Object>Path>Simplify is not scriptable
// without a dialog, so this reproduces it deterministically. tolerance/cornerAngle
// are supplied by the caller (CONFIG).

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

// Rewrites a PathItem from a reduced anchor list, assigning Catmull-Rom handles
// for smooth points and zero-length handles (sharp) for corners / open endpoints.
function _applySmoothPath(path, anchors, cornerAngleDeg) {
    var closed = path.closed;
    var n = anchors.length;
    var coords = [], i;
    for (i = 0; i < n; i++) coords.push([anchors[i].x, anchors[i].y]);

    path.setEntirePath(coords);
    path.closed = closed; // setEntirePath can drop the closed flag

    var pts = path.pathPoints;
    for (i = 0; i < n; i++) {
        var prev = anchors[(i - 1 + n) % n];
        var cur  = anchors[i];
        var next = anchors[(i + 1) % n];
        var isEndpoint = (!closed && (i === 0 || i === n - 1));
        var isCorner   = isEndpoint || _turnAngle(prev, cur, next) >= cornerAngleDeg;
        var pp = pts[i];
        if (isCorner) {
            pp.leftDirection  = [cur.x, cur.y];
            pp.rightDirection = [cur.x, cur.y];
            pp.pointType = PointType.CORNER;
        } else {
            var tx = (next.x - prev.x) / 6;
            var ty = (next.y - prev.y) / 6;
            pp.rightDirection = [cur.x + tx, cur.y + ty];
            pp.leftDirection  = [cur.x - tx, cur.y - ty];
            pp.pointType = PointType.SMOOTH;
        }
    }
}

// Simplifies a PathItem (or each sub-path of a CompoundPathItem) in place.
// tolerancePt is the RDP epsilon (points); cornerAngleDeg preserves sharp corners.
// Returns the number of sub-paths actually reduced.
function simplifyPathItem(path, tolerancePt, cornerAngleDeg) {
    if (path.typename === "CompoundPathItem") {
        var reduced = 0, i;
        for (i = 0; i < path.pathItems.length; i++) {
            reduced += simplifyPathItem(path.pathItems[i], tolerancePt, cornerAngleDeg);
        }
        return reduced;
    }
    if (path.typename !== "PathItem") return 0;

    var pts = path.pathPoints;
    if (pts.length < 4) return 0; // too few anchors to meaningfully reduce

    var anchors = [], j;
    for (j = 0; j < pts.length; j++) {
        anchors.push({ x: pts[j].anchor[0], y: pts[j].anchor[1] });
    }

    var kept = path.closed ? _rdpClosed(anchors, tolerancePt)
                           : rdpSimplify(anchors, tolerancePt);

    if (kept.length >= anchors.length) return 0;            // no reduction
    if (kept.length < (path.closed ? 3 : 2)) return 0;      // would collapse — bail

    _applySmoothPath(path, kept, cornerAngleDeg);
    return 1;
}

// ─── STEP 9 SHARED HELPERS ────────────────────────────────────────────────────

// Parses group.note "GC|2" (or "GC|2|R") → { styleCode, capLines, needsReview }.
// Returns null for empty/missing. The optional 3rd field "R" marks a caption seat that
// Step 3B's conform flagged for review (surfaced by AI Layout QA). Used by Step 9A /
// syncHalfcut (filter GC/WC) and Step 8c/AI_LayoutQA (the review marker).
function parseNote(note) {
    if (!note || note === "") return null;
    var parts = note.split("|");
    return {
        styleCode:   parts[0],
        capLines:    parts.length > 1 ? parseInt(parts[1], 10) : 1,
        needsReview: parts.length > 2 && parts[2] === "R"
    };
}

// Returns the halfcut layer (case-insensitive match on CONFIG.halfcutLayerName).
// Creates it above the Cutlines layer if absent.
function getOrCreateHalfcutLayer(doc) {
    var name = CONFIG.halfcutLayerName;
    var i;
    for (i = 0; i < doc.layers.length; i++) {
        if (doc.layers[i].name.toLowerCase() === name.toLowerCase()) {
            return doc.layers[i];
        }
    }
    var newLayer = doc.layers.add();
    newLayer.name = name;
    var cutLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (cutLayer) {
        newLayer.move(cutLayer, ElementPlacement.PLACEBEFORE);
    }
    log("[step9] created halfcut layer: " + name);
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
    setStrokeStyle(line, CONFIG.halfcutStrokePt, blackCmyk());
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
    if (!note || (note.styleCode !== "GC" && note.styleCode !== "WC")) {
        return { ok: false, reason: "not GC/WC" };
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
    seam = _extendHalfcutEndsToCutline(seam, cutline, plate, ext, steps, platePolys);
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

// ─── SPACING BUFFER (live 2mm keep-out halo; Step 7B birth + Step 8b refresh) ─────
// A drag-time visual aid for the 2mm minimum-spacing rule. Each GC/WC cutline gets a
// translucent "keep-out" halo offset OUTWARD by HALF the min spacing — so two pieces'
// halos meeting == exactly the min gap, and OVERLAPPING halos == under spec. The halo is
// a child of the cutline GroupItem, so it rides the rigid nest transform (Step 7B) AND any
// manual move/scale the artist applies to the selected cutline group — no re-run needed to
// follow a drag (the half-cut, on its own layer, does NOT track a raw drag; this does).
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
// Idempotent: clears this element's prior "{name} buffer" first (re-run loops: Step 7B on
// re-import, Step 8b repeatedly). GC/WC only (gated on the cutline note), matching the
// half-cut; stamps / uncaptioned skip. Buffers are children of the Cutlines groups, so they
// are EXCLUDED by name (" buffer") from StepQA's occupancy collector and STRIPPED before
// export by removeAllSpacingBuffers (AI_ExportFinal + Step 11). Step 8c is unaffected — it
// reads only the named cutline member (findGroupMember), never the buffer.

// Half of the minimum element spacing, in mm (the per-piece share of the 2mm rule). Reads the
// SAME knob the QA gate uses (CONFIG.spacingThresholdMm) so the visual band and the export gate
// can never disagree about what "2mm" is — a single source of truth. Defaults to 2mm / 2.
function _spacingBufferOffsetMm() {
    var minMm = (CONFIG.spacingThresholdMm != null) ? CONFIG.spacingThresholdMm : 2;
    return minMm / 2;
}

// The halo fill colour — a vivid magenta/violet, the COMPLEMENT of the green Color Block
// background so it reads strongly there (a cyan/teal just muddies into the green under
// Multiply). The slight cyan component pushes it toward violet so it's clearly NOT the pure
// red of the spacing flags / amber of the margin overhang on the Layout QA layer.
function _spacingBufferCmyk() {
    var c = new CMYKColor();
    c.cyan = 30; c.magenta = 90; c.yellow = 0; c.black = 0;
    return c;
}

// Removes any existing spacing-buffer item(s) for one group (named "{name} buffer").
// Snapshots refs first — the live pageItems collection re-indexes on remove. Returns count.
function _removeSpacingBufferFor(group) {
    var want = group.name + " buffer";
    var doomed = [], i;
    for (i = 0; i < group.pageItems.length; i++) {
        if (group.pageItems[i].name === want) doomed.push(group.pageItems[i]);
    }
    for (i = 0; i < doomed.length; i++) { try { doomed[i].remove(); } catch (e) {} }
    return doomed.length;
}

// (Re)builds ONE element's spacing-buffer band from its CURRENT cutline. Idempotent.
// GC/WC captioned groups AND wrapped stamps (note "ST|0"); other notes skip. Returns
// { ok, reason }.
function syncSpacingBuffer(doc, group, opts) {
    opts = opts || {};
    if (!group || group.typename !== "GroupItem") {
        return { ok: false, reason: "stamp / non-group (no buffer)" };
    }
    var note = parseNote(group.note);
    if (!note || (note.styleCode !== "GC" && note.styleCode !== "WC" && note.styleCode !== "ST")) {
        return { ok: false, reason: "not GC/WC/ST" };
    }
    var cutline = findGroupMember(group, "");
    if (!cutline) return { ok: false, reason: "cutline not found in group" };

    _removeSpacingBufferFor(group);

    // Keep the halo a true fixed offset under manual resize: the +offset is a live-effect
    // parameter, so it only stays constant when effects are NOT scaled with the art.
    try { app.preferences.setBooleanPreference("scaleLineWidth", false); } catch (ePref) {}

    var dup = cutline.duplicate(group, ElementPlacement.PLACEATEND);   // behind the cutline stroke
    dup.name = group.name + " buffer";
    try { dup.note = ""; } catch (eNote) {}   // don't let group iterators treat the halo as a cutline

    // Render the keep-out as a thin BAND just outside the cut, NOT a filled shape — a fill tinted
    // the whole sticker (the art showed through pink). H = the per-piece keep-out (half the min
    // spacing). Offsetting the path +H/2 and stroking it H wide (centred, fill cleared) lays a band
    // from the cut line out to +H: the art INTERIOR is never covered, so its true colours show, and
    // two pieces' bands still meet at the 2mm gap + overlap-darken when closer. scaleLineWidth off
    // (set above) keeps BOTH the offset and the stroke a true physical size under resize.
    var H = _spacingBufferOffsetMm();
    strokeRecursive(dup, mmToPoints(H), _spacingBufferCmyk());   // stroked band; clears fill

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

    log("[buffer] " + group.name + " | band 0..+" + H + "mm");
    return { ok: true };
}

// Wraps each bare stamp cutline — a PathItem/CompoundPathItem named "[Display Name]" sitting
// DIRECTLY on the Cutlines layer — into a GroupItem so it can host a spacing-buffer halo that
// rides the drag. Stamps have no caption plate (no Unite), so Step 6 leaves them ungrouped; the
// pipeline's own convention is "any direct-child bare path on Cutlines == a stamp" (see
// _nestBuildCutlineMap). The wrapper uses the SAME {name}==cutline-member structure as a captioned
// element, with note "ST|0" → Step 9A skips its half-cut (stamps hide the peel tab manually, per
// the playbook) while syncSpacingBuffer still finds it. Idempotent: an already-wrapped stamp is no
// longer a direct child, so it is left alone. Returns the number wrapped.
function wrapStampsInGroups(cutlinesLayer) {
    // Snapshot direct-child bare paths first — adding a group + moving items into it re-indexes
    // the live pathItems/compoundPathItems collections mid-loop.
    var bare = [], i, it;
    for (i = 0; i < cutlinesLayer.pathItems.length; i++) {
        it = cutlinesLayer.pathItems[i];
        if (it.parent === cutlinesLayer && it.name) bare.push(it);
    }
    for (i = 0; i < cutlinesLayer.compoundPathItems.length; i++) {
        it = cutlinesLayer.compoundPathItems[i];
        if (it.parent === cutlinesLayer && it.name) bare.push(it);
    }
    var wrapped = 0, p, grp;
    for (i = 0; i < bare.length; i++) {
        p = bare[i];
        grp = cutlinesLayer.groupItems.add();
        grp.name = p.name;
        grp.note = "ST|0";
        p.move(grp, ElementPlacement.PLACEATBEGINNING);
        // p keeps name === grp.name, so findGroupMember(grp, "") returns it (the cutline member).
        wrapped++;
        log("[buffer] wrapped stamp for halo | " + grp.name);
    }
    return wrapped;
}

// Strips every spacing-buffer halo from the Cutlines layer (call before export — Step 10
// clips/exports and Step 11 ships, neither should see the working-phase halo). Idempotent.
// Returns the number removed.
function removeAllSpacingBuffers(doc) {
    var cutLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutLayer) return 0;
    var removed = 0, gi, g;
    for (gi = 0; gi < cutLayer.groupItems.length; gi++) {
        g = cutLayer.groupItems[gi];
        if (g.parent !== cutLayer) continue;
        removed += _removeSpacingBufferFor(g);
    }
    if (removed > 0) log("[buffer] stripped " + removed + " spacing buffer(s) before export.");
    return removed;
}

// Reverses wrapStampsInGroups: for each top-level "ST|0" group, moves its cutline member back
// onto the Cutlines layer as a bare path and removes the now-empty wrapper — restoring the EXACT
// pre-halo stamp structure before export, so Step 10 / Step 11 and the shipped file see stamps
// exactly as they did before this feature (the grouping is a working-phase aid only, never a
// deliverable change). Call AFTER removeAllSpacingBuffers so only the cutline remains. Idempotent.
// Returns the number unwrapped.
function unwrapStampGroups(doc) {
    var cutLayer = findLayer(doc, CONFIG.cutlinesLayerName);
    if (!cutLayer) return 0;
    var groups = [], i, g, note;
    for (i = 0; i < cutLayer.groupItems.length; i++) {
        g = cutLayer.groupItems[i];
        if (g.parent !== cutLayer) continue;
        note = parseNote(g.note);
        if (note && note.styleCode === "ST") groups.push(g);
    }
    var unwrapped = 0, member;
    for (i = 0; i < groups.length; i++) {
        g = groups[i];
        member = findGroupMember(g, "");
        if (member) { member.move(cutLayer, ElementPlacement.PLACEATEND); unwrapped++; }
        try { g.remove(); } catch (e) {}
    }
    if (unwrapped > 0) log("[buffer] unwrapped " + unwrapped + " stamp group(s) for export.");
    return unwrapped;
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

// Builds the half-cut seam polyline = the SUBMERGED SPAN of the caption plate's INNER EDGE.
// Both rounded CAPS and the outer "grab" edge are excluded, so the cut follows the inner edge
// only and never wraps a cap (the back-and-forth "cap dip" spike is impossible by construction).
//
// The endpoint selection is confined to the inner edge — it can't be hijacked by a stray
// crossing on a cap or the outer edge:
//   • Isolate the inner edge as a contiguous run of the plate boundary, each vertex tagged
//     inside/outside the art (_innerEdgeRun).
//   • Take the SUBMERGED sub-span: first..last inside vertex. Any interior exposed stretch (a
//     notch) is bridged straight — so an arbitrary NUMBER of art intersections is handled by
//     construction, not just two.
//   • Each end is where the edge surfaces from the art (_seamWaterline): on the inner edge for
//     a shallow seat (the edge end pokes out), or around on the CAP for a deep seat (the whole
//     edge is buried, so the surfacing point is on the rounded end).
// Straight for a flat/tilted seat; curved only if the plate's spine is genuinely curved.
//
// Degenerate plate (near-circular / ambiguous inner side) → a straight chord between the two
// farthest crossings (still spike-free, on the submerged side) — a shape-degeneracy guard, NOT
// the removed not-seated fallback.
//
// Returns [{x,y}, …] (>=2 pts), or NULL when the caption is NOT seated into the art: nothing
// inside (not connected), nothing outside (fully buried), or no submerged inner edge. The
// caller treats null as a hard error — there is no flat-cut fallback.
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

    // Inside-art flag per plate vertex (even-odd, so art holes count as outside).
    var inside = [], i, countIn = 0;
    for (i = 0; i < n; i++) {
        inside[i] = _pointInPolysEO(pp[i], artPolys);
        if (inside[i]) countIn++;
    }
    // Not seated: nothing inside (not connected) or nothing outside (fully buried).
    if (countIn === 0 || countIn === n) return null;

    // The inner edge as a contiguous run (cap to cap), each vertex tagged inside/outside.
    // geom (plate→art bbox direction) lets _innerEdgeRun sanity-check its submersion tally
    // against the reliable art direction — see the wrong-majority guard there.
    var geom = _aiSeatGeometry(plate, outline);
    var run = _innerEdgeRun(pp, inside, geom);
    if (!run) return _chordFallback(pp, inside, artPolys);   // degenerate plate shape

    // Submerged span: first..last inside vertex (interior notches bridged).
    var f = -1, l = -1, k;
    for (k = 0; k < run.length; k++) {
        if (run[k].inside) { if (f < 0) f = k; l = k; }
    }
    if (f < 0) return null;   // inner edge fully exposed → not seated as a peel tab

    // Each end = where the edge surfaces from the art (inner edge if shallow, cap if deep).
    var leftEnd  = _seamWaterline(pp, inside, artPolys, run, f, -1);
    var rightEnd = _seamWaterline(pp, inside, artPolys, run, l,  1);
    if (!leftEnd || !rightEnd) return null;

    var seam = [leftEnd];
    for (k = f; k <= l; k++) seam.push({ x: run[k].x, y: run[k].y });
    seam.push(rightEnd);

    // The seam ends are the raw plate∩art crossings; syncHalfcut re-projects each onto the
    // current cut line and adds the 1mm peel-tab tail (_extendHalfcutEndsToCutline).
    return seam;
}

// One seam endpoint = where the inner edge surfaces from the art, on the side away from the
// submerged span. run[k] is the first (dir -1) or last (dir +1) submerged vertex.
//   • Shallow seat: the neighbouring run vertex (run[k+dir]) is exposed → the edge surfaces
//     ON the inner edge; bisect that segment to the art border.
//   • Deep seat: run[k] is the run's end (no neighbour that way) → the whole inner edge is
//     buried; walk the plate loop onto the CAP (step = dir) to the first crossing and bisect.
// Returns {x,y} or null.
function _seamWaterline(pp, inside, artPolys, run, k, dir) {
    var nb = k + dir;
    if (nb >= 0 && nb < run.length) {                         // shallow: surfaces on the edge
        return _segCrossArt({ x: run[nb].x, y: run[nb].y },   // exposed neighbour (run[k±1])
                            { x: run[k].x,  y: run[k].y },     // submerged run[k]
                            artPolys);
    }
    var nn = pp.length, cur = run[k].idx, guard = 0, nx;       // deep: walk onto the cap
    while (guard < nn) {
        nx = (cur + dir + nn) % nn;
        if (inside[cur] !== inside[nx]) {
            return _segCrossArt(inside[cur] ? pp[nx] : pp[cur],
                                inside[cur] ? pp[cur] : pp[nx], artPolys);
        }
        cur = nx; guard++;
    }
    return null;
}

// Shape-degeneracy fallback: a straight chord between the two farthest plate∩art crossings.
// Used only when _innerEdgeRun can't split a near-circular plate. Returns [P,Q] or null (<2).
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

// Isolates the plate's INNER EDGE as a CONTIGUOUS run of the boundary loop, one cap to the
// other: [{x, y, idx, inside}, …] in plate-loop order, where idx is the vertex's index in pp
// and inside is whether it's submerged in the art. Returns null when the capsule can't be split
// (near-circular / ambiguous inner side) → caller chords it. Carries no seat info: the caller
// finds the submerged sub-span and the surfacing endpoints itself.
//
// Method: PCA gives the long axis u (perpendicular v) through the vertex centroid. A vertex is
// on a CAP when its axis projection is within one radius r of either extreme (the semicircular
// ends occupy the last r of length). The remaining long-edge vertices split by side; the INNER
// edge is the side with more submerged vertices (a majority, robust to a notch). Its vertices
// are contiguous in the loop — return the longest such contiguous arc.
function _innerEdgeRun(pp, inside, geom) {
    var n = pp.length, i, dx, dy;
    var cx = 0, cy = 0;
    for (i = 0; i < n; i++) { cx += pp[i].x; cy += pp[i].y; }
    cx /= n; cy /= n;
    // Covariance → principal (long) axis u and perpendicular v.
    var sxx = 0, syy = 0, sxy = 0;
    for (i = 0; i < n; i++) {
        dx = pp[i].x - cx; dy = pp[i].y - cy;
        sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    var theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    var ux = Math.cos(theta), uy = Math.sin(theta);
    var vx = -uy, vy = ux;
    // Project every vertex: t along u, soff along v. Axis span + perpendicular half-extent r.
    var t = [], soff = [], tmin = 1e15, tmax = -1e15, smin = 1e15, smax = -1e15, tt, ss;
    for (i = 0; i < n; i++) {
        dx = pp[i].x - cx; dy = pp[i].y - cy;
        tt = dx * ux + dy * uy; ss = dx * vx + dy * vy;
        t[i] = tt; soff[i] = ss;
        if (tt < tmin) tmin = tt;
        if (tt > tmax) tmax = tt;
        if (ss < smin) smin = ss;
        if (ss > smax) smax = ss;
    }
    var r = (smax - smin) / 2;
    if (r <= 1e-6) return null;
    // Too short to hold two caps plus a straight edge (near-circular) → caller chords it.
    if ((tmax - tmin) <= 2 * r * 1.05) return null;
    // Inner side = the long edge (non-cap vertices, split by sign of soff) with more of its
    // vertices submerged in the art. Counting beats a single midpoint probe, which can land in
    // a notch and read the wrong side. Caps excluded so they don't skew the tally.
    var inPos = 0, inNeg = 0;
    for (i = 0; i < n; i++) {
        if (t[i] <= tmin + r || t[i] >= tmax - r) continue;   // skip caps
        if (!inside[i]) continue;
        if (soff[i] > 0) inPos++; else inNeg++;
    }
    if (inPos === inNeg) return null;     // can't tell which long edge is the inner one
    var sign = inPos > inNeg ? 1 : -1;
    // Wrong-majority guard (#4): the inner edge MUST face the art. Cross-check the submerged-
    // vertex tally against the RELIABLE art direction (geom = plate→art bbox centroids, NOT the
    // PCA eigenvector sign, which is fragile). vTravel is this PCA's perpendicular-axis component
    // along the travel axis; the art-facing soff side is sign(vTravel*geom.sign) — the SAME rule
    // the seat's _innerEdgeVerts uses. On a normal seat the submerged majority already faces the
    // art, so they AGREE and this is a no-op. They disagree only when a shallow/tilted seat over
    // CONVEX art submerges verts onto the OUTER edge — then the tally would trace the grab edge,
    // so trust the art direction instead. (No-op on the validated fixture; the log flags any fire.)
    if (geom) {
        var vTravel = geom.travelIsX ? vx : vy;
        var artSide = (vTravel * geom.sign >= 0) ? 1 : -1;
        if (sign !== artSide) {
            log("[halfcut] inner-edge | submerged-vertex tally disagreed with art direction — "
                + "trusting art direction (wrong-majority guard)");
            sign = artSide;
        }
    }
    // Mark inner-edge vertices: clear of both caps AND on the inner side.
    var isInner = [];
    for (i = 0; i < n; i++) {
        isInner[i] = (t[i] > tmin + r && t[i] < tmax - r && soff[i] * sign > 0);
    }
    // Longest contiguous cyclic arc of inner-edge vertices (one capsule side).
    var bestStart = -1, bestLen = 0, len, j2, guard;
    for (i = 0; i < n; i++) {
        if (!isInner[i] || isInner[(i - 1 + n) % n]) continue;   // i starts a fresh arc
        len = 0; j2 = i; guard = 0;
        while (isInner[j2] && guard < n) { len++; j2 = (j2 + 1) % n; guard++; }
        if (len > bestLen) { bestLen = len; bestStart = i; }
    }
    if (bestStart < 0) return null;
    var run = [], idx = bestStart, c;
    for (c = 0; c < bestLen; c++) {
        run.push({ x: pp[idx].x, y: pp[idx].y, idx: idx, inside: inside[idx] });
        idx = (idx + 1) % n;
    }
    return run;
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
function _extendHalfcutEndsToCutline(seam, cutline, plate, overshootPt, steps, platePolys) {
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
    // Reuse the plate polys syncHalfcut already sampled this pass (no mutation since), else sample.
    var platePoly = platePolys ? _largestPoly(platePolys)
                  : (plate ? _largestPoly(samplePathToPolygons(plate, steps)) : null);
    if (!platePoly) return straightOvershoot();             // can't sample plate → legacy

    var tail0 = _cutlineOvershootTail(seam[0],     seam[1],     cutPoly, platePoly, overshootPt); // [P0..end0]
    var tailN = _cutlineOvershootTail(seam[L - 1], seam[L - 2], cutPoly, platePoly, overshootPt); // [PN..endN]

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

// One seam end → an ordered list of points [P, …, tailEnd] that all lie ON the cut line: P is
// the nearest point on the contour to the seam end (= the junction), then a walk of overshootPt
// arc length along the cut-line polygon in the direction heading AWAY from the plate (into the
// body). So the tail tracks the cut line exactly rather than diverging along the art tangent.
function _cutlineOvershootTail(endPt, innerPt, cutPoly, platePoly, overshootPt) {
    // Anchor the tail at the junction by projecting the seam end to the NEAREST point on the cut
    // line — NOT by shooting a ray along the seam tangent. The seam runs along the pill edge, so
    // its tangent is nearly parallel to the cut line at the junction; a ray SKIMS and lands the
    // anchor far away on a stretch that hugs the plate, where both probe branches read ~0 and the
    // branch test below degenerates to an arbitrary tie. Nearest-point keeps the anchor at the
    // crossing, where one branch clearly leaves the plate.
    var Pn = _nearestPointOnPoly(endPt, cutPoly);
    if (!Pn) return [_extendPoint(endPt, innerPt, overshootPt)];       // no contour → fixed
    var P = { x: Pn.x, y: Pn.y };
    var ei = Pn.edge;
    // Pick the contour direction that heads INTO THE BODY (the art cut line), not back around
    // the pill toward the tab. Decide by PROBING ~2mm each way and taking the branch whose
    // endpoint ends up farther from the PLATE OUTLINE: the pill/cap branch runs along the
    // plate's own edge and stays ~on it (distance ≈ 0), while the body branch peels away from
    // it (distance grows). Distance-to-outline separates the two even at a rounded cap, where
    // distance-to-CENTRE fails — a cap point is far from the plate centre yet still on its edge.
    var probe = Math.max(overshootPt, mmToPoints(2));
    var fEnd = _walkCutPolyArc(cutPoly, P, ei,  1, probe);
    var bEnd = _walkCutPolyArc(cutPoly, P, ei, -1, probe);
    var fp = fEnd[fEnd.length - 1], bp = bEnd[bEnd.length - 1];
    var dF = _minDist2ToPolyEdges(fp, platePoly);
    var dB = _minDist2ToPolyEdges(bp, platePoly);
    // Clear winner: the endpoint farther from the plate is the body branch (the tab branch hugs
    // the plate edge, distance ~0). Unchanged from the prior behaviour.
    var dir;
    if (Math.abs(Math.sqrt(dF) - Math.sqrt(dB)) >= mmToPoints(0.5)) {
        dir = (dF >= dB) ? 1 : -1;
    } else {
        // Near-tie (#8): on a small element the ~2mm probe can wrap past the body region, so the
        // two endpoints sit ~equidistant from the plate and a single endpoint can't separate the
        // branches — the bare `dF >= dB` then defaults to +1, which may be the TAB side. Integrate
        // distance-to-plate over the WHOLE walk instead: the tab branch hugs the plate edge the
        // entire way (~0), the body branch peels away, so the summed distance decides. Only fires
        // on a genuine tie; clear winners above are byte-identical to before.
        var sF = _sumDist2ToPoly(fEnd, platePoly), sB = _sumDist2ToPoly(bEnd, platePoly);
        dir = (sF >= sB) ? 1 : -1;
        log("[halfcut] overshoot tail | near-tie on direction — broke by integrated "
            + "distance-to-plate (" + (dir > 0 ? "fwd" : "back") + ")");
    }
    return _walkCutPolyArc(cutPoly, P, ei, dir, overshootPt);
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

// Sum of squared distances from each point of a walk to a polygon's OUTLINE. The tie-break
// signal for the overshoot direction: a contour walk that hugs the plate edge sums ~0; one
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

// Same minimum-distance computation as minPolygonSetDistance, but also returns
// the witness pair — the two closest points, one on each polygon set — so QA can
// draw a connector spanning the actual gap. Returns
//   { dist, ax, ay, bx, by }
// where (ax,ay) lies on polysA and (bx,by) on polysB. On full containment
// (dist 0) the witness collapses to the contained vertex (connector degenerates
// to a dot, which still marks the spot). Points are in the polygons' own
// coordinate space (document points, as produced by samplePathToPolygons).
function minPolygonSetDistanceEx(polysA, polysB) {
    // Work in SQUARED distance throughout (no per-pair sqrt) and prune each vertex
    // against the other polygon's bounding box. Both are exact: sqrt is monotonic so
    // every comparison is unchanged, and a vertex whose distance to B's bbox already
    // exceeds the running min cannot beat it (bbox distance is a lower bound), so
    // skipping it leaves the minimum AND the witness pair byte-identical to brute
    // force. This is the heavy inner loop of spacing QA — formerly ~13s of the run.
    var minD2 = Infinity;
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
// used for the amber margin-overhang sliver. Skips degenerate (<3 point) input.
function qaFillPolygon(layer, poly, colorObj, opacity) {
    if (!poly || poly.length < 3) return null;
    var pts = [], i;
    for (i = 0; i < poly.length; i++) pts.push([poly[i].x, poly[i].y]);
    var p = layer.pathItems.add();
    p.setEntirePath(pts);
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
